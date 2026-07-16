/**
 * Тести ACP-раннера: автоапрув permission-опцій, мапінг StopReason → exit code,
 * резолвінг bin-адаптера, повний прогін через fake ACP-connection.
 */
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { describe, expect, test } from 'vitest'

import {
  pickAutoPermissionOptionId,
  resolveAdapterBin,
  runAcpRunner,
  stopReasonToExitCode
} from '../lib/acp-runner.mjs'

const CODEX_ACP_BIN_RE = /codex-acp.*dist.index\.js$/
const CLAUDE_ACP_BIN_RE = /claude-agent-acp.*dist.index\.js$/
const CURSOR_NOT_IN_PATH_RE = /cursor-agent.*not found in PATH/
const CRASH_MID_TURN_RE = /завершився з кодом 1 до завершення ходу/
const FAKE_PROJECT_DIR = join(tmpdir(), 'acp-runner-test-project')

/** Заглушка `logError`/`out` для тестів, де вивід не перевіряється. */
function noop() {
  // no-op: цей тест не перевіряє вивід
}

describe('pickAutoPermissionOptionId', () => {
  test('обирає allow_always, якщо є', () => {
    const options = [
      { optionId: 'once', kind: 'allow_once' },
      { optionId: 'always', kind: 'allow_always' }
    ]
    expect(pickAutoPermissionOptionId(options)).toBe('always')
  })

  test('без allow_always — обирає allow_once', () => {
    const options = [
      { optionId: 'reject', kind: 'reject_once' },
      { optionId: 'once', kind: 'allow_once' }
    ]
    expect(pickAutoPermissionOptionId(options)).toBe('once')
  })

  test('без allow-опцій — перша опція', () => {
    const options = [{ optionId: 'reject', kind: 'reject_once' }]
    expect(pickAutoPermissionOptionId(options)).toBe('reject')
  })
})

describe('stopReasonToExitCode', () => {
  test('end_turn → 0', () => {
    expect(stopReasonToExitCode('end_turn')).toBe(0)
  })

  test('cancelled/max_turn_requests/refusal → 1', () => {
    expect(stopReasonToExitCode('cancelled')).toBe(1)
    expect(stopReasonToExitCode('max_turn_requests')).toBe(1)
    expect(stopReasonToExitCode('refusal')).toBe(1)
  })
})

describe('resolveAdapterBin', () => {
  test('резолвить dist/index.js бандлованих ACP-адаптерів', () => {
    expect(resolveAdapterBin('@agentclientprotocol/codex-acp')).toMatch(CODEX_ACP_BIN_RE)
    expect(resolveAdapterBin('@agentclientprotocol/claude-agent-acp')).toMatch(CLAUDE_ACP_BIN_RE)
  })
})

/**
 * Fake ACP-агент: віддає permission-request з двома опціями (щоб перевірити
 * автовибір `allow_always`), стрімить один текстовий чанк, завершує end_turn.
 * @param {{ stopReason?: string, permissionOptions?: { optionId: string, kind: string, name: string }[] }} [opts] опції fake-агента
 * @returns {{ calls: { requestPermission: object[], sessionUpdate: object[] }, acp: object }} fake `acp`-модуль + журнал викликів
 */
function createFakeAcp({ stopReason = 'end_turn', permissionOptions } = {}) {
  const calls = { requestPermission: [], sessionUpdate: [] }
  return {
    calls,
    acp: {
      PROTOCOL_VERSION: 1,
      ndJsonStream: () => ({}),
      ClientSideConnection: class {
        constructor(toClient) {
          this.client = toClient(this)
        }

        initialize() {
          return Promise.resolve({ protocolVersion: 1 })
        }

        newSession() {
          return Promise.resolve({ sessionId: 'session-1' })
        }

        async prompt(params) {
          const permissionResult = await this.client.requestPermission({
            sessionId: params.sessionId,
            toolCall: { toolCallId: 'tc1', title: 'write file' },
            options: permissionOptions ?? [
              { optionId: 'once', kind: 'allow_once', name: 'Allow once' },
              { optionId: 'always', kind: 'allow_always', name: 'Always allow' }
            ]
          })
          calls.requestPermission.push(permissionResult)

          await this.client.sessionUpdate({
            sessionId: params.sessionId,
            update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'hello from agent' } }
          })

          return { stopReason }
        }
      }
    }
  }
}

