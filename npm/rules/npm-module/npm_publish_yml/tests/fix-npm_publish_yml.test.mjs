/**
 * Wiring-тест: `fix-npm_publish_yml.mjs` резолвить правильний target/snippet і
 * ідемпотентний на канонічному вмісті (детальні merge-кейси — у
 * `scripts/lib/tests/template-deep-merge.test.mjs`).
 */
import { describe, expect, test } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { patterns } from '../fix-npm_publish_yml.mjs'

const CONCERN_DIR = dirname(dirname(fileURLToPath(import.meta.url)))
const TARGET_PATH = '.github/workflows/npm-publish.yml'
const SNIPPET_PATH = join(CONCERN_DIR, 'template', 'npm-publish.yml.snippet.yml')

test('канонічний вміст → idempotent (touchedFiles порожній)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'npm-publish-yml-'))
  try {
    mkdirSync(join(dir, '.github/workflows'), { recursive: true })
    writeFileSync(join(dir, TARGET_PATH), readFileSync(SNIPPET_PATH, 'utf8'), 'utf8')
    const p = patterns.find(x => x.id === 'npm-module-npm_publish_yml-template')
    const violations = [{ ruleId: 'npm-module', concernId: 'npm_publish_yml', reason: 'x', message: 'x', file: TARGET_PATH }]
    expect(p.test(violations)).toBe(true)
    const res = await p.apply(violations, { cwd: dir, concernDir: CONCERN_DIR })
    expect(res.touchedFiles).toHaveLength(0)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('target відсутній', () => {
  test('створюється зі snippet', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'npm-publish-yml-'))
    try {
      const p = patterns.find(x => x.id === 'npm-module-npm_publish_yml-template')
      const violations = [{ ruleId: 'npm-module', concernId: 'npm_publish_yml', reason: 'x', message: 'x', file: TARGET_PATH }]
      const res = await p.apply(violations, { cwd: dir, concernDir: CONCERN_DIR })
      expect(res.touchedFiles).toHaveLength(1)
      expect(readFileSync(join(dir, TARGET_PATH), 'utf8')).toBe(readFileSync(SNIPPET_PATH, 'utf8'))
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
