/**
 * Характеризаційний гейт (JS-канон ДО порту в `crates/plugin-ci-github`):
 * `fix-lint_docker_yml.mjs` резолвить правильний target/snippet і
 * ідемпотентний на канонічному вмісті (детальні merge-кейси — у
 * `scripts/lib/tests/template-deep-merge.test.mjs`).
 */
import { expect, test } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { patterns } from '../fix-lint_docker_yml.mjs'

const CONCERN_DIR = dirname(dirname(fileURLToPath(import.meta.url)))
const TARGET_PATH = '.github/workflows/lint-docker.yml'
const SNIPPET_PATH = join(CONCERN_DIR, 'template', 'lint-docker.yml.snippet.yml')

test('канонічний вміст → idempotent (touchedFiles порожній)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'lint-docker-yml-'))
  try {
    mkdirSync(join(dir, '.github/workflows'), { recursive: true })
    writeFileSync(join(dir, TARGET_PATH), readFileSync(SNIPPET_PATH, 'utf8'), 'utf8')
    const p = patterns.find(x => x.id === 'docker-lint_docker_yml-template')
    const violations = [
      { ruleId: 'docker', concernId: 'lint_docker_yml', reason: 'policy-deny', message: 'x', file: TARGET_PATH }
    ]
    expect(p.test(violations)).toBe(true)
    const res = await p.apply(violations, { cwd: dir, concernDir: CONCERN_DIR })
    expect(res.touchedFiles).toHaveLength(0)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('файл відсутній → створюється зі snippet', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'lint-docker-yml-'))
  try {
    const p = patterns.find(x => x.id === 'docker-lint_docker_yml-template')
    const violations = [
      { ruleId: 'docker', concernId: 'lint_docker_yml', reason: 'policy-file-missing', message: 'x', file: TARGET_PATH }
    ]
    const res = await p.apply(violations, { cwd: dir, concernDir: CONCERN_DIR })
    expect(res.touchedFiles).toHaveLength(1)
    expect(readFileSync(join(dir, TARGET_PATH), 'utf8')).toBe(readFileSync(SNIPPET_PATH, 'utf8'))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
