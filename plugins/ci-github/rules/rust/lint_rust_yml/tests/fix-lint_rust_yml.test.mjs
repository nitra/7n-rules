/**
 * Wiring-тест: `fix-lint_rust_yml.mjs` резолвить правильний target/snippet і
 * ідемпотентний на канонічному вмісті (детальні merge-кейси — у
 * `scripts/lib/tests/template-deep-merge.test.mjs`).
 */
import { expect, test } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { patterns } from '../fix-lint_rust_yml.mjs'

const CONCERN_DIR = dirname(dirname(fileURLToPath(import.meta.url)))
const TARGET_PATH = '.github/workflows/lint-rust.yml'
const SNIPPET_PATH = join(CONCERN_DIR, 'template', 'lint-rust.yml.snippet.yml')

test('файл відсутній (policy-file-missing) → створюється зі snippet', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'lint-rust-yml-'))
  try {
    const p = patterns.find(x => x.id === 'rust-lint_rust_yml-template')
    const violations = [
      { ruleId: 'rust', concernId: 'lint_rust_yml', reason: 'policy-file-missing', message: 'x', file: TARGET_PATH }
    ]
    expect(p.test(violations)).toBe(true)
    const res = await p.apply(violations, { cwd: dir, concernDir: CONCERN_DIR })
    expect(res.touchedFiles).toHaveLength(1)
    expect(readFileSync(join(dir, TARGET_PATH), 'utf8')).toBe(readFileSync(SNIPPET_PATH, 'utf8'))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
