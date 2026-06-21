/**
 * Модульні тести для `gha-workflow.mjs` (YAML parse + обхід кроків GitHub Actions).
 */
import { describe, expect, test } from 'vitest'

import {
  anyRunStepIncludes,
  eventPathsIncludeExact,
  flattenWorkflowSteps,
  getStepRun,
  getStepUses,
  parseWorkflowYaml,
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

  test('eventPathsIncludeExact', () => {
    const y = `on:
  push:
    paths:
      - '**/k8s/**/*.yaml'
`
    const root = parseWorkflowYaml(y)
    expect(eventPathsIncludeExact(/** @type {Record<string, unknown>} */ (root), 'push', '**/k8s/**/*.yaml')).toBe(true)
  })

  test('anyRunStepIncludes', () => {
    const y = `jobs:
  t:
    runs-on: ubuntu-latest
    steps:
      - run: n-cursor lint text --read-only
`
    const root = parseWorkflowYaml(y)
    expect(anyRunStepIncludes(/** @type {Record<string, unknown>} */ (root), 'n-cursor lint text --read-only')).toBe(
      true
    )
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
