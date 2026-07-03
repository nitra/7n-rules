/**
 * Інтеграційний тест capture-decisions.sh: cross-project skip.
 * Сесія з паралельною роботою в кількох проєктах має транскрипт із tool_use-правками
 * файлів інших репо. Якщо ЖОДЕН змінений файл не під $CLAUDE_PROJECT_DIR — ADR сюди не
 * пишемо. Запускає реальний bash-скрипт; LLM-виклик блокуємо відсутністю `pi` (дефолтний
 * бекенд `CAPTURE_DECISIONS_BACKEND=pi`) — хук виходить мовчки. Розрізнюємо по логу + факту
 * створення `docs/adr/*.md`.
 */
import { describe, expect, test } from 'vitest'
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { env } from 'node:process'
import { fileURLToPath } from 'node:url'

import { withTmpDir } from '../../../scripts/utils/test-helpers.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const HOOK_SCRIPT = resolve(here, '..', '..', '..', '.claude-template', 'hooks', 'capture-decisions.sh')

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
 * @param {string} dir абсолютний шлях тимчасової директорії (CLAUDE_PROJECT_DIR + cwd для spawn)
 * @param {string} payload JSON stdin для скрипта (`{transcript_path, session_id}`)
 * @param {Record<string, string>} [extraEnv] додаткові ENV
 * @returns {{exitCode: number, log: string, adrFiles: string[]}} результат прогону
 */
function runCaptureHook(dir, payload, extraEnv = {}) {
  const result = spawnSync('bash', [HOOK_SCRIPT], {
    input: payload,
    cwd: dir,
    env: {
      PATH: '/usr/bin:/bin',
      CLAUDE_PROJECT_DIR: dir,
      HOME: env.HOME,
      LANG: env.LANG ?? 'C.UTF-8',
      LC_ALL: env.LC_ALL ?? 'C.UTF-8',
      ...extraEnv
    },
    encoding: 'utf8'
  })
  const logPath = join(dir, '.claude/hooks/capture-decisions.log')
  const log = existsSync(logPath) ? readFileSync(logPath, 'utf8') : ''
  const adrDir = join(dir, 'docs/adr')
  const adrFiles = existsSync(adrDir) ? readdirSync(adrDir) : []
  return { exitCode: result.status ?? -1, log, adrFiles }
}

describe('capture-decisions.sh — cross-project skip', () => {
  test('усі правки в чужому проєкті → skip, нічого в docs/adr/', async () => {
    await withTmpDir(async dir => {
      await mkdir(join(dir, 'docs/adr'), { recursive: true })
      const tpath = join(dir, 'transcript.jsonl')
      // file_path-и поза $CLAUDE_PROJECT_DIR (інший репо).
      await writeFile(
        tpath,
        transcriptJsonl([
          { name: 'Edit', file: '/Users/dev/other-project/src/main.ts' },
          { name: 'Write', file: '/Users/dev/other-project/README.md' }
        ])
      )
      const { log, adrFiles } = runCaptureHook(dir, JSON.stringify({ transcript_path: tpath, session_id: 'cross001' }))
      expect(log).toContain('skipping ADR capture: cross-project session')
      expect(adrFiles).toEqual([])
    })
  })

  test('змішана сесія (current + чужий) → НЕ skip (доходить до LLM-логіки)', async () => {
    await withTmpDir(async dir => {
      await mkdir(join(dir, 'docs/adr'), { recursive: true })
      const tpath = join(dir, 'transcript.jsonl')
      await writeFile(
        tpath,
        transcriptJsonl([
          { name: 'Edit', file: '/Users/dev/other-project/src/main.ts' },
          { name: 'Edit', file: join(dir, 'src/foo.ts') }
        ])
      )
      const { log } = runCaptureHook(dir, JSON.stringify({ transcript_path: tpath, session_id: 'cross002' }))
      expect(log).not.toContain('cross-project session')
      expect(log).toContain('pi not found')
    })
  })

  test('усі правки під $PROJECT_ROOT → НЕ skip', async () => {
    await withTmpDir(async dir => {
      await mkdir(join(dir, 'docs/adr'), { recursive: true })
      const tpath = join(dir, 'transcript.jsonl')
      await writeFile(tpath, transcriptJsonl([{ name: 'Edit', file: join(dir, 'src/foo.ts') }]))
      const { log } = runCaptureHook(dir, JSON.stringify({ transcript_path: tpath, session_id: 'cross003' }))
      expect(log).not.toContain('cross-project session')
      expect(log).toContain('pi not found')
    })
  })

  test('ADR_CAPTURE_SKIP_CROSS_PROJECT=0 вимикає скіп навіть для чужих правок', async () => {
    await withTmpDir(async dir => {
      await mkdir(join(dir, 'docs/adr'), { recursive: true })
      const tpath = join(dir, 'transcript.jsonl')
      await writeFile(tpath, transcriptJsonl([{ name: 'Edit', file: '/Users/dev/other-project/src/main.ts' }]))
      const { exitCode, log } = runCaptureHook(
        dir,
        JSON.stringify({ transcript_path: tpath, session_id: 'cross004' }),
        { ADR_CAPTURE_SKIP_CROSS_PROJECT: '0' }
      )
      expect(exitCode).toBe(0)
      expect(log).not.toContain('cross-project session')
    })
  })
})
