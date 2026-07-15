/**
 * Wiring-тест: `fix-vscode_settings.mjs` резолвить правильний target/snippet і
 * ідемпотентний на канонічному вмісті (детальні merge-кейси — у
 * `scripts/lib/tests/template-deep-merge.test.mjs`).
 */
import { describe, expect, test } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { patterns } from '../fix-vscode_settings.mjs'

const CONCERN_DIR = dirname(dirname(fileURLToPath(import.meta.url)))
const TARGET_PATH = '.vscode/settings.json'
const SNIPPET_PATH = join(CONCERN_DIR, 'template', 'settings.json.snippet.json')

test('канонічний вміст → idempotent (touchedFiles порожній)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'vscode-settings-'))
  try {
    mkdirSync(join(dir, '.vscode'), { recursive: true })
    writeFileSync(join(dir, TARGET_PATH), readFileSync(SNIPPET_PATH, 'utf8'), 'utf8')
    const p = patterns.find(x => x.id === 'worktree-vscode_settings-template')
    const violations = [
      { ruleId: 'worktree', concernId: 'vscode_settings', reason: 'x', message: 'x', file: TARGET_PATH }
    ]
    expect(p.test(violations)).toBe(true)
    const res = await p.apply(violations, { cwd: dir, concernDir: CONCERN_DIR })
    expect(res.touchedFiles).toHaveLength(0)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('target є, але не обʼєкт', () => {
  test('search.exclude/files.exclude домерджуються поверх існуючого', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'vscode-settings-'))
    try {
      mkdirSync(join(dir, '.vscode'), { recursive: true })
      writeFileSync(join(dir, TARGET_PATH), JSON.stringify({ 'editor.tabSize': 2 }, null, 2) + '\n', 'utf8')
      const p = patterns.find(x => x.id === 'worktree-vscode_settings-template')
      const violations = [
        { ruleId: 'worktree', concernId: 'vscode_settings', reason: 'x', message: 'x', file: TARGET_PATH }
      ]
      const res = await p.apply(violations, { cwd: dir, concernDir: CONCERN_DIR })
      expect(res.touchedFiles).toHaveLength(1)
      const written = JSON.parse(readFileSync(join(dir, TARGET_PATH), 'utf8'))
      expect(written['search.exclude']['**/.worktrees/**']).toBe(true)
      expect(written['files.exclude']['**/.worktrees/**']).toBe(true)
      expect(written['editor.tabSize']).toBe(2)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
