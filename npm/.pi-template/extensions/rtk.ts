// RTK Pi extension — переписує bash-команди на rtk-еквіваленти для економії токенів.
// Vendored з rtk (`rtk init --agent pi`, rtk 0.43.0), адаптований під конвенції репо:
// без імпортів з '@earendil-works/pi-coding-agent' (пакет резолвиться лише в runtime pi,
// а knip/TS-server проєктів-споживачів його не бачать) — типи описані локально, як у
// n-rules-adr. Шлях установки `.pi/extensions/rtk.ts` збігається зі шляхом самого rtk —
// повторний `rtk init --agent pi` ідемпотентний. Потребує rtk >= 0.23.0 у PATH; без
// нього extension сам вимикається (fail-open).
//
// Тонкий делегат: уся rewrite-логіка живе в `rtk rewrite` (єдине джерело правди).
//
// Контракт exit-кодів `rtk rewrite`:
//   0 + stdout  rewrite знайдено → мутуємо команду
//   1           rtk-еквівалента немає → passthrough
//   3 + stdout  rewrite (advisory) → мутуємо команду

import { env } from 'node:process'

interface PiToolCallEvent {
  toolName?: string
  input: { command?: unknown }
}

interface PiContext {
  signal?: AbortSignal
}

interface PiExecResult {
  code: number
  stdout: string
  killed?: boolean
}

interface PiApi {
  exec: (cmd: string, args: string[], opts?: { timeout?: number; signal?: AbortSignal }) => Promise<PiExecResult>
  on: (event: string, handler: (event: PiToolCallEvent, ctx: PiContext) => Promise<void> | void) => void
}

const REWRITE_TIMEOUT_MS = 2_000
const MIN_SUPPORTED_RTK_MINOR = 23

const SEMVER_RE = /(\d+)\.(\d+)\.(\d+)/
const RTK_VERSION_PREFIX_RE = /^rtk\s+/

// Парсить "X.Y.Z" semver → [major, minor, patch] або null.
function parseSemver(raw: string): [number, number, number] | null {
  const m = raw.trim().match(SEMVER_RE)
  if (!m) return null
  return [parseInt(m[1], 10), parseInt(m[2], 10), parseInt(m[3], 10)]
}

// Викликає `rtk rewrite`; повертає переписану команду або null (passthrough).
async function rewriteCommand(pi: PiApi, cmd: string, signal?: AbortSignal): Promise<string | null> {
  const result = await pi.exec('rtk', ['rewrite', cmd], {
    timeout: REWRITE_TIMEOUT_MS,
    signal
  })
  if (result.killed) return null
  if (result.code !== 0 && result.code !== 3) return null
  return result.stdout.trim() || null
}

export default async function (pi: PiApi) {
  // Проба rtk при завантаженні; без бінарника (або із застарим) extension вимикається.
  const ver = await pi.exec('rtk', ['--version'], { timeout: REWRITE_TIMEOUT_MS })
  if (ver.code !== 0) {
    console.warn('[rtk] rtk binary not found in PATH — extension disabled')
    return
  }

  // `rtk rewrite` з'явився у 0.23.0 — старіші версії не підтримуються.
  const parsed = parseSemver(ver.stdout.replace(RTK_VERSION_PREFIX_RE, ''))
  if (parsed) {
    const [major, minor] = parsed
    if (major === 0 && minor < MIN_SUPPORTED_RTK_MINOR) {
      console.warn(`[rtk] rtk ${ver.stdout.trim()} is too old (need >= 0.23.0) — extension disabled`)
      return
    }
  }

  pi.on('tool_call', async (event, ctx) => {
    try {
      // В upstream це isToolCallEventType('bash', event) — просте порівняння toolName.
      if (event?.toolName !== 'bash') return

      const cmd = event.input.command
      if (typeof cmd !== 'string' || cmd.trim() === '') return

      if (cmd.startsWith('rtk ')) return
      if (env.RTK_DISABLED === '1') return

      // Делегуємо rewrite-рішення rtk.
      const rewritten = await rewriteCommand(pi, cmd, ctx.signal)
      if (rewritten && rewritten !== cmd) {
        event.input.command = rewritten
      }
    } catch (error) {
      // Fail open: ніколи не блокуємо виконання через неочікувану помилку.
      console.warn('[rtk] unexpected error in tool_call handler; passing through command', error)
      return
    }
  })
}
