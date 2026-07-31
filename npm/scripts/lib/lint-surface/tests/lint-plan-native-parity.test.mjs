/**
 * Parity-гейт P1 фази 7 (`docs/specs/2026-07-30-rules-v2-rust-core-migration.md`
 * §4): звіряє native `buildLintPlan`/`matchLintGlobs`
 * (`crates/rules-core/src/lint_plan.rs` через `rules-napi`) проти
 * ЗАМОРОЖЕНОЇ копії старого JS-алгоритму (picomatch-based), який раніше жив
 * у `run-detectors.mjs` (buildScopedPlan/buildScopedDeltaPlan/buildRepoWidePlan/
 * buildFullPlan/buildDeltaPlan/planConcernForDelta — усі видалені з продакшн-коду
 * після цього гейту). Копія тут — навмисно НЕ імпорт із продакшн-модуля
 * (той більше не містить цієї гілки): це незалежний reference-oracle,
 * звірений на кількох синтетичних фікстурах + на РЕАЛЬНИХ glob-патернах з
 * `npm/rules/**\/concern.json`.
 *
 * Друга частина файлу — прямий picomatch ⇄ `matchLintGlobs` glob-семантики
 * (dot:true, globstar, brace-alternation, одинарний `*` у межах сегмента)
 * на конкретних патернах, які реально живуть у concern.json ядра.
 */
import { describe, expect, test } from 'vitest'
import picomatch from 'picomatch'

import { loadNative } from '../../native.mjs'

// --- Заморожена копія старого JS-алгоритму (до видалення з run-detectors.mjs) ---

/**
 * @typedef {{ name: string, lint: { scope: string, glob: string[] } }} LegacyConcern
 */

/**
 * @param {string} ruleId rule-id concern-а.
 * @param {LegacyConcern} concern concern із lint-поверхнею.
 * @param {string[]} changed перелік змінених файлів.
 * @returns {{ ruleId: string, concernId: string, files: string[]|undefined }|null} plan-item або null.
 */
function legacyPlanConcernForDelta(ruleId, concern, changed) {
  const { scope, glob } = concern.lint
  const isMatch = glob.length > 0 ? picomatch(glob, { dot: true }) : () => false
  if (scope === 'per-file') {
    const files = glob.length > 0 ? changed.filter(f => isMatch(f)) : changed
    return files.length > 0 ? { ruleId, concernId: concern.name, files } : null
  }
  if (glob.length > 0 && changed.some(f => isMatch(f))) {
    return { ruleId, concernId: concern.name, files: undefined }
  }
  return null
}

/**
 * @param {Record<string, LegacyConcern[]>} byRule concerns за rule-id.
 * @param {string[]} rules scoped rule-id.
 * @returns {{ ruleId: string, concernId: string, files: string[]|undefined }[]} план.
 */
function legacyBuildScopedPlan(byRule, rules) {
  const plan = []
  for (const ruleId of rules) {
    for (const concern of byRule[ruleId] ?? []) plan.push({ ruleId, concernId: concern.name, files: undefined })
  }
  return plan.toSorted((a, b) => a.ruleId.localeCompare(b.ruleId))
}

/**
 * @param {Record<string, LegacyConcern[]>} byRule concerns за rule-id.
 * @param {string[]} rules scoped rule-id.
 * @param {string[]} files явний файловий набір.
 * @returns {{ ruleId: string, concernId: string, files: string[]|undefined }[]} план.
 */
function legacyBuildScopedDeltaPlan(byRule, rules, files) {
  const plan = []
  for (const ruleId of rules) {
    for (const concern of byRule[ruleId] ?? []) {
      if (concern.lint.scope !== 'per-file') continue
      const item = legacyPlanConcernForDelta(ruleId, concern, files)
      if (item) plan.push(item)
    }
  }
  return plan.toSorted((a, b) => a.ruleId.localeCompare(b.ruleId) || a.concernId.localeCompare(b.concernId))
}

/**
 * @param {Record<string, LegacyConcern[]>} byRule concerns за rule-id.
 * @param {Set<string>} enabledSet активні rule-id.
 * @returns {{ ruleId: string, concernId: string, files: string[]|undefined }[]} план.
 */
function legacyBuildRepoWidePlan(byRule, enabledSet) {
  const entries = []
  for (const [ruleId, concerns] of Object.entries(byRule)) {
    if (!enabledSet.has(ruleId)) continue
    for (const concern of concerns) {
      if (concern.lint.scope === 'full') entries.push({ ruleId, concernId: concern.name })
    }
  }
  return entries
    .toSorted((a, b) => a.ruleId.localeCompare(b.ruleId) || a.concernId.localeCompare(b.concernId))
    .map(e => ({ ...e, files: undefined }))
}

/**
 * @param {Record<string, LegacyConcern[]>} byRule concerns за rule-id.
 * @param {Set<string>} enabledSet активні rule-id.
 * @returns {{ ruleId: string, concernId: string, files: string[]|undefined }[]} план.
 */
