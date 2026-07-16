/**
 * Deprecated JS ACP-шим для `skill claude` (Agent Client Protocol,
 * agentclientprotocol.com) — JSON-RPC поверх stdio.
 *
 * `cursor`/`codex` мігрували на `@7n/llm-lib/acp` (napi-міст до
 * `llm_cascade::acp` — та сама протокольна логіка, але в Rust, без
 * дублювання в JS). `claude` лишається тут як окремий JS-шим, бо Rust-крейт
 * `AcpAgentKind` його не моделює (лише `Cursor`/`Codex`); підʼєднання йде
 * через офіційний TS SDK `@zed-industries/agent-client-protocol`, а дозволи
 * на tool-calls (`session/request_permission`) автоматично схвалюються без
 * участі людини — паритет із колишнім non-interactive `-p`-режимом
 * (full user-trust, без write-guard, як задокументовано в `@7n/llm-lib/agent-skill`).
 *
 * `claude` — офіційний адаптер (`@agentclientprotocol/claude-agent-acp`), що
 * вбудовує свій рушій — зовнішній бінарник `claude` у PATH не потрібен.
 */

import { spawn } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { stdout } from 'node:process'
import { Readable, Writable } from 'node:stream'

const require = createRequire(import.meta.url)

/**
 * Команда запуску ACP-агента на провайдер. Резолвиться з `bin`-запису
 * вбудованого npm-пакета-адаптера.
 * @type {Record<'claude', { adapterPackage: string }>}
 */
export const ACP_AGENT_COMMANDS = {
  claude: { adapterPackage: '@agentclientprotocol/claude-agent-acp' }
}

/**
 * `StopReason` ACP-прогону → exit code CLI-скіла.
 * @param {string} stopReason `end_turn`|`max_tokens`|`max_turn_requests`|`refusal`|`cancelled`
 * @returns {0 | 1} 0 — успішне завершення (`end_turn`), 1 — усе інше
 */
export function stopReasonToExitCode(stopReason) {
  return stopReason === 'end_turn' ? 0 : 1
}

/**
 * Резолвить абсолютний шлях до bin-файлу вбудованого ACP-адаптера з його `package.json`.
 * @param {string} adapterPackage назва npm-пакета адаптера (`@agentclientprotocol/claude-agent-acp`)
 * @returns {string} абсолютний шлях до виконуваного файлу адаптера
 */
export function resolveAdapterBin(adapterPackage) {
  const pkgJsonPath = require.resolve(`${adapterPackage}/package.json`)
  const pkg = JSON.parse(readFileSync(pkgJsonPath, 'utf8'))
  const binField = pkg.bin
  const binRelPath = typeof binField === 'string' ? binField : Object.values(binField)[0]
  return join(dirname(pkgJsonPath), /** @type {string} */ (binRelPath))
}

/**
 * Обирає `PermissionOption` без участі людини: `allow_always` > `allow_once` > перша опція.
 * Паритет із non-interactive `-p`/`exec -` — скіл є явною user-invocation, тож дозволи
 * не питаються інтерактивно (див. `@7n/llm-lib/agent-skill` — той самий full-trust режим).
 * @param {{ optionId: string, kind: string }[]} options варіанти дозволу з `RequestPermissionRequest`
 * @returns {string} `optionId` обраного варіанту
 */
export function pickAutoPermissionOptionId(options) {
  const byKind = kind => options.find(option => option.kind === kind)
  const chosen = byKind('allow_always') ?? byKind('allow_once') ?? options[0]
  return chosen.optionId
}

/**
 * ACP `Client` для скіл-раннера: автоматичне схвалення дозволів, стрім тексту в stdout,
 * пряма реалізація файлового вводу-виводу поверх `node:fs` (full-trust режим).
 */
class AcpSkillClient {
  /**
   * @param {{ out: (chunk: string) => void }} deps вивід тексту (парність зі streaming `-p`)
   */
  constructor({ out }) {
    this.out = out
  }

  /**
   * @param {{ options: { optionId: string, kind: string }[] }} params запит дозволу від агента
   * @returns {Promise<{ outcome: { outcome: 'selected', optionId: string } }>} автоматично обраний варіант
   */
  requestPermission(params) {
    return Promise.resolve({ outcome: { outcome: 'selected', optionId: pickAutoPermissionOptionId(params.options) } })
  }

  /**
   * @param {{ update: { sessionUpdate: string, content?: { type: string, text?: string } } }} params подія прогресу сесії
   * @returns {Promise<void>} стрімить текстові дельти в stdout; інші типи подій ігноруються
   */
  sessionUpdate(params) {
    const { update } = params
    if (update.sessionUpdate === 'agent_message_chunk' && update.content?.type === 'text') {
      this.out(update.content.text ?? '')
    }
    return Promise.resolve()
  }

  /**
   * @param {{ path: string }} params шлях до файлу
   * @returns {Promise<{ content: string }>} вміст файлу
   */
  readTextFile(params) {
    return Promise.resolve({ content: readFileSync(params.path, 'utf8') })
  }

  /**
   * @param {{ path: string, content: string }} params шлях і новий вміст файлу
   * @returns {Promise<Record<string, never>>} порожня відповідь (успіх)
   */
  writeTextFile(params) {
    writeFileSync(params.path, params.content, 'utf8')
    return Promise.resolve({})
  }
}

/**
 * Виконує скіл через зовнішнього ACP-агента. Єдиний лишений провайдер —
 * deprecated `claude` (`cursor`/`codex` — див. `@7n/llm-lib/acp`).
 * @param {'claude'} kind провайдер
 * @param {string} prompt готовий промпт скіла
 * @param {string} projectDir робочий каталог сесії агента
 * @param {(line: string) => void} logError вивід помилок
 * @param {{ acp?: object, spawnFn?: typeof spawn, out?: (chunk: string) => void, resolveAdapterBin?: (pkg: string) => string }} [deps] інжекти для тестів
 * @returns {Promise<number>} exit code (0 — `end_turn`, 1 — інакше)
 */
export async function runAcpRunner(kind, prompt, projectDir, logError, deps = {}) {
  const spawnFn = deps.spawnFn ?? spawn
  const out = deps.out ?? (chunk => stdout.write(chunk))
  const resolveBin = deps.resolveAdapterBin ?? resolveAdapterBin

  const { adapterPackage } = ACP_AGENT_COMMANDS[kind]
  const bin = process.execPath
  const args = [resolveBin(adapterPackage)]

  const acp = deps.acp ?? (await import('@zed-industries/agent-client-protocol'))
  const child = spawnFn(bin, args, { cwd: projectDir, stdio: ['pipe', 'pipe', 'inherit'], env: process.env })

  try {
    const input = Writable.toWeb(child.stdin)
    const output = /** @type {ReadableStream<Uint8Array>} */ (Readable.toWeb(child.stdout))
    const client = new AcpSkillClient({ out })
    const stream = acp.ndJsonStream(input, output)
    const connection = new acp.ClientSideConnection(() => client, stream)

    await connection.initialize({
      protocolVersion: acp.PROTOCOL_VERSION,
      clientCapabilities: { fs: { readTextFile: true, writeTextFile: true } }
    })
    const session = await connection.newSession({ cwd: projectDir, mcpServers: [] })
    const result = await connection.prompt({
      sessionId: session.sessionId,
      prompt: [{ type: 'text', text: prompt }]
    })

    if (result.stopReason !== 'end_turn') {
      logError(`acp ${kind}: stopReason=${result.stopReason}`)
    }
    return stopReasonToExitCode(result.stopReason)
  } finally {
    child.kill()
  }
}
