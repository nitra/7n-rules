/**
 * Pi.dev extension: ADR capture + normalize.
 *
 * На pi `agent_end` event серіалізує `ctx.sessionManager.getEntries()` у
 * Claude-сумісний JSONL у tmpdir, формує stdin JSON і спавнить існуючі
 * `.claude/hooks/{capture,normalize}-decisions.sh` через `pi.exec`.
 *
 * Логіка skip/throttle/LLM-CLI-selection лишається у bash — TS лише
 * адаптер pi → bash. Recursion guard через env vars, що їх bash виставляє
 * перед спавном LLM CLI.
 */

import { randomUUID } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { env } from 'node:process'

interface PiContext {
  cwd: string
  sessionId?: string
  signal?: AbortSignal
  sessionManager: { getEntries(): Array<{ message?: { role?: string; content?: unknown } }> }
  ui?: { notify?: (msg: string, level?: 'info' | 'warning' | 'error') => void }
}

interface PiExec {
  exec: (
    cmd: string,
    args: string[],
    opts?: {
      cwd?: string
      env?: Record<string, string>
      input?: string
      signal?: AbortSignal
      timeout?: number
    }
  ) => Promise<{ code: number; stdout: string; stderr: string }>
  on: (event: string, handler: (event: unknown, ctx: PiContext) => Promise<void> | void) => void
}

const CAPTURE_HOOK = '.claude/hooks/capture-decisions.sh'
const NORMALIZE_HOOK = '.claude/hooks/normalize-decisions.sh'

/**
 * Pi extension entry point.
 * @param {PiExec} pi pi.dev extension API
 */
export default function (pi: PiExec): void {
  pi.on('agent_end', async (_event, ctx) => {
    // Recursion guard: bash спавнить LLM CLI (claude/cursor-agent/pi), той може
    // стартувати pi-сесію. Bash виставляє ці env-vars перед спавном — child
    // inheritance ловить рекурсивний trigger тут.
    if (env.CAPTURE_DECISIONS_RUNNING || env.ADR_NORMALIZE_RUNNING) {
      return
    }

    // Підкоманди-оркестратори (JS-orchestrated lint/skill/taze/release/...) виставляють
    // ADR_HOOKS_SKIP=1 перед запуском — не серіалізуємо transcript і не запускаємо
    // жоден із hooks (spec 2026-06-30).
    if (env.ADR_HOOKS_SKIP) {
      return
    }

    let jsonlPath: string
    try {
      const entries = ctx.sessionManager.getEntries()
      const lines = entries
        .filter(e => e.message?.role === 'user' || e.message?.role === 'assistant')
        .map(e => JSON.stringify({ type: e.message?.role, message: e.message }))
        .join('\n')
      jsonlPath = join(tmpdir(), `n-cursor-pi-transcript-${Date.now()}-${randomUUID()}.jsonl`)
      writeFileSync(jsonlPath, lines + '\n', 'utf8')
    } catch (error) {
      ctx.ui?.notify?.(`@nitra/cursor: transcript serialization failed — ${(error as Error).message}`, 'error')
      return
    }

    const stdinPayload = JSON.stringify({
      transcript_path: jsonlPath,
      session_id: ctx.sessionId ?? randomUUID()
    })

    const envOverride = { ...env, CLAUDE_PROJECT_DIR: ctx.cwd } as Record<string, string>

    // Async, не блокує agent_end. Якщо bash-скриптів немає (pi-only консьюмер
    // із claude-config: false) — pi.exec поверне ENOENT, ловимо у allSettled.
    await Promise.allSettled([
      pi.exec('bash', [CAPTURE_HOOK], {
        cwd: ctx.cwd,
        env: envOverride,
        input: stdinPayload,
        signal: ctx.signal,
        timeout: 180_000
      }),
      pi.exec('bash', [NORMALIZE_HOOK], {
        cwd: ctx.cwd,
        env: envOverride,
        input: stdinPayload,
        signal: ctx.signal,
        timeout: 600_000
      })
    ])
  })
}
