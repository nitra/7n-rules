/** @see ./docs/acp.md */

/**
 * ACP (Agent Client Protocol, Zed) — виклик зовнішніх CLI-агентів (`cursor`, `codex`,
 * `claude`) особистою підпискою через stdio/JSON-RPC замість argv/stdin-тексту.
 * JS-двійник Rust-крейта `llm-cascade` (`llm-lib/crates/llm-cascade/src/acp.rs`):
 * той самий контракт (спавн вже залогіненого CLI, `session/prompt`, fail-fast без
 * retry), інша мова виконання.
 *
 * Дозвіл на tool call підтверджується автоматично (`allow_once`) — виклик
 * неінтерактивний, питати нема кого; той самий рівень довіри, що й `-p`/`exec`
 * non-interactive флаги зовнішніх CLI мали раніше.
 */

import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { Readable, Writable } from 'node:stream'
import { ClientSideConnection, ndJsonStream, PROTOCOL_VERSION } from '@zed-industries/agent-client-protocol'

/**
 * Команда спавну ACP-сервера для кожного агента.
 * `cursor` — нативний ACP-режим CLI (`agent acp`), жодного стороннього моста.
 * `codex`/`claude` — офіційні ACP-мости видавців (`npx` тягне їх при потребі).
 * @type {Record<'cursor' | 'codex' | 'claude', { command: string, args: string[] }>}
 */
const ACP_COMMANDS = {
  cursor: { command: 'agent', args: ['acp'] },
  codex: { command: 'npx', args: ['-y', '@agentclientprotocol/codex-acp@latest'] },
  claude: { command: 'npx', args: ['-y', '@zed-industries/claude-code-acp@latest'] }
}

/**
 * @param {{ options: Array<{ optionId: string, kind: string }> }} params запит дозволу від агента
 * @returns {{ outcome: { outcome: 'selected', optionId: string } }} автоматичний вибір найменш дозвільного "allow"-варіанту
 */
function autoAllow(params) {
  const option =
    params.options.find(o => o.kind === 'allow_once') ??
    params.options.find(o => o.kind === 'allow_always') ??
    params.options[0]
  return { outcome: { outcome: 'selected', optionId: option.optionId } }
}

/**
 * @param {import('node:child_process').ChildProcess} child дочірній процес
 * @returns {Promise<{ event: 'error', error: Error }>} подія спавн-помилки
 */
async function watchSpawnError(child) {
  const [error] = await once(child, 'error')
  return { event: 'error', error }
}

/**
 * @param {import('node:child_process').ChildProcess} child дочірній процес
 * @returns {Promise<{ event: 'exit', code: number|null, signal: string|null }>} подія завершення процесу
 */
async function watchExit(child) {
  const [code, signal] = await once(child, 'exit')
  return { event: 'exit', code, signal }
}

/**
 * Watchdog дочірнього процесу: провалюється швидко, якщо CLI не запустився чи вийшов
 * до кінця ходу — без цього мертвий процес просто вішає `connection.prompt` назавжди
 * (`Connection#receive` в `@zed-industries/agent-client-protocol` тихо завершує
 * читання на закритому stdout, не відхиляючи pending-запити).
 * @param {import('node:child_process').ChildProcess} child дочірній процес ACP-агента
 * @param {string} command ім'я команди (для тексту помилки)
 * @returns {Promise<never>} ніколи не резолвиться успішно — лише провалюється
 * @throws {Error} на спавн-помилку чи будь-який вихід процесу до завершення ходу
 */
async function waitForChildFailure(child, command) {
  const result = await Promise.race([watchSpawnError(child), watchExit(child)])

  if (result.event === 'error') {
    throw new Error(`\`${command}\` failed to start: ${result.error.message}`)
  }
  throw new Error(
    result.signal
      ? `\`${command}\` killed by signal ${result.signal}`
      : `\`${command}\` exited with code ${result.code} before completing the turn`
  )
}

/**
 * @param {'cursor' | 'codex' | 'claude' | { command: string, args: string[], env?: Record<string, string> }} kind
 *   який ACP-агент запускати; або (для тестів) готова команда спавну замість табличного kind
 * @param {string} prompt промпт для `session/prompt`
 * @param {{ cwd?: string, onChunk?: (text: string) => void }} [opts] робочий каталог сесії; колбек стрімінгу тексту (дефолт — `process.stdout.write`)
 * @returns {Promise<number>} exit code: `0` — `stopReason === 'end_turn'`, інакше `1`
 * @throws {Error} якщо бінарник агента не запускається чи процес завершується з помилкою до кінця ходу
 */
export async function runAcpAgent(kind, prompt, opts = {}) {
  const spec = typeof kind === 'string' ? ACP_COMMANDS[kind] : kind
  if (!spec) {
    throw new Error(`Unknown ACP agent kind: ${kind}`)
  }
  const cwd = opts.cwd ?? process.cwd()
  const onChunk = opts.onChunk ?? (text => process.stdout.write(text))

  const child = spawn(spec.command, spec.args, {
    cwd,
    stdio: ['pipe', 'pipe', 'inherit'],
    env: spec.env ? { ...process.env, ...spec.env } : process.env
  })
  const failure = waitForChildFailure(child, spec.command)

  const stream = ndJsonStream(Writable.toWeb(child.stdin), Readable.toWeb(child.stdout))
  const connection = new ClientSideConnection(
    () => ({
      requestPermission: params => autoAllow(params),
      sessionUpdate: params => {
        const { update } = params
        const isTextChunk =
          (update.sessionUpdate === 'agent_message_chunk' || update.sessionUpdate === 'agent_thought_chunk') &&
          update.content.type === 'text'
        if (isTextChunk) {
          onChunk(update.content.text)
        }
      }
    }),
    stream
  )

  const turn = (async () => {
    await connection.initialize({
      protocolVersion: PROTOCOL_VERSION,
      clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false }
    })
    const { sessionId } = await connection.newSession({ cwd, mcpServers: [] })
    const { stopReason } = await connection.prompt({ sessionId, prompt: [{ type: 'text', text: prompt }] })
    return stopReason === 'end_turn' ? 0 : 1
  })()

  try {
    return await Promise.race([turn, failure])
  } finally {
    child.kill()
  }
}