/**
 * Fake дочірній процес: сам є `EventEmitter` (стріми — його підклас, як і реальний
 * `ChildProcess`) із `stdin`/`stdout`-пайпами й `kill()`, що емітить `exit` — потрібен
 * watchdog-у в `runAcpRunner` (`once(child, 'error'|'exit')`), який інакше кинув би
 * `TypeError` на plain-обʼєкті без `.on`/`.once`.
 * @returns {PassThrough & { stdin: PassThrough, stdout: PassThrough, killed: boolean, kill: () => void }} fake `ChildProcess`
 */
function createFakeChild() {
  const child = new PassThrough()
  child.stdin = new PassThrough()
  child.stdout = new PassThrough()
  child.killed = false
  child.kill = () => {
    child.killed = true
    child.emit('exit', 0, null)
  }
  return child
}

describe('runAcpRunner', () => {
  test('автоапрувляє allow_always, стрімить текст, end_turn → 0', async () => {
    const { acp, calls } = createFakeAcp()
    const child = createFakeChild()
    const chunks = []

    const code = await runAcpRunner('codex', 'do the task', FAKE_PROJECT_DIR, noop, {
      acp,
      spawnFn: () => child,
      out: chunk => {
        chunks.push(chunk)
      },
      resolveAdapterBin: () => '/fake/dist/index.js'
    })

    expect(code).toBe(0)
    expect(calls.requestPermission).toHaveLength(1)
    expect(calls.requestPermission[0].outcome).toEqual({ outcome: 'selected', optionId: 'always' })
    expect(chunks.join('')).toBe('hello from agent')
    expect(child.killed).toBe(true)
  })

  test('stopReason ≠ end_turn → exit 1 + logError', async () => {
    const { acp } = createFakeAcp({ stopReason: 'refusal' })
    const child = createFakeChild()
    const errors = []

    const code = await runAcpRunner(
      'claude',
      'do the task',
      FAKE_PROJECT_DIR,
      line => {
        errors.push(line)
      },
      {
        acp,
        spawnFn: () => child,
        out: noop,
        resolveAdapterBin: () => '/fake/dist/index.js'
      }
    )

    expect(code).toBe(1)
    expect(errors.join('\n')).toContain('refusal')
  })

  test('cursor: bin відсутній у PATH → кидає, дочірній процес не спавниться', async () => {
    const spawned = []

    await expect(
      runAcpRunner('cursor', 'do the task', FAKE_PROJECT_DIR, noop, {
        spawnFn: (...args) => {
          spawned.push(args)
          return createFakeChild()
        },
        isBinaryInPath: () => false
      })
    ).rejects.toThrow(CURSOR_NOT_IN_PATH_RE)

    expect(spawned).toHaveLength(0)
  })

  test('дочірній процес падає до кінця ходу → fail-fast, не висить', async () => {
    const child = createFakeChild()
    const start = Date.now()
    const { promise: initializeNeverResolves } = Promise.withResolvers()

    const crashingAcp = {
      PROTOCOL_VERSION: 1,
      ndJsonStream: () => ({}),
      ClientSideConnection: function CrashingConnection() {
        this.initialize = () => initializeNeverResolves
      }
    }
    queueMicrotask(() => child.emit('exit', 1, null))

    await expect(
      runAcpRunner('codex', 'do the task', FAKE_PROJECT_DIR, noop, {
        acp: crashingAcp,
        spawnFn: () => child,
        out: noop,
        resolveAdapterBin: () => '/fake/dist/index.js'
      })
    ).rejects.toThrow(CRASH_MID_TURN_RE)
    expect(Date.now() - start).toBeLessThan(5000)
  })
})
