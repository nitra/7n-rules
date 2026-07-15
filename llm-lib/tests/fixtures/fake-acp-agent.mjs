/**
 * Фейковий ACP-агент для тестів `../acp.test.mjs` — мінімальний Agent-бік протоколу
 * (`AgentSideConnection`) на stdio: одна сесія, один текстовий chunk, `stopReason`
 * керується через `FAKE_ACP_STOP_REASON` (дефолт `end_turn`).
 */

import { env, stdin, stdout } from 'node:process'
import { Readable, Writable } from 'node:stream'
import { AgentSideConnection, ndJsonStream } from '@zed-industries/agent-client-protocol'

/** Заглушка `Agent#cancel` — фейковий агент завжди відповідає одним ходом, скасовувати нічого. */
function noop() {
  // no-op: скасовувати нічого — фейковий агент відповідає одним ходом
}

export const connection = new AgentSideConnection(
  () => ({
    initialize: () => Promise.resolve({ protocolVersion: 1, agentCapabilities: {}, authMethods: [] }),
    newSession: () => Promise.resolve({ sessionId: 'fake-session' }),
    prompt: () => Promise.resolve({ stopReason: env.FAKE_ACP_STOP_REASON ?? 'end_turn' }),
    cancel: noop
  }),
  ndJsonStream(Writable.toWeb(stdout), Readable.toWeb(stdin))
)
