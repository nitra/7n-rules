/**
 * Тести компактності пакета з `rules/npm-module/fix.mjs` (npm-module.mdc):
 *  - `globToRegex` коректно ловить файли під `**`/`*`/`?` patterns (для negation у `files`).
 *  - `findTestFrameworkImport` бачить test-фреймворки і у `import`, і у `require()`, і у динамічному `import()`.
 *  - `classifyPublishedFileAsTest` повертає причину для test-style каталогів/імен/імпортів і `null` для «чистих» файлів.
 *
 * Інші розділи `check()` (TypeScript layout, hk, npm-publish workflow, CHANGELOG, dirty-bump)
 * покриті інтеграційними прогонами через `integration-repo-checks.test.mjs`.
 */
import { describe, expect, test } from 'vitest'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { classifyPublishedFileAsTest, findTestFrameworkImport, globToRegex } from '../package_structure.mjs'
import { ensureDir, withTmpDir } from '../../../../scripts/utils/test-helpers.mjs'

describe('globToRegex', () => {
  test('globstar матчить нуль і більше сегментів', () => {
    const re = globToRegex('policy/**/foo_test.rego')
    expect(re.test('policy/foo_test.rego')).toBe(true)
    expect(re.test('policy/a/foo_test.rego')).toBe(true)
    expect(re.test('policy/a/b/foo_test.rego')).toBe(true)
    expect(re.test('other/foo_test.rego')).toBe(false)
  })

  test('одинарна зірочка — тільки в межах сегмента', () => {
    const re = globToRegex('mdc/*.mdc')
    expect(re.test('mdc/foo.mdc')).toBe(true)
    expect(re.test('mdc/sub/foo.mdc')).toBe(false)
  })

  test('?  — рівно один символ без /', () => {
    const re = globToRegex('v?.txt')
    expect(re.test('v1.txt')).toBe(true)
    expect(re.test('v.txt')).toBe(false)
    expect(re.test('vA.txt')).toBe(true)
    expect(re.test('v/1.txt')).toBe(false)
  })

  test('escape для крапки та інших спецсимволів', () => {
    const re = globToRegex('a.b')
    expect(re.test('a.b')).toBe(true)
    expect(re.test('aXb')).toBe(false)
  })

  test('leading globstar', () => {
    const re = globToRegex('**/_test.rego')
    expect(re.test('_test.rego')).toBe(true)
    expect(re.test('a/_test.rego')).toBe(true)
    expect(re.test('a/b/_test.rego')).toBe(true)
  })
})

describe('findTestFrameworkImport', () => {
  test('static import з bun:test', () => {
    const code = "import { test } from 'bun:test'\ntest('x', () => {})\n"
    expect(findTestFrameworkImport(code, 'foo.mjs')).toBe('bun:test')
  })

  test('require() з vitest', () => {
    const code = "const { it } = require('vitest')\n"
    expect(findTestFrameworkImport(code, 'foo.cjs')).toBe('vitest')
  })

  test('динамічний import() з node:test', () => {
    const code = "await import('node:test')\n"
    expect(findTestFrameworkImport(code, 'foo.mjs')).toBe('node:test')
  })

  test('звичайний файл без тест-імпортів', () => {
    const code = "import { join } from 'node:path'\nexport const x = 1\n"
    expect(findTestFrameworkImport(code, 'foo.mjs')).toBeNull()
  })
})

describe('classifyPublishedFileAsTest', () => {
  test('каталог tests/ — порушення', async () => {
    await withTmpDir(async dir => {
      await ensureDir(join(dir, 'npm/scripts/tests'))
      await writeFile(join(dir, 'npm', 'scripts', 'tests', 'foo.mjs'), 'export const a = 1\n', 'utf8')
      const reason = await classifyPublishedFileAsTest('scripts/tests/foo.mjs')
      expect(reason).toContain('test-style каталог')
    })
  })

  test('basename *.test.mjs — порушення', async () => {
    await withTmpDir(async dir => {
      await ensureDir(join(dir, 'npm/scripts'))
      await writeFile(join(dir, 'npm', 'scripts', 'foo.test.mjs'), 'export const a = 1\n', 'utf8')
      const reason = await classifyPublishedFileAsTest('scripts/foo.test.mjs')
      expect(reason).toContain('test-style')
    })
  })

  test('basename *_test.rego — дозволено (conftest-конвенція, npm-module.mdc)', async () => {
    await withTmpDir(async dir => {
      await ensureDir(join(dir, 'npm/policy/k8s/foo'))
      await writeFile(join(dir, 'npm', 'policy', 'k8s', 'foo', 'foo_test.rego'), 'package foo\n', 'utf8')
      const reason = await classifyPublishedFileAsTest('policy/k8s/foo/foo_test.rego')
      expect(reason).toBeNull()
    })
  })

  test('JS-файл з імпортом bun:test — порушення', async () => {
    await withTmpDir(async dir => {
      await ensureDir(join(dir, 'npm/scripts'))
      await writeFile(
        join(dir, 'npm', 'scripts', 'foo.mjs'),
        "import { test } from 'bun:test'\ntest('x', () => {})\n",
        'utf8'
      )
      const reason = await classifyPublishedFileAsTest('scripts/foo.mjs', dir)
      expect(reason).toContain('імпорт test-фреймворку "bun:test"')
    })
  })

  test('звичайний файл — без порушення', async () => {
    await withTmpDir(async dir => {
      await ensureDir(join(dir, 'npm/scripts'))
      await writeFile(
        join(dir, 'npm', 'scripts', 'pure.mjs'),
        "import { join } from 'node:path'\nexport const a = 1\n",
        'utf8'
      )
      const reason = await classifyPublishedFileAsTest('scripts/pure.mjs', dir)
      expect(reason).toBeNull()
    })
  })
})
