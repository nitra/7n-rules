/**
 * Інтеграційний тест normalize-decisions.sh: для чернеток сесій, де змінювалися
 * лише tooling-файли, виконувати `delete` без виклику LLM.
 */
import { describe, expect, test } from 'vitest'
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { chmod, mkdir, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { env } from 'node:process'
import { fileURLToPath } from 'node:url'

import { withTmpDir } from '../../../../scripts/utils/test-helpers.mjs'

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
 * @param {string} dir абсолютний шлях тимчасового каталогу (CLAUDE_PROJECT_DIR + cwd)
 * @param {Record<string, string>} [extraEnv] додаткові ENV
 * @returns {{ exitCode: number, log: string, drafts: string[] }} результат прогону
 */
function runNormalizeHook(dir, extraEnv = {}) {
  const result = spawnSync('bash', [HOOK_SCRIPT], {
    input: '{}',
    cwd: dir,
    env: {
      PATH: '/usr/bin:/bin',
      CLAUDE_PROJECT_DIR: dir,
      HOME: env.HOME,
      LANG: env.LANG ?? 'C.UTF-8',
      LC_ALL: env.LC_ALL ?? 'C.UTF-8',
      ADR_NORMALIZE_THRESHOLD: '1',
      ADR_NORMALIZE_MIN_INTERVAL_HOURS: '0',
      ...extraEnv
    },
    encoding: 'utf8'
  })
  const logPath = join(dir, '.claude/hooks/normalize-decisions.log')
  const log = existsSync(logPath) ? readFileSync(logPath, 'utf8') : ''
  const adrDir = join(dir, 'docs/adr')
  const drafts = existsSync(adrDir) ? readdirSync(adrDir) : []
  return { exitCode: result.status ?? -1, log, drafts }
}

describe('normalize-decisions.sh — structural tooling-only delete', () => {
  test('tooling-only чернетка → видалена без LLM', async () => {
    await withTmpDir(async dir => {
      await mkdir(join(dir, 'docs/adr'), { recursive: true })
      const tpath = join(dir, 'transcript.jsonl')
      await writeFile(tpath, transcriptJsonl([{ name: 'Edit', file: join(dir, '.cspell.json') }]))
      const draftPath = join(dir, 'docs/adr/20260520-101010-foo.md')
      await writeFile(
        draftPath,
        draftMd({ session: 'sess1', captured: '2026-05-20T10:10:10+00:00', transcript: tpath })
      )
      const { log, drafts } = runNormalizeHook(dir)
      expect(log).toContain('tooling-only')
      expect(drafts).not.toContain('20260520-101010-foo.md')
    })
  })

  test('non-tooling чернетка → лишається (LLM-крок мовчки no-op без CLI)', async () => {
    await withTmpDir(async dir => {
      await mkdir(join(dir, 'docs/adr'), { recursive: true })
      const tpath = join(dir, 'transcript.jsonl')
      await writeFile(tpath, transcriptJsonl([{ name: 'Edit', file: join(dir, 'src/foo.ts') }]))
      const draftPath = join(dir, 'docs/adr/20260520-101010-bar.md')
      await writeFile(
        draftPath,
        draftMd({ session: 'sess2', captured: '2026-05-20T10:10:10+00:00', transcript: tpath })
      )
      const { drafts } = runNormalizeHook(dir)
      expect(drafts).toContain('20260520-101010-bar.md')
    })
  })

  test('батч повністю tooling-only → exit 0 без LLM', async () => {
    await withTmpDir(async dir => {
      await mkdir(join(dir, 'docs/adr'), { recursive: true })
      const tpath = join(dir, 'transcript.jsonl')
      await writeFile(tpath, transcriptJsonl([{ name: 'Edit', file: join(dir, '.cspell.json') }]))
      for (const id of ['a', 'b', 'c']) {
        await writeFile(
          join(dir, `docs/adr/20260520-10101${id.codePointAt(0) % 10}-${id}.md`),
          draftMd({ session: `sess${id}`, captured: '2026-05-20T10:10:10+00:00', transcript: tpath })
        )
      }
      const { log, drafts } = runNormalizeHook(dir)
      expect(drafts.length).toBe(0)
      expect(log).not.toContain('using claude CLI')
      expect(log).not.toContain('using cursor-agent CLI')
    })
  })

  test('ADR_NORMALIZE_SKIP_TOOLING_ONLY=0 вимикає скіп', async () => {
    await withTmpDir(async dir => {
      await mkdir(join(dir, 'docs/adr'), { recursive: true })
      const tpath = join(dir, 'transcript.jsonl')
      await writeFile(tpath, transcriptJsonl([{ name: 'Edit', file: join(dir, '.cspell.json') }]))
      await writeFile(
        join(dir, 'docs/adr/20260520-101010-foo.md'),
        draftMd({ session: 'sess1', captured: '2026-05-20T10:10:10+00:00', transcript: tpath })
      )
      const { exitCode, drafts } = runNormalizeHook(dir, { ADR_NORMALIZE_SKIP_TOOLING_ONLY: '0' })
      expect(exitCode).toBe(0)
      // Skip вимкнено, LLM CLI відсутній → чернетка лишається.
      expect(drafts).toContain('20260520-101010-foo.md')
    })
  })

  test('rewrite зберігає YYMMDD-HHMM-префікс короткої чернетки', async () => {
    await withTmpDir(async dir => {
      await mkdir(join(dir, 'docs/adr'), { recursive: true })
      await mkdir(join(dir, 'bin'), { recursive: true })
      const fakeClaude = join(dir, 'bin', 'claude')
      await writeFile(
        fakeClaude,
        [
          '#!/usr/bin/env bash',
          'cat >/dev/null',
          String.raw`printf '%s\n' '{"operations":[{"op":"rewrite","file":"260520-1010-foo.md","slug":"bar","content":"# Bar\\n\\n**Status:** Accepted\\n**Date:** 2026-05-20\\n"}]}'`,
          ''
        ].join('\n'),
        'utf8'
      )
      await chmod(fakeClaude, 0o755)

      const draftPath = join(dir, 'docs/adr/260520-1010-foo.md')
      await writeFile(
        draftPath,
        draftMd({ session: 'sess1', captured: '2026-05-20T10:10:10+00:00', transcript: join(dir, 'missing.jsonl') })
      )

      const { drafts } = runNormalizeHook(dir, { PATH: `${join(dir, 'bin')}:/usr/bin:/bin` })
      expect(drafts).toContain('260520-1010-bar.md')
      expect(drafts).not.toContain('bar.md')
      expect(drafts).not.toContain('260520-1010-foo.md')
    })
  })
})