function legacyBuildFullPlan(byRule, enabledSet) {
  const entries = []
  for (const [ruleId, concerns] of Object.entries(byRule)) {
    if (!enabledSet.has(ruleId)) continue
    for (const concern of concerns) entries.push({ ruleId, concernId: concern.name })
  }
  return entries
    .toSorted((a, b) => a.ruleId.localeCompare(b.ruleId) || a.concernId.localeCompare(b.concernId))
    .map(e => ({ ...e, files: undefined }))
}

/**
 * @param {Record<string, LegacyConcern[]>} byRule concerns за rule-id.
 * @param {Set<string>} enabledSet активні rule-id.
 * @param {string[]} changed перелік змінених файлів.
 * @param {{ perFileOnly?: boolean }} [opts] фільтр full-scope concerns.
 * @returns {{ ruleId: string, concernId: string, files: string[]|undefined }[]} план.
 */
function legacyBuildDeltaPlan(byRule, enabledSet, changed, { perFileOnly = false } = {}) {
  const plan = []
  for (const [ruleId, concerns] of Object.entries(byRule)) {
    if (!enabledSet.has(ruleId)) continue
    for (const concern of concerns) {
      if (perFileOnly && concern.lint.scope !== 'per-file') continue
      const item = legacyPlanConcernForDelta(ruleId, concern, changed)
      if (item) plan.push(item)
    }
  }
  return plan.toSorted((a, b) => a.ruleId.localeCompare(b.ruleId) || a.concernId.localeCompare(b.concernId))
}

// --- Синтетичні фікстури -----------------------------------------------------

const FIXTURE_MIXED = {
  probe: [
    { name: 'perfile', lint: { scope: 'per-file', glob: ['**/*.js'] } },
    { name: 'wholerepo', lint: { scope: 'full', glob: ['**/*.js'] } },
    { name: 'noglob', lint: { scope: 'full', glob: [] } }
  ],
  other: [{ name: 'check', lint: { scope: 'per-file', glob: ['**/*.md'] } }],
  disabled: [{ name: 'full', lint: { scope: 'full', glob: ['**/*'] } }]
}

const FIXTURE_REAL_GLOBS = {
  js: [
    { name: 'eslint', lint: { scope: 'per-file', glob: ['**/*.{js,mjs,cjs,jsx,ts,tsx,mts,cts,vue,css,scss}'] } },
    { name: 'knip', lint: { scope: 'full', glob: [] } }
  ],
  'npm-module': [
    { name: 'pkg', lint: { scope: 'full', glob: ['**/package.json', '**/tauri.conf.json', '**/src-tauri/**'] } }
  ],
  security: [{ name: 'env_dns', lint: { scope: 'per-file', glob: ['**/.env', '**/.env.*'] } }],
  image: [{ name: 'formats', lint: { scope: 'per-file', glob: ['**/*.{jpg,jpeg,png,svg,gif,webp}'] } }]
}

const FIXTURE_DOTFILES = {
  text: [
    {
      name: 'prettierignore',
      lint: { scope: 'per-file', glob: ['.prettierignore', '.prettierrc*', 'prettier.config.*'] }
    }
  ]
}

/** @type {Array<{ label: string, byRule: Record<string, LegacyConcern[]> }>} */
const FIXTURES = [
  { label: 'mixed per-file/full/noglob', byRule: FIXTURE_MIXED },
  { label: 'real repo glob patterns (brace/double-star)', byRule: FIXTURE_REAL_GLOBS },
  { label: 'dot-file patterns', byRule: FIXTURE_DOTFILES }
]

const CHANGED_SETS = [
  ['src/a.js', 'README.md', 'docs/x.md'],
  ['package.json', 'src-tauri/tauri.conf.json', '.env', '.env.production', 'nested/deep/img.png'],
  ['.prettierignore', 'sub/.prettierrc.json', 'prettier.config.js'],
  []
]

/**
 * @param {{ ruleId: string, concernId: string, files: string[]|undefined }[]} items результат.
 * @returns {{ ruleId: string, concernId: string, files: string[]|undefined }[]} нормалізовані (files undefined замість [] відсутнє) для порівняння.
 */
function normalize(items) {
  return items.map(i => ({ ruleId: i.ruleId, concernId: i.concernId, files: i.files ?? undefined }))
}

