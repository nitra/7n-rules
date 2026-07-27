/** Тести scope-gate правила npm-module для service monorepo і npm publisher-а. */
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { describe, expect, test } from 'vitest'

import { detectAll } from '../../../../../../npm/scripts/lib/lint-surface/run-detectors.mjs'
import { ensureDir, withTmpDir, writeJson } from '@7n/rules/scripts/utils/test-helpers.mjs'

import { applies } from '../main.mjs'

const RULES_DIR = new URL('../../../', import.meta.url).pathname

describe('npm-module applies', () => {
  test('service monorepo без npm topology пропускає npm-module', async () => {
    await withTmpDir(async dir => {
      await writeJson(join(dir, '.n-rules.json'), { rules: ['npm-module'] })
      await writeJson(join(dir, 'package.json'), { private: true, workspaces: ['run/*', 'jobs/*', 'nats-jobs/*'] })

      expect(applies(dir)).toBe(false)
      const result = await detectAll({ cwd: dir, rulesDirs: [RULES_DIR], rules: ['npm-module'] })
      expect(result.violations).toEqual([])
      expect(result.ran).toEqual([])
    })
  })

  test('publisher без npm workspace лишається в scope і root policy повертає порушення', async () => {
    await withTmpDir(async dir => {
      await writeJson(join(dir, '.n-rules.json'), { rules: ['npm-module'] })
      await writeJson(join(dir, 'package.json'), { private: true, workspaces: ['run/*'] })
      await ensureDir(join(dir, 'npm'))
      await writeJson(join(dir, 'npm/package.json'), { name: '@example/publisher', version: '1.0.0' })
      await writeFile(join(dir, 'hk.pkl'), '', 'utf8')

      expect(applies(dir)).toBe(true)
      const result = await detectAll({ cwd: dir, rulesDirs: [RULES_DIR], rules: ['npm-module'] })
      expect(result.violations.some(v => v.concernId === 'root_package_json' && v.message.includes('"npm"'))).toBe(true)
    })
  })
})
