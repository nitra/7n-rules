/**
 * Модульні тести для `gha-workflow.mjs` (YAML parse + обхід кроків GitHub Actions).
 */
import { describe, expect, test } from 'bun:test'

import {
  anyRunStepIncludes,
  eventPathsIncludeExact,
  findForbiddenUsesOrRunPatterns,
  findRunStepsWithShellLineContinuationBackslash,
  flattenWorkflowSteps,
  hasCheckoutBeforeLocalSetupBunDeps,
  parseWorkflowYaml,
  pushHasMainBranch,
  pushPathsIncludeNpmGlob,
  runTextHasShellLineContinuationBackslash,
  verifyLintJsWorkflowStructure
} from './gha-workflow.mjs'

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
})
