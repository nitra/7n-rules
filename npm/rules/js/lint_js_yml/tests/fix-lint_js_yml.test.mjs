/**
 * Wiring-тест: `fix-lint_js_yml.mjs` резолвить правильний target/snippet і
 * ідемпотентний на канонічному вмісті (детальні merge-кейси — у
 * `scripts/lib/tests/template-deep-merge.test.mjs`).
 */
import { expect, test } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { patterns } from '../fix-lint_js_yml.mjs'

const CONCERN_DIR = dirname(dirname(fileURLToPath(import.meta.url)))
const TARGET_PATH = '.github/workflows/lint-js.yml'
const SNIPPET_PATH = join(CONCERN_DIR, 'template', 'lint-js.yml.snippet.yml')

test('канонічний вміст → idempotent (touchedFiles порожній)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'lint-js-yml-'))
  try {
    mkdirSync(join(dir, '.github/workflows'), { recursive: true })
    writeFileSync(join(dir, TARGET_PATH), readFileSync(SNIPPET_PATH, 'utf8'), 'utf8')
    const p = patterns.find(x => x.id === 'js-lint_js_yml-template')
    const violations = [{ ruleId: 'js', concernId: 'lint_js_yml', reason: 'policy-deny', message: 'x', file: TARGET_PATH }]
    expect(p.test(violations)).toBe(true)
    const res = await p.apply(violations, { cwd: dir, concernDir: CONCERN_DIR })
    expect(res.touchedFiles).toHaveLength(0)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('бракує кроку "Eslint" → дописується, наявні кроки лишаються', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'lint-js-yml-'))
  try {
    mkdirSync(join(dir, '.github/workflows'), { recursive: true })
    const existing = ['jobs:', '  eslint:', '    steps:', '      - uses: actions/checkout@v6', ''].join('\n')
    writeFileSync(join(dir, TARGET_PATH), existing, 'utf8')
    const p = patterns.find(x => x.id === 'js-lint_js_yml-template')
    const violations = [{ ruleId: 'js', concernId: 'lint_js_yml', reason: 'policy-deny', message: 'x', file: TARGET_PATH }]
    const res = await p.apply(violations, { cwd: dir, concernDir: CONCERN_DIR })
    expect(res.touchedFiles).toHaveLength(1)
    const out = readFileSync(join(dir, TARGET_PATH), 'utf8')
    expect(out).toContain('uses: actions/checkout@v6')
    expect(out).toContain('bunx n-rules lint js --no-fix')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
