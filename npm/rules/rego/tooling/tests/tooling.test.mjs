/**
 * Тести правила rego.mdc (concern tooling): перевірка наявності .regal/config.yaml.
 *
 * Прогін — через `runConcernDetector` (dispatch-рівень), не пряма функція: JS
 * `main.mjs` видалений (F2 фази 5 батчу 2), concern тепер живе лише в
 * `crates/rules-core/src/concerns/rego_tooling.rs` і виконується через
 * native-гілку `runConcernDetector`.
 */
import { describe, expect, test } from 'vitest'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { runConcernDetector } from '../../../../scripts/lib/lint-surface/detect.mjs'
import { withTmpDir } from '../../../../scripts/utils/test-helpers.mjs'

/** Абсолютний шлях теки концерну (тека з `concern.json`, без main.mjs — native-порт). */
const CONCERN_DIR = join(dirname(fileURLToPath(import.meta.url)), '..')
const CONCERN = { dir: CONCERN_DIR }

const run = dir => runConcernDetector(CONCERN, { cwd: dir, ruleId: 'rego', concernId: 'tooling', files: undefined })

describe('check rego.tooling', () => {
  test('успіх: .regal/config.yaml існує → 0 violations', async () => {
    await withTmpDir(async dir => {
      await mkdir(join(dir, '.regal'), { recursive: true })
      await writeFile(
        join(dir, '.regal', 'config.yaml'),
        'rules:\n  idiomatic:\n    no-defined-entrypoint:\n      level: ignore\n'
      )
      const result = await run(dir)
      expect(result.violations).toEqual([])
    })
  })

  test('порушення: .regal/config.yaml відсутній → violation', async () => {
    await withTmpDir(async dir => {
      const result = await run(dir)
      expect(result.violations.length).toBeGreaterThan(0)
    })
  })

  test('порушення: є .regal/ без config.yaml → violation', async () => {
    await withTmpDir(async dir => {
      await mkdir(join(dir, '.regal'), { recursive: true })
      const result = await run(dir)
      expect(result.violations.length).toBeGreaterThan(0)
    })
  })
})
