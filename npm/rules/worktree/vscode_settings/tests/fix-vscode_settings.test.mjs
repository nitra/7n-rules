/**
 * Wiring-тест: T0-фікс концерну резолвить правильний target/snippet і
 * ідемпотентний на канонічному вмісті (детальні merge-кейси — у
 * `crates/rules-core/src/concerns/fix_template_merge.rs` та
 * `scripts/lib/tests/template-deep-merge.test.mjs` для інших споживачів рушія).
 *
 * Фікс — native (`fix_template_merge::worktree_vscode_settings_fix`, §2.74);
 * JS-канон `fix-vscode_settings.mjs` знято §2.89. Патерн береться з
 * `loadT0Patterns` — тим самим резолвером, яким ходить прод (`run-fix.mjs`).
 *
 * Свідома різниця форми проти канону: `test()` native-патерну — це «план для
 * цих violations непорожній» (доккомент `nativeFixPattern`), тож на
 * КАНОНІЧНОМУ вмісті він тепер `false`, а не `true` з подальшим порожнім
 * `touchedFiles`. Кінцевий стан диска — той самий: нічого не переписано.
 */
import { describe, expect, test } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { loadT0Patterns } from '../../../../scripts/lib/lint-surface/run-fix.mjs'

const CONCERN_DIR = dirname(dirname(fileURLToPath(import.meta.url)))
const TARGET_PATH = '.vscode/settings.json'
const SNIPPET_PATH = join(CONCERN_DIR, 'template', 'settings.json.snippet.json')

/**
 * НОВИЙ масив на кожен виклик: native-план кешується у `WeakMap` за identity
 * масиву (`nativeFixPlanCache`, `run-fix.mjs`), тож спільний літерал між
 * кейсами віддавав би план попереднього дерева.
 * @returns {object[]} масив з однієї violation концерну
 */
const violations = () => [
  { ruleId: 'worktree', concernId: 'vscode_settings', reason: 'x', message: 'x', file: TARGET_PATH }
]

/** Мінімальний FixContext: T0 — permanent-фаза, запис не відстежується. */
const CTX = {
  recordWrite() {
    // навмисний no-op
  }
}

/**
 * Резолвить T0-патерн концерну так само, як прод, і вимагає РІВНО одного native.
 * @param {string} dir tmp-корінь як cwd
 * @returns {Promise<import('../../../../scripts/lib/lint-surface/types.mjs').T0Pattern>} єдиний патерн концерну
 */
async function patternFor(dir) {
  const patterns = await loadT0Patterns(CONCERN_DIR, 'vscode_settings', 'worktree', dir)
  // Нуль патернів = `--fix` МОВЧКИ перестав фіксити концерн (§2.89): падаємо голосно.
  expect(patterns).toHaveLength(1)
  expect(patterns[0].id).toBe('native-fix:worktree/vscode_settings')
  return patterns[0]
}

test('канонічний вміст → idempotent (план порожній, файл не переписано)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'vscode-settings-'))
  try {
    mkdirSync(join(dir, '.vscode'), { recursive: true })
    const canonical = readFileSync(SNIPPET_PATH, 'utf8')
    writeFileSync(join(dir, TARGET_PATH), canonical, 'utf8')
    const p = await patternFor(dir)
    expect(p.test(violations())).toBe(false)
    const res = await p.apply(violations(), CTX)
    expect(res.touchedFiles).toHaveLength(0)
    expect(readFileSync(join(dir, TARGET_PATH), 'utf8')).toBe(canonical)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('target є, але не канонічний', () => {
  test('search.exclude/files.exclude домерджуються поверх існуючого', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'vscode-settings-'))
    try {
      mkdirSync(join(dir, '.vscode'), { recursive: true })
      writeFileSync(join(dir, TARGET_PATH), JSON.stringify({ 'editor.tabSize': 2 }, null, 2) + '\n', 'utf8')
      const p = await patternFor(dir)
      expect(p.test(violations())).toBe(true)
      const res = await p.apply(violations(), CTX)
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
