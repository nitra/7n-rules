/**
 * `runAcpAgent` — щасливий шлях проти фейкового ACP-агента (`fixtures/fake-acp-agent.mjs`)
 * і fail-fast, коли бінарник відсутній (паритет з Rust-тестом
 * `llm-cascade::acp::spawn_of_missing_binary_fails_fast_not_hangs`).
 */
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'

import { runAcpAgent } from '../lib/acp.mjs'

const FAKE_AGENT_PATH = fileURLToPath(new URL('fixtures/fake-acp-agent.mjs', import.meta.url))
const fakeAgentKind = (env = {}) => ({ command: process.execPath, args: [FAKE_AGENT_PATH], env })

describe('runAcpAgent', () => {
  test('щасливий шлях: end_turn → exit code 0', async () => {
    const chunks = []
    const code = await runAcpAgent(fakeAgentKind(), 'привіт', {
      onChunk: text => {
        chunks.push(text)
      }
    })

    expect(code).toBe(0)
    expect(chunks).toEqual([])
  })

  test('stopReason !== end_turn → exit code 1', async () => {
    const code = await runAcpAgent(fakeAgentKind({ FAKE_ACP_STOP_REASON: 'refusal' }), 'привіт', {
      onChunk: () => process.stdout
    })

    expect(code).toBe(1)
  })

  test('невідомий kind → синхронна помилка', async () => {
    await expect(runAcpAgent('not-a-real-agent', 'привіт')).rejects.toThrow('Unknown ACP agent kind')
  })

  test('відсутній бінарник → fail-fast, не висить', async () => {
    const start = Date.now()
    await expect(runAcpAgent({ command: 'nonexistent-acp-binary-xyz-test', args: [] }, 'привіт')).rejects.toThrow(
      'failed to start'
    )
    expect(Date.now() - start).toBeLessThan(5000)
  })
})
