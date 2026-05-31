/**
 * Модульні тести для `gha-workflow.mjs` (YAML parse + обхід кроків GitHub Actions).
 */
import { describe, expect, test } from 'vitest'

import {
  anyRunStepIncludes,
  anyRunStepIncludesStylelint,
  eventPathsIncludeExact,
  findForbiddenUsesOrRunPatterns,
  findRunStepsWithShellLineContinuationBackslash,
  flattenWorkflowSteps,
  getStepRun,
  getStepUses,
  hasAnyStepUsesContaining,
  hasCheckoutBeforeLocalSetupBunDeps,
  hasIdTokenWritePermission,
  hasNpmPublishStepWithPackage,
  parseWorkflowYaml,
  pushHasMainBranch,
  pushPathsIncludeNpmGlob,
  runTextHasShellLineContinuationBackslash,
  verifyLintJsWorkflowStructure
} from '../gha-workflow.mjs'

const LINT_JS_SAMPLE = `name: Lint JS
on:
  push:
    branches: [dev, main]
jobs:
  eslint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
        with:
          persist-credentials: false
      - uses: ./.github/actions/setup-bun-deps
      - run: |
          bunx oxlint
          bunx eslint .
          bunx jscpd .
`

describe('gha-workflow', () => {
  test('parseWorkflowYaml — валідний workflow', () => {
    const root = parseWorkflowYaml(LINT_JS_SAMPLE)
    expect(root).not.toBeNull()
    expect(flattenWorkflowSteps(/** @type {Record<string, unknown>} */ (root)).length).toBe(3)
  })

  test('verifyLintJsWorkflowStructure — канонічний lint-js', () => {
    const root = parseWorkflowYaml(LINT_JS_SAMPLE)
    const v = verifyLintJsWorkflowStructure(/** @type {Record<string, unknown>} */ (root))
    expect(v.ok).toBe(true)
  })

  test('hasCheckoutBeforeLocalSetupBunDeps', () => {
    const root = parseWorkflowYaml(LINT_JS_SAMPLE)
    expect(
      hasCheckoutBeforeLocalSetupBunDeps(/** @type {Record<string, unknown>} */ (root), [
        './.github/actions/setup-bun-deps'
      ])
    ).toBe(true)
  })

  test('eventPathsIncludeExact', () => {
    const y = `on:
  push:
    paths:
      - '**/k8s/**/*.yaml'
`
    const root = parseWorkflowYaml(y)
    expect(eventPathsIncludeExact(/** @type {Record<string, unknown>} */ (root), 'push', '**/k8s/**/*.yaml')).toBe(true)
  })

  test('pushPathsIncludeNpmGlob / pushHasMainBranch', () => {
    const y = `on:
  push:
    paths:
      - 'npm/**'
    branches:
      - main
`
    const root = parseWorkflowYaml(y)
    expect(pushPathsIncludeNpmGlob(/** @type {Record<string, unknown>} */ (root))).toBe(true)
    expect(pushHasMainBranch(/** @type {Record<string, unknown>} */ (root))).toBe(true)
  })

  test('findForbiddenUsesOrRunPatterns — знаходить oven-sh у uses', () => {
    const y = `jobs:
  x:
    runs-on: ubuntu-latest
    steps:
      - uses: oven-sh/setup-bun@v2
`
    const root = parseWorkflowYaml(y)
    const hits = findForbiddenUsesOrRunPatterns(/** @type {Record<string, unknown>} */ (root), [
      { pattern: 'oven-sh/setup-bun', msg: 'no' }
    ])
    expect(hits.length).toBe(1)
  })

  test('anyRunStepIncludes', () => {
    const y = `jobs:
  t:
    runs-on: ubuntu-latest
    steps:
      - run: bun run lint-text
`
    const root = parseWorkflowYaml(y)
    expect(anyRunStepIncludes(/** @type {Record<string, unknown>} */ (root), 'bun run lint-text')).toBe(true)
  })

  test('runTextHasShellLineContinuationBackslash / findRunStepsWithShellLineContinuationBackslash', () => {
    expect(runTextHasShellLineContinuationBackslash('docker build \\\n  --push')).toBe(true)
    expect(runTextHasShellLineContinuationBackslash('echo ok\nexit 0')).toBe(false)
    const withBackslashRun = String.raw`jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - run: |
          docker build \
          --push
`
    const badRoot = parseWorkflowYaml(withBackslashRun)
    expect(badRoot).not.toBeNull()
    const hit = findRunStepsWithShellLineContinuationBackslash(/** @type {Record<string, unknown>} */ (badRoot))
    expect(hit).toEqual([{ jobId: 'build', stepIndex: 0 }])
    const folded = `jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - run: >-
          docker build
          --push
`
    const goodRoot = parseWorkflowYaml(folded)
    expect(
      findRunStepsWithShellLineContinuationBackslash(/** @type {Record<string, unknown>} */ (goodRoot)).length
    ).toBe(0)
  })

  test('getStepUses — рядок або порожній рядок', () => {
    expect(getStepUses({ uses: 'actions/checkout@v6' })).toBe('actions/checkout@v6')
    expect(getStepUses({ run: 'echo hi' })).toBe('')
    expect(getStepUses({})).toBe('')
  })

  test('getStepRun — рядок, масив або порожній рядок', () => {
    expect(getStepRun({ run: 'echo ok' })).toBe('echo ok')
    expect(getStepRun({ uses: 'actions/checkout@v6' })).toBe('')
  })

  test('hasAnyStepUsesContaining — true якщо є хоч один збіг', () => {
    const y = `jobs:
  t:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
      - uses: oven-sh/setup-bun@v2
`
    const root = parseWorkflowYaml(y)
    expect(hasAnyStepUsesContaining(/** @type {Record<string, unknown>} */ (root), ['oven-sh'])).toBe(true)
    expect(hasAnyStepUsesContaining(/** @type {Record<string, unknown>} */ (root), ['missing'])).toBe(false)
  })

  test('hasNpmPublishStepWithPackage — true з package: npm/package.json', () => {
    const y = `jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - uses: JS-DevTools/npm-publish@v3
        with:
          package: npm/package.json
`
    const root = parseWorkflowYaml(y)
    expect(hasNpmPublishStepWithPackage(/** @type {Record<string, unknown>} */ (root))).toBe(true)
  })

  test('hasNpmPublishStepWithPackage — false без npm-publish кроку', () => {
    const y = `jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - run: echo ok
`
    const root = parseWorkflowYaml(y)
    expect(hasNpmPublishStepWithPackage(/** @type {Record<string, unknown>} */ (root))).toBe(false)
  })

  test('hasIdTokenWritePermission — true якщо є permissions.id-token: write', () => {
    const y = `jobs:
  publish:
    runs-on: ubuntu-latest
    permissions:
      id-token: write
    steps:
      - run: echo ok
`
    const root = parseWorkflowYaml(y)
    expect(hasIdTokenWritePermission(/** @type {Record<string, unknown>} */ (root))).toBe(true)
  })

  test('hasIdTokenWritePermission — false без permissions', () => {
    const y = `jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - run: echo ok
`
    const root = parseWorkflowYaml(y)
    expect(hasIdTokenWritePermission(/** @type {Record<string, unknown>} */ (root))).toBe(false)
  })

  test('anyRunStepIncludesStylelint — true якщо є npx stylelint', () => {
    const y = `jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - run: npx stylelint **/*.css
`
    const root = parseWorkflowYaml(y)
    expect(anyRunStepIncludesStylelint(/** @type {Record<string, unknown>} */ (root))).toBe(true)
    expect(anyRunStepIncludes(/** @type {Record<string, unknown>} */ (root), 'npx stylelint')).toBe(true)
  })

  test('verifyLintJsWorkflowStructure — null → failure про parse', () => {
    const result = verifyLintJsWorkflowStructure(null)
    expect(result.ok).toBe(false)
    expect(result.failures.some(f => f.includes('YAML'))).toBe(true)
  })

  test('verifyLintJsWorkflowStructure — порожній workflow → усі failure', () => {
    const root = parseWorkflowYaml('jobs:\n  t:\n    runs-on: ubuntu-latest\n    steps: []\n')
    const result = verifyLintJsWorkflowStructure(/** @type {Record<string, unknown>} */ (root))
    expect(result.ok).toBe(false)
    expect(result.failures.length).toBeGreaterThan(0)
  })

  test('flattenWorkflowSteps — порожній workflow → []', () => {
    const root = parseWorkflowYaml('name: empty\n')
    expect(flattenWorkflowSteps(/** @type {Record<string, unknown>} */ (root))).toEqual([])
  })

  test('hasCheckoutBeforeLocalSetupBunDeps — false без checkout перед setup', () => {
    const y = `jobs:
  t:
    runs-on: ubuntu-latest
    steps:
      - uses: ./.github/actions/setup-bun-deps
      - uses: actions/checkout@v6
`
    const root = parseWorkflowYaml(y)
    expect(
      hasCheckoutBeforeLocalSetupBunDeps(/** @type {Record<string, unknown>} */ (root), [
        './.github/actions/setup-bun-deps'
      ])
    ).toBe(false)
  })

  test('parseWorkflowYaml — невалідний YAML → null', () => {
    expect(parseWorkflowYaml(': invalid: yaml: {')).toBeNull()
  })

  test('getStepRun — run як масив → join', () => {
    expect(getStepRun({ run: ['echo a', 'echo b'] })).toBe('echo a\necho b')
  })

  test('eventPathsIncludeExact — без on → false', () => {
    expect(eventPathsIncludeExact({}, 'push', 'npm/**')).toBe(false)
  })

  test('eventPathsIncludeExact — on без потрібного event → false', () => {
    const root = parseWorkflowYaml('on:\n  schedule:\n    - cron: "0 0 * * *"\n')
    expect(eventPathsIncludeExact(/** @type {Record<string, unknown>} */ (root), 'push', 'npm/**')).toBe(false)
  })

  test('pushPathsIncludeNpmGlob — без on → false', () => {
    expect(pushPathsIncludeNpmGlob({})).toBe(false)
  })

  test('pushPathsIncludeNpmGlob — on без push → false', () => {
    const root = parseWorkflowYaml('on:\n  schedule:\n    - cron: "0 0 * * *"\n')
    expect(pushPathsIncludeNpmGlob(/** @type {Record<string, unknown>} */ (root))).toBe(false)
  })

  test('pushPathsIncludeNpmGlob — push без paths → false', () => {
    const root = parseWorkflowYaml('on:\n  push:\n    branches: [main]\n')
    expect(pushPathsIncludeNpmGlob(/** @type {Record<string, unknown>} */ (root))).toBe(false)
  })

  test('pushHasMainBranch — без on → false', () => {
    expect(pushHasMainBranch({})).toBe(false)
  })

  test('pushHasMainBranch — on без push → false', () => {
    const root = parseWorkflowYaml('on:\n  schedule:\n    - cron: "0 0 * * *"\n')
    expect(pushHasMainBranch(/** @type {Record<string, unknown>} */ (root))).toBe(false)
  })

  test('pushHasMainBranch — push без branches → false', () => {
    const root = parseWorkflowYaml('on:\n  push:\n    paths: ["npm/**"]\n')
    expect(pushHasMainBranch(/** @type {Record<string, unknown>} */ (root))).toBe(false)
  })

  test('hasIdTokenWritePermission — без jobs → false', () => {
    expect(hasIdTokenWritePermission({})).toBe(false)
  })

  test('anyRunStepIncludes — needle не знайдено → false', () => {
    const root = parseWorkflowYaml('jobs:\n  t:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo ok\n')
    expect(anyRunStepIncludes(/** @type {Record<string, unknown>} */ (root), 'missing-needle')).toBe(false)
  })

  test('flattenWorkflowSteps — job зі steps: null → не падає, [] кроків', () => {
    const root = parseWorkflowYaml('jobs:\n  t:\n    runs-on: ubuntu-latest\n    steps: ~\n')
    const steps = flattenWorkflowSteps(/** @type {Record<string, unknown>} */ (root))
    expect(steps).toHaveLength(0)
  })

  test('verifyLintJsWorkflowStructure — oxlint --fix і eslint --fix → failure', () => {
    const y = `name: Lint JS
on:
  push:
    branches: [dev, main]
jobs:
  eslint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
        with:
          persist-credentials: false
      - uses: ./.github/actions/setup-bun-deps
      - run: |
          bunx oxlint --fix
          bunx eslint --fix .
          bunx jscpd .
`
    const root = parseWorkflowYaml(y)
    const result = verifyLintJsWorkflowStructure(/** @type {Record<string, unknown>} */ (root))
    expect(result.ok).toBe(false)
    expect(result.failures.some(f => f.includes('oxlint'))).toBe(true)
    expect(result.failures.some(f => f.includes('eslint --fix'))).toBe(true)
  })
})
