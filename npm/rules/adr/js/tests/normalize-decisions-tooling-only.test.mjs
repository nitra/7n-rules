/**
 * Інтеграційний тест normalize-decisions.sh: для чернеток сесій, де змінювалися
 * лише tooling-файли, виконувати `delete` без виклику LLM.
 */
import { describe, expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { env } from 'node:process'
import { fileURLToPath } from 'node:url'

import { withTmpCwd } from '../../../../scripts/utils/test-helpers.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const HOOK_SCRIPT = resolve(here, '..', '..', '..', '..', '.claude-template', 'hooks', 'normalize-decisions.sh')

/**
 * Build a draft markdown file content with frontmatter.
 * @param {{session: string, captured: string, transcript: string}} fm frontmatter
 * @returns {string} markdown content
 */
function draftMd(fm) {
  return `---\nsession: ${fm.session}\ncaptured: ${fm.captured}\ntranscript: ${fm.transcript}\n---\n\n## ADR Тестова чернетка\n\n## Context and Problem Statement\nstub\n`
}

/**
 * jsonl helper: assistant tool_use edits.
 * @param {Array<{name: string, file: string}>} edits масив правок
 * @returns {string} JSONL транскрипт
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
 * Run normalize-decisions.sh з обходом порогів і без LLM CLI.
 * @param {Record<string, string>} [extraEnv] додаткові ENV
 * @returns {{ exitCode: number, log: string, drafts: string[] }} результат прогону
 */
function runNormalizeHook(extraEnv = {}) {
  const result = spawnSync('bash', [HOOK_SCRIPT], {
    input: '{}',
    env: {
      PATH: '/usr/bin:/bin',
      CLAUDE_PROJECT_DIR: process.cwd(),
      HOME: env.HOME,
      ADR_NORMALIZE_THRESHOLD: '1',
      ADR_NORMALIZE_MIN_INTERVAL_HOURS: '0',
      ...extraEnv
    },
    encoding: 'utf8'
  })
  const logPath = '.claude/hooks/normalize-decisions.log'
  const log = existsSync(logPath) ? readFileSync(logPath, 'utf8') : ''
  const drafts = existsSync('docs/adr') ? readdirSync('docs/adr') : []
  return { exitCode: result.status ?? -1, log, drafts }
}

describe('normalize-decisions.sh — structural tooling-only delete', () => {
  test('tooling-only чернетка → видалена без LLM', async () => {
    await withTmpCwd(async () => {
      await mkdir('docs/adr', { recursive: true })
      const cwd = process.cwd()
      const tpath = join(cwd, 'transcript.jsonl')
      await writeFile(tpath, transcriptJsonl([{ name: 'Edit', file: join(cwd, '.cspell.json') }]))
      const draftPath = 'docs/adr/20260520-101010-foo.md'
      await writeFile(
        draftPath,
        draftMd({ session: 'sess1', captured: '2026-05-20T10:10:10+00:00', transcript: tpath })
      )
      const { log, drafts } = runNormalizeHook()
      expect(log).toContain('tooling-only')
      expect(drafts).not.toContain('20260520-101010-foo.md')
    })
  })

  test('non-tooling чернетка → лишається (LLM-крок мовчки no-op без CLI)', async () => {
    await withTmpCwd(async () => {
      await mkdir('docs/adr', { recursive: true })
      const cwd = process.cwd()
      const tpath = join(cwd, 'transcript.jsonl')
      await writeFile(tpath, transcriptJsonl([{ name: 'Edit', file: join(cwd, 'src/foo.ts') }]))
      const draftPath = 'docs/adr/20260520-101010-bar.md'
      await writeFile(
        draftPath,
        draftMd({ session: 'sess2', captured: '2026-05-20T10:10:10+00:00', transcript: tpath })
      )
      const { drafts } = runNormalizeHook()
      expect(drafts).toContain('20260520-101010-bar.md')
    })
  })

  test('батч повністю tooling-only → exit 0 без LLM', async () => {
    await withTmpCwd(async () => {
      await mkdir('docs/adr', { recursive: true })
      const cwd = process.cwd()
      const tpath = join(cwd, 'transcript.jsonl')
      await writeFile(tpath, transcriptJsonl([{ name: 'Edit', file: join(cwd, '.cspell.json') }]))
      for (const id of ['a', 'b', 'c']) {
        await writeFile(
          `docs/adr/20260520-10101${id.codePointAt(0) % 10}-${id}.md`,
          draftMd({ session: `sess${id}`, captured: '2026-05-20T10:10:10+00:00', transcript: tpath })
        )
      }
      const { log, drafts } = runNormalizeHook()
      expect(drafts.length).toBe(0)
      expect(log).not.toContain('using claude CLI')
      expect(log).not.toContain('using cursor-agent CLI')
    })
  })

  test('ADR_NORMALIZE_SKIP_TOOLING_ONLY=0 вимикає скіп', async () => {
    await withTmpCwd(async () => {
      await mkdir('docs/adr', { recursive: true })
      const cwd = process.cwd()
      const tpath = join(cwd, 'transcript.jsonl')
      await writeFile(tpath, transcriptJsonl([{ name: 'Edit', file: join(cwd, '.cspell.json') }]))
      await writeFile(
        'docs/adr/20260520-101010-foo.md',
        draftMd({ session: 'sess1', captured: '2026-05-20T10:10:10+00:00', transcript: tpath })
      )
      const { exitCode, drafts } = runNormalizeHook({ ADR_NORMALIZE_SKIP_TOOLING_ONLY: '0' })
      expect(exitCode).toBe(0)
      // Skip вимкнено, LLM CLI відсутній → чернетка лишається.
      expect(drafts).toContain('20260520-101010-foo.md')
    })
  })
})
