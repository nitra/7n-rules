/**
 * SubagentRunner (spec §15.1) — абстракція спавну сфокусованого субагента для
 * Активного Раннера (Ф3/Ф4). Backend обирається за доступністю:
 *   1. `claude-agent-sdk` (програмний, потребує `ANTHROPIC_API_KEY`);
 *   2. `claude -p` (CLI-auth користувача);
 *   3. `cursor-agent -p` (CLI-auth).
 * Нема жодного → throw (polyfill без runner-а не стартує, §2.2).
 *
 * pi.dev для inner-спавну НЕ використовується: у автономному режимі pi.dev —
 * зовнішній драйвер, тож спавн ним внутрішніх субагентів = рекурсія (§9.1).
 *
 * Усі probe-залежності (`spawn`/`isInPath`/`canImportSdk`/`query`) ін'єктуються,
 * щоб тестувати без реальних процесів і без SDK.
 */
import { spawnSync } from 'node:child_process'
import { env as processEnv } from 'node:process'

const NO_BACKEND =
  'SubagentRunner: ні claude-agent-sdk (з ANTHROPIC_API_KEY), ні `claude`/`cursor-agent` у PATH — ' +
  'субагентів спавнити нічим. Встанови CLI-runner або задай ANTHROPIC_API_KEY.'

/**
 * Чи є бінарник у PATH (через `command -v`).
 * @param {string} name ім'я виконуваного
 * @param {typeof import('node:child_process').spawnSync} [spawn] ін'єкція для тестів
 * @returns {boolean} true, якщо знайдено
 */
export function isBinaryInPath(name, spawn = spawnSync) {
  const r = spawn('command', ['-v', name], { shell: true, encoding: 'utf8' })
  return (r.status ?? 1) === 0
}

/**
 * Обирає backend субагентів за пріоритетом sdk > claude > cursor.
 * @param {{ hasApiKey: boolean, canImportSdk: boolean, isInPath: (name: string) => boolean }} probes доступність
 * @returns {'sdk' | 'claude' | 'cursor' | null} backend або null
 */
export function selectBackend({ hasApiKey, canImportSdk, isInPath }) {
  if (hasApiKey && canImportSdk) return 'sdk'
  if (isInPath('claude')) return 'claude'
  if (isInPath('cursor-agent')) return 'cursor'
  return null
}

/**
 * CLI-runner (`claude -p` / `cursor-agent -p`) — CLI-auth, без API key.
 * @param {'claude' | 'cursor-agent'} bin виконуваний
 * @param {{ spawn?: typeof import('node:child_process').spawnSync }} [deps] ін'єкція
 * @returns {{ backend: string, runStep: (prompt: string, opts?: { cwd?: string }) => { ok: boolean, output: string } }} runner
 */
export function cliRunner(bin, deps = {}) {
  const spawn = deps.spawn ?? spawnSync
  return {
    backend: bin,
    runStep(prompt, { cwd } = {}) {
      const r = spawn(bin, ['-p'], { input: prompt, cwd, encoding: 'utf8' })
      return { ok: (r.status ?? 1) === 0, output: `${r.stdout ?? ''}${r.stderr ?? ''}` }
    }
  }
}

/**
 * SDK-runner (`claude-agent-sdk`). `query` ін'єктується; за замовчуванням —
 * динамічний import (optional dependency).
 * @param {{ query?: (input: object) => object }} [deps] ін'єкція (query повертає async-iterable повідомлень)
 * @returns {{ backend: string, runStep: (prompt: string, opts?: { cwd?: string }) => Promise<{ ok: boolean, output: string }> }} runner
 */
export function sdkRunner(deps = {}) {
  return {
    backend: 'sdk',
    async runStep(prompt, { cwd } = {}) {
      let query = deps.query
      if (!query) {
        const mod = await import('@anthropic-ai/claude-agent-sdk')
        query = mod.query
      }
      let output = ''
      let ok = true
      try {
        for await (const msg of query({
          prompt,
          options: { cwd, maxTurns: 20, allowedTools: ['Read', 'Edit', 'Bash'] }
        })) {
          if (typeof msg?.text === 'string') output += msg.text
          if (msg?.type === 'result') ok = msg.is_error !== true
        }
      } catch (error) {
        return { ok: false, output: String(error?.message ?? error) }
      }
      return { ok, output }
    }
  }
}

/**
 * Створює runner за доступним backend-ом. `backend`/probe-и можна задати явно
 * (тести); інакше визначаються з env/PATH/SDK.
 * @param {{ backend?: string, env?: Record<string, string | undefined>, isInPath?: (name: string) => boolean, canImportSdk?: boolean, spawn?: (cmd: string, args: string[], opts: object) => object, query?: (input: object) => object }} [deps] ін'єкції
 * @returns {Promise<{ backend: string, runStep: (prompt: string, opts?: object) => object }>} runner
 */
export async function createRunner(deps = {}) {
  const env = deps.env ?? processEnv
  const isInPath = deps.isInPath ?? (name => isBinaryInPath(name, deps.spawn))
  const canImportSdk = deps.canImportSdk ?? (await probeSdk())
  const backend = deps.backend ?? selectBackend({ hasApiKey: Boolean(env.ANTHROPIC_API_KEY), canImportSdk, isInPath })
  if (!backend) throw new Error(NO_BACKEND)
  if (backend === 'sdk') return sdkRunner(deps)
  return cliRunner(backend === 'claude' ? 'claude' : 'cursor-agent', deps)
}

/**
 * Чи імпортується `claude-agent-sdk` (optional dependency).
 * @returns {Promise<boolean>} true, якщо доступний
 */
async function probeSdk() {
  try {
    await import('@anthropic-ai/claude-agent-sdk')
    return true
  } catch {
    return false
  }
}
