import { describe, expect, test } from 'vitest'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { lint } from '../main.mjs'
import { ensureDir, withTmpDir, writeJson } from '@7n/rules/scripts/utils/test-helpers.mjs'

const run = dir => lint({ cwd: dir, ruleId: 'style', concernId: 'tooling', files: undefined })

describe('check (style tooling)', () => {
  test('exit 0 — повний набір конфігів', async () => {
    await withTmpDir(async dir => {
      await writeJson(join(dir, 'package.json'), {
        name: 'x',
        stylelint: { extends: '@nitra/stylelint-config' }
      })
      await writeFile(join(dir, '.stylelintignore'), 'dist/\n', 'utf8')
      await ensureDir(join(dir, '.github/workflows'))
      await writeFile(
        join(dir, '.github/workflows/lint-style.yml'),
        'name: lint\non: push\njobs:\n  lint:\n    runs-on: ubuntu-latest\n    steps:\n      - run: npx stylelint\n',
        'utf8'
      )
      const result = await run(dir)
      expect(result.violations).toEqual([])
    })
  })

  test('exit 0 — конфіг через .stylelintrc.json', async () => {
    await withTmpDir(async dir => {
      await writeJson(join(dir, 'package.json'), { name: 'x' })
      await writeJson(join(dir, '.stylelintrc.json'), { extends: '@nitra/stylelint-config' })
      await writeFile(join(dir, '.stylelintignore'), 'dist/\n', 'utf8')
      await ensureDir(join(dir, '.github/workflows'))
      await writeFile(join(dir, '.github/workflows/lint-style.yml'), '# yml\n', 'utf8')
      const result = await run(dir)
      expect(result.violations).toEqual([])
    })
  })

  test('exit 1 — відсутній конфіг stylelint', async () => {
    await withTmpDir(async dir => {
      await writeJson(join(dir, 'package.json'), { name: 'x' })
      await writeFile(join(dir, '.stylelintignore'), 'dist/\n', 'utf8')
      await ensureDir(join(dir, '.github/workflows'))
      await writeFile(join(dir, '.github/workflows/lint-style.yml'), '# yml\n', 'utf8')
      const result = await run(dir)
      expect(result.violations.length).toBeGreaterThan(0)
    })
  })

  test('exit 1 — відсутній .stylelintignore', async () => {
    await withTmpDir(async dir => {
      await writeJson(join(dir, 'package.json'), {
        name: 'x',
        stylelint: { extends: '@nitra/stylelint-config' }
      })
      await ensureDir(join(dir, '.github/workflows'))
      await writeFile(join(dir, '.github/workflows/lint-style.yml'), '# yml\n', 'utf8')
      const result = await run(dir)
      expect(result.violations.length).toBeGreaterThan(0)
    })
  })

  test('exit 0 — без lint-style.yml (existence вимагає плагін ci-github)', async () => {
    await withTmpDir(async dir => {
      await writeJson(join(dir, 'package.json'), {
        name: 'x',
        stylelint: { extends: '@nitra/stylelint-config' }
      })
      await writeFile(join(dir, '.stylelintignore'), 'dist/\n', 'utf8')
      const result = await run(dir)
      expect(result.violations).toHaveLength(0)
    })
  })

  test('exit 0 — конфіг через stylelint.config.js', async () => {
    await withTmpDir(async dir => {
      await writeJson(join(dir, 'package.json'), { name: 'x' })
      await writeFile(join(dir, 'stylelint.config.js'), 'export default {}\n', 'utf8')
      await writeFile(join(dir, '.stylelintignore'), 'dist/\n', 'utf8')
      await ensureDir(join(dir, '.github/workflows'))
      await writeFile(join(dir, '.github/workflows/lint-style.yml'), '# yml\n', 'utf8')
      const result = await run(dir)
      expect(result.violations).toEqual([])
    })
  })

  test('exit 0 — конфіг через stylelint.config.mjs (новий канон)', async () => {
    await withTmpDir(async dir => {
      await writeJson(join(dir, 'package.json'), { name: 'x' })
      await writeFile(join(dir, 'stylelint.config.mjs'), 'export default {}\n', 'utf8')
      await writeFile(join(dir, '.stylelintignore'), 'dist/\n', 'utf8')
      await ensureDir(join(dir, '.github/workflows'))
      await writeFile(join(dir, '.github/workflows/lint-style.yml'), '# yml\n', 'utf8')
      const result = await run(dir)
      expect(result.violations).toEqual([])
    })
  })

  test('exit 0 — конфіг через .stylelintrc.cjs', async () => {
    await withTmpDir(async dir => {
      await writeJson(join(dir, 'package.json'), { name: 'x' })
      await writeFile(join(dir, '.stylelintrc.cjs'), 'module.exports = {}\n', 'utf8')
      await writeFile(join(dir, '.stylelintignore'), 'dist/\n', 'utf8')
      await ensureDir(join(dir, '.github/workflows'))
      await writeFile(join(dir, '.github/workflows/lint-style.yml'), '# yml\n', 'utf8')
      const result = await run(dir)
      expect(result.violations).toEqual([])
    })
  })

  test('exit 1 — .stylelintignore існує, але не містить dist/', async () => {
    await withTmpDir(async dir => {
      await writeJson(join(dir, 'package.json'), {
        name: 'x',
        stylelint: { extends: '@nitra/stylelint-config' }
      })
      await writeFile(join(dir, '.stylelintignore'), 'node_modules/\n', 'utf8')
      await ensureDir(join(dir, '.github/workflows'))
      await writeFile(join(dir, '.github/workflows/lint-style.yml'), '# yml\n', 'utf8')
      const result = await run(dir)
      expect(result.violations.length).toBeGreaterThan(0)
    })
  })
})