describe('lint_plan native ⇄ JS-reference parity (P1 фази 7)', () => {
  for (const { label, byRule } of FIXTURES) {
    describe(`fixture: ${label}`, () => {
      const rules = Object.keys(byRule)

      test('scoped', () => {
        const native = normalize(loadNative().buildLintPlan({ mode: 'scoped', byRule, rules }))
        const legacy = normalize(legacyBuildScopedPlan(byRule, rules))
        expect(native).toEqual(legacy)
      })

      for (const changed of CHANGED_SETS) {
        test(`scopedDelta × changed=${JSON.stringify(changed)}`, () => {
          const native = normalize(
            loadNative().buildLintPlan({ mode: 'scopedDelta', byRule, rules, explicitFiles: changed })
          )
          const legacy = normalize(legacyBuildScopedDeltaPlan(byRule, rules, changed))
          expect(native).toEqual(legacy)
        })

        test(`delta × changed=${JSON.stringify(changed)}`, () => {
          const enabledRuleIds = rules
          const enabledSet = new Set(enabledRuleIds)
          const native = normalize(loadNative().buildLintPlan({ mode: 'delta', byRule, enabledRuleIds, changed }))
          const legacy = normalize(legacyBuildDeltaPlan(byRule, enabledSet, changed))
          expect(native).toEqual(legacy)
        })

        test(`delta pathMode × changed=${JSON.stringify(changed)}`, () => {
          const enabledRuleIds = rules
          const enabledSet = new Set(enabledRuleIds)
          const native = normalize(
            loadNative().buildLintPlan({ mode: 'delta', byRule, enabledRuleIds, changed, pathMode: true })
          )
          const legacy = normalize(legacyBuildDeltaPlan(byRule, enabledSet, changed, { perFileOnly: true }))
          expect(native).toEqual(legacy)
        })
      }

      test('repoWide', () => {
        const enabledRuleIds = rules
        const enabledSet = new Set(enabledRuleIds)
        const native = normalize(loadNative().buildLintPlan({ mode: 'repoWide', byRule, enabledRuleIds }))
        const legacy = normalize(legacyBuildRepoWidePlan(byRule, enabledSet))
        expect(native).toEqual(legacy)
      })

      test('full', () => {
        const enabledRuleIds = rules
        const enabledSet = new Set(enabledRuleIds)
        const native = normalize(loadNative().buildLintPlan({ mode: 'full', byRule, enabledRuleIds }))
        const legacy = normalize(legacyBuildFullPlan(byRule, enabledSet))
        expect(native).toEqual(legacy)
      })
    })
  }
})

// --- Пряма glob-семантика: picomatch ⇄ matchLintGlobs -------------------------

/** Реальні glob-масиви з `npm/rules/**\/concern.json` (репрезентативна вибірка сімейств патернів). */
const REAL_GLOB_PATTERNS = [
  ['**/*'],
  ['**/*.env'],
  ['**/*.json', '**/*.json5', '**/*.yml', '**/*.yaml', '**/*.toml'],
  ['**/*.md', '**/*.mdc'],
  ['**/*.{jpg,jpeg,png,svg,gif,webp}'],
  ['**/*.{js,mjs,cjs,jsx,ts,tsx,mts,cts,vue,css,scss}'],
  ['**/.env', '**/.env.*'],
  ['**/.firebaserc', '**/firebase.json', '**/.firebase/**'],
  ['**/Dockerfile*'],
  ['**/k8s/**/*.{yaml,yml}'],
  ['**/package.json', '**/tauri.conf.json', '**/src-tauri/**', '.vscode/extensions.json'],
  ['.claude/**', '.cursor/hooks.json', '.gitignore', 'docs/adr/**'],
  ['.marksman.toml'],
  ['.prettierignore', '.prettierrc*', 'prettier.config.*'],
  ['hasura/migrations/**/down.sql'],
  ['k8s/**/*.yaml', 'k8s/**/*.yml']
]

const REAL_FILE_SAMPLES = [
  'a.txt',
  '.env',
  '.env.production',
  'nested/deep/.env',
  'package.json',
  'apps/web/package.json',
  'apps/web/src-tauri/tauri.conf.json',
  '.vscode/extensions.json',
  'docs/adr/260731-decision.md',
  '.claude/settings.json',
  '.gitignore',
  '.marksman.toml',
  '.prettierignore',
  '.prettierrc.json',
  'prettier.config.js',
  'k8s/base/deployment.yaml',
  'k8s/overlays/prod/kustomization.yml',
  'hasura/migrations/2024/down.sql',
  'Dockerfile',
  'services/api/Dockerfile.prod',
  '.firebase/hosting.cache',
  'firebase.json',
  'image.png',
  'assets/icon.svg',
  'src/app.vue',
  'src/app.tsx',
  'README.md',
  'main.mdc'
]

describe('matchLintGlobs picomatch-семантика (dot:true, brace, globstar)', () => {
  for (const patterns of REAL_GLOB_PATTERNS) {
    test(`patterns=${JSON.stringify(patterns)}`, () => {
      const isMatch = picomatch(patterns, { dot: true })
      const expected = REAL_FILE_SAMPLES.filter(f => isMatch(f)).toSorted()
      const actual = loadNative().matchLintGlobs(patterns, REAL_FILE_SAMPLES).toSorted()
      expect(actual).toEqual(expected)
    })
  }

  test('порожній patterns → нічого не матчиться (той самий fallback, що picomatch-гілка "() => false")', () => {
    expect(loadNative().matchLintGlobs([], REAL_FILE_SAMPLES)).toEqual([])
  })
})
