import { describe, expect, test } from 'vitest'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { main as check } from '../main.mjs'
import { ensureDir, withTmpDir, writeJson } from '../../../../scripts/utils/test-helpers.mjs'

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
      expect(await check(dir)).toBe(0)
    })
  })

  test('exit 0 — конфіг через .stylelintrc.json', async () => {
    await withTmpDir(async dir => {
      await writeJson(join(dir, 'package.json'), { name: 'x' })
      await writeJson(join(dir, '.stylelintrc.json'), { extends: '@nitra/stylelint-config' })
      await writeFile(join(dir, '.stylelintignore'), 'dist/\n', 'utf8')
      await ensureDir(join(dir, '.github/workflows'))
      await writeFile(join(dir, '.github/workflows/lint-style.yml'), '# yml\n', 'utf8')
      expect(await check(dir)).toBe(0)
    })
  })

  test('exit 1 — відсутній конфіг stylelint', async () => {
    await withTmpDir(async dir => {
      await writeJson(join(dir, 'package.json'), { name: 'x' })
      await writeFile(join(dir, '.stylelintignore'), 'dist/\n', 'utf8')
      await ensureDir(join(dir, '.github/workflows'))
      await writeFile(join(dir, '.github/workflows/lint-style.yml'), '# yml\n', 'utf8')
      expect(await check(dir)).toBe(1)
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
      expect(await check(dir)).toBe(1)
    })
  })

  test('exit 1 — відсутній lint-style.yml', async () => {
    await withTmpDir(async dir => {
      await writeJson(join(dir, 'package.json'), {
        name: 'x',
        stylelint: { extends: '@nitra/stylelint-config' }
      })
      await writeFile(join(dir, '.stylelintignore'), 'dist/\n', 'utf8')
      expect(await check(dir)).toBe(1)
    })
  })

  test('exit 0 — конфіг через stylelint.config.js', async () => {
    await withTmpDir(async dir => {
      await writeJson(join(dir, 'package.json'), { name: 'x' })
      await writeFile(join(dir, 'stylelint.config.js'), 'export default {}\n', 'utf8')
      await writeFile(join(dir, '.stylelintignore'), 'dist/\n', 'utf8')
      await ensureDir(join(dir, '.github/workflows'))
      await writeFile(join(dir, '.github/workflows/lint-style.yml'), '# yml\n', 'utf8')
      expect(await check(dir)).toBe(0)
    })
  })

  test('exit 0 — конфіг через stylelint.config.mjs (новий канон)', async () => {
    await withTmpDir(async dir => {
      await writeJson(join(dir, 'package.json'), { name: 'x' })
      await writeFile(join(dir, 'stylelint.config.mjs'), 'export default {}\n', 'utf8')
      await writeFile(join(dir, '.stylelintignore'), 'dist/\n', 'utf8')
      await ensureDir(join(dir, '.github/workflows'))
      await writeFile(join(dir, '.github/workflows/lint-style.yml'), '# yml\n', 'utf8')
      expect(await check(dir)).toBe(0)
    })
  })

  test('exit 0 — конфіг через .stylelintrc.cjs', async () => {
    await withTmpDir(async dir => {
      await writeJson(join(dir, 'package.json'), { name: 'x' })
      await writeFile(join(dir, '.stylelintrc.cjs'), 'module.exports = {}\n', 'utf8')
      await writeFile(join(dir, '.stylelintignore'), 'dist/\n', 'utf8')
      await ensureDir(join(dir, '.github/workflows'))
      await writeFile(join(dir, '.github/workflows/lint-style.yml'), '# yml\n', 'utf8')
      expect(await check(dir)).toBe(0)
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
      expect(await check(dir)).toBe(1)
    })
  })
})
