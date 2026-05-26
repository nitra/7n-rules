/**
 * Інтеграційний тест capture-decisions.sh: structural skip для tooling-only сесій.
 * Запускає реальний bash-скрипт; LLM-виклик блокуємо порожнім PATH (без `claude` /
 * `cursor-agent` хук виходить мовчки). Розрізнюємо tooling-only vs normal по логу
 * + фактом створення `docs/adr/*.md`.
 */
import { describe, expect, test } from 'vitest'
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { env } from 'node:process'
import { fileURLToPath } from 'node:url'

import { withTmpCwd } from '../../../../scripts/utils/test-helpers.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const HOOK_SCRIPT = resolve(here, '..', '..', '..', '..', '.claude-template', 'hooks', 'capture-decisions.sh')

/**
 * Build a JSONL transcript with given tool_use edits.
 * @param {Array<{name: string, file: string}>} edits масив правок
 * @returns {string} jsonl content
 */
function transcriptJsonl(edits) {
  return edits
    .map(e =>
      JSON.stringify({
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [{ type: 'tool_use', name: e.name, input: { file_path: e.file } }]
        }
      })
    )
    .join('\n')
}

/**
 * Run capture-decisions.sh in tmp cwd with empty PATH-сегмент для LLM CLI.
 * @param {string} payload JSON stdin для скрипта (`{transcript_path, session_id}`)
 * @param {Record<string, string>} [extraEnv] додаткові ENV
 * @returns {{exitCode: number, log: string, adrFiles: string[]}} результат прогону
 */
function runCaptureHook(payload, extraEnv = {}) {
  const result = spawnSync('bash', [HOOK_SCRIPT], {
    input: payload,
    env: {
      // Тільки системні шляхи без `claude`/`cursor-agent`.
      PATH: '/usr/bin:/bin',
      CLAUDE_PROJECT_DIR: process.cwd(),
      HOME: env.HOME,
      ...extraEnv
    },
    encoding: 'utf8'
  })
  const logPath = '.claude/hooks/capture-decisions.log'
  const log = existsSync(logPath) ? readFileSync(logPath, 'utf8') : ''
  const adrFiles = existsSync('docs/adr') ? readdirSync('docs/adr') : []
  return { exitCode: result.status ?? -1, log, adrFiles }
}

describe('capture-decisions.sh — structural tooling-only skip', () => {
  test('tooling-only: лише `.cspell.json` → skip, нічого в docs/adr/', async () => {
    await withTmpCwd(async () => {
      await mkdir('docs/adr', { recursive: true })
      const cwd = process.cwd()
      const tpath = join(cwd, 'transcript.jsonl')
      await writeFile(tpath, transcriptJsonl([{ name: 'Edit', file: join(cwd, '.cspell.json') }]))
      const { log, adrFiles } = runCaptureHook(JSON.stringify({ transcript_path: tpath, session_id: 'abc12345' }))
      expect(log).toContain('skipping ADR capture: tooling-only session')
      expect(adrFiles).toEqual([])
    })
  })

  test('tooling-only: лише docs/adr/ + CHANGELOG → skip', async () => {
    await withTmpCwd(async () => {
      await mkdir('docs/adr', { recursive: true })
      const cwd = process.cwd()
      const tpath = join(cwd, 'transcript.jsonl')
      await writeFile(
        tpath,
        transcriptJsonl([
          { name: 'Write', file: join(cwd, 'docs/adr/20260520-101010-foo.md') },
          { name: 'Edit', file: join(cwd, 'CHANGELOG.md') }
        ])
      )
      const { log, adrFiles } = runCaptureHook(JSON.stringify({ transcript_path: tpath, session_id: 'abc12346' }))
      expect(log).toContain('tooling-only session')
      expect(adrFiles).toEqual([])
    })
  })

  test('non-tooling: правка `src/foo.ts` → НЕ skip (хук іде до LLM-логіки)', async () => {
    await withTmpCwd(async () => {
      await mkdir('docs/adr', { recursive: true })
      const cwd = process.cwd()
      const tpath = join(cwd, 'transcript.jsonl')
      await writeFile(
        tpath,
        transcriptJsonl([
          { name: 'Edit', file: join(cwd, 'src/foo.ts') },
          { name: 'Edit', file: join(cwd, '.cspell.json') }
        ])
      )
      const { log } = runCaptureHook(JSON.stringify({ transcript_path: tpath, session_id: 'abc12347' }))
      // Без LLM CLI хук доходить до перевірки і виходить з "no LLM CLI found".
      // НЕ повинно містити tooling-only skip.
      expect(log).not.toContain('tooling-only session')
      expect(log).toContain('no LLM CLI found')
    })
  })

  test('ADR_NORMALIZE_SKIP_TOOLING_ONLY=0 вимикає скіп навіть для чистого tooling', async () => {
    await withTmpCwd(async () => {
      await mkdir('docs/adr', { recursive: true })
      const cwd = process.cwd()
      const tpath = join(cwd, 'transcript.jsonl')
      await writeFile(tpath, transcriptJsonl([{ name: 'Edit', file: join(cwd, '.cspell.json') }]))
      const { exitCode, log } = runCaptureHook(JSON.stringify({ transcript_path: tpath, session_id: 'abc12348' }), {
        ADR_NORMALIZE_SKIP_TOOLING_ONLY: '0'
      })
      expect(exitCode).toBe(0)
      expect(log).not.toContain('tooling-only session')
    })
  })
})
