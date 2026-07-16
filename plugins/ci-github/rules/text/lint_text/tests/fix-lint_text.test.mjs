/**
 * Wiring-тест: `fix-lint_text.mjs` резолвить правильний target/snippet і
 * ідемпотентний на канонічному вмісті (детальні merge-кейси — у
 * `scripts/lib/tests/template-deep-merge.test.mjs`).
 */
import { expect, test } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { patterns } from '../fix-lint_text.mjs'

const CONCERN_DIR = dirname(dirname(fileURLToPath(import.meta.url)))
const TARGET_PATH = '.github/workflows/lint-text.yml'
const SNIPPET_PATH = join(CONCERN_DIR, 'template', 'lint-text.yml.snippet.yml')

test('канонічний вміст → idempotent (touchedFiles порожній)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'lint-text-yml-'))
  try {
    mkdirSync(join(dir, '.github/workflows'), { recursive: true })
    writeFileSync(join(dir, TARGET_PATH), readFileSync(SNIPPET_PATH, 'utf8'), 'utf8')
    const p = patterns.find(x => x.id === 'text-lint_text-template')
    const violations = [
      { ruleId: 'text', concernId: 'lint_text', reason: 'policy-deny', message: 'x', file: TARGET_PATH }
    ]
    expect(p.test(violations)).toBe(true)
    const res = await p.apply(violations, { cwd: dir, concernDir: CONCERN_DIR })
    expect(res.touchedFiles).toHaveLength(0)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('файл відсутній → створюється зі snippet', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'lint-text-yml-'))
  try {
    const p = patterns.find(x => x.id === 'text-lint_text-template')
    const violations = [
      { ruleId: 'text', concernId: 'lint_text', reason: 'policy-file-missing', message: 'x', file: TARGET_PATH }
    ]
    const res = await p.apply(violations, { cwd: dir, concernDir: CONCERN_DIR })
    expect(res.touchedFiles).toHaveLength(1)
    expect(readFileSync(join(dir, TARGET_PATH), 'utf8')).toBe(readFileSync(SNIPPET_PATH, 'utf8'))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
