/**
 * Тести компактності пакета з `rules/npm-module/check.mjs` (npm-module.mdc):
 *  - `globToRegex` коректно ловить файли під `**`/`*`/`?` patterns (для negation у `files`).
 *  - `findTestFrameworkImport` бачить test-фреймворки і у `import`, і у `require()`, і у динамічному `import()`.
 *  - `classifyPublishedFileAsTest` повертає причину для test-style каталогів/імен/імпортів і `null` для «чистих» файлів.
 *
 * Інші розділи `check()` (TypeScript layout, hk, npm-publish workflow)
 * покриті інтеграційними прогонами через `integration-repo-checks.test.mjs`.
 * Узгодженість `version`/`CHANGELOG.md` тут не перевіряється — це зона `changelog/js/consistency.mjs`.
 */
import { describe, expect, test } from 'vitest'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { classifyPublishedFileAsTest, findTestFrameworkImport, globToRegex, lint } from '../main.mjs'
import { ensureDir, withTmpDir, writeJson } from '../../../../scripts/utils/test-helpers.mjs'

/**
 * Запускає detector у whole-repo режимі і повертає кількість порушень.
 * @param {string} dir корінь тимчасового проєкту
 * @returns {Promise<number>} кількість LintViolation
 */
const check = async dir => {
  const res = await lint({ cwd: dir, ruleId: 'npm-module', concernId: 'package_structure', files: undefined })
  return res.violations.length
}

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

  test('буквальний шлях без wildcard', () => {
    const re = globToRegex('bin/n-cursor.js')
    expect(re.test('bin/n-cursor.js')).toBe(true)
    expect(re.test('other/n-cursor.js')).toBe(false)
  })

  test('trailing **', () => {
    const re = globToRegex('rules/test/**')
    expect(re.test('rules/test/js/check.mjs')).toBe(true)
    expect(re.test('rules/other/js/check.mjs')).toBe(false)
  })

  test('два ** поспіль', () => {
    const re = globToRegex('**/**')
    expect(re.test('a/b/c')).toBe(true)
  })

  test('brace-альтернативи {a,b,c} — multi-extension', () => {
    const re = globToRegex('**/*.{png,jpg,jpeg,gif,svg}')
    expect(re.test('src/logo.png')).toBe(true)
    expect(re.test('assets/photo.jpeg')).toBe(true)
    expect(re.test('icon.svg')).toBe(true)
    expect(re.test('src/app.js')).toBe(false)
    expect(re.test('src/data.json')).toBe(false)
  })

  test('кома поза дужками — літерал', () => {
    const re = globToRegex('a,b.txt')
    expect(re.test('a,b.txt')).toBe(true)
    expect(re.test('ab.txt')).toBe(false)
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

  test('знаходить vitest статичний імпорт', () => {
    const code = `import { describe, test } from 'vitest'\ndescribe('x', () => {})\n`
    expect(findTestFrameworkImport(code, 'check.test.mjs')).toBe('vitest')
  })

  test('знаходить mocha через require', () => {
    const code = `const { describe } = require('mocha')\n`
    expect(findTestFrameworkImport(code, 'check.test.cjs')).toBe('mocha')
  })

  test('null для порожнього файлу', () => {
    expect(findTestFrameworkImport('', 'empty.mjs')).toBeNull()
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

  test('rules/test/foo.mjs — carve-out: "test" на idx=1 у rules/ не є test-каталогом → null', async () => {
    await withTmpDir(async dir => {
      await ensureDir(join(dir, 'npm/rules/test'))
      await writeFile(join(dir, 'npm', 'rules', 'test', 'foo.mjs'), 'export const x = 1\n', 'utf8')
      const reason = await classifyPublishedFileAsTest('rules/test/foo.mjs', dir)
      expect(reason).toBeNull()
    })
  })

  test('rules/test/tests/bar.mjs — внутрішній tests/ (idx=2) усе одно є порушенням', async () => {
    await withTmpDir(async dir => {
      await ensureDir(join(dir, 'npm/rules/test/tests'))
      await writeFile(join(dir, 'npm', 'rules', 'test', 'tests', 'bar.mjs'), 'export const x = 1\n', 'utf8')
      const reason = await classifyPublishedFileAsTest('rules/test/tests/bar.mjs', dir)
      expect(reason).toContain('test-style каталог')
    })
  })
})

describe('findTestFrameworkImport — синтаксичні помилки (line 448/450)', () => {
  test('зламаний синтаксис → null', () => {
    expect(findTestFrameworkImport('import { from broken\n', 'foo.ts')).toBeNull()
  })
})

describe('check — інтеграційні сценарії', () => {
  test('пуста директорія → 1, fail: package.json не існує, npm/ не існує (lines 549, 561, 567)', async () => {
    await withTmpDir(async dir => {
      const code = await check(dir)
      expect(code).toBeGreaterThan(0)
    })
  })

  test('є package.json + npm/ + npm/package.json, немає hk → fail hk (lines 130, 603)', async () => {
    await withTmpDir(async dir => {
      await writeJson(join(dir, 'package.json'), { name: 'root', workspaces: ['npm'] })
      await ensureDir(join(dir, 'npm'))
      await writeJson(join(dir, 'npm/package.json'), { name: 'pkg', version: '1.0.0' })
      const code = await check(dir)
      expect(code).toBeGreaterThan(0)
    })
  })

  test('npm/src з .js → useSrcJsLayout=true; hk.pkl без src-фрагментів → fail (lines 103–113, 139, 149, 600)', async () => {
    await withTmpDir(async dir => {
      await writeJson(join(dir, 'package.json'), { name: 'root', workspaces: ['npm'] })
      await ensureDir(join(dir, 'npm/src'))
      await writeFile(join(dir, 'npm/src/index.js'), 'export const x = 1\n', 'utf8')
      await writeJson(join(dir, 'npm/package.json'), { name: 'pkg', version: '1.0.0' })
      await writeFile(join(dir, 'hk.pkl'), 'nothing useful here\n', 'utf8')
      const code = await check(dir)
      expect(code).toBeGreaterThan(0)
    })
  })

  test('немає npm/tsconfig.emit-types.json (no src/js) → fail emit-types config (lines 197, 210, 213)', async () => {
    await withTmpDir(async dir => {
      await writeJson(join(dir, 'package.json'), { name: 'root', workspaces: ['npm'] })
      await ensureDir(join(dir, 'npm'))
      await writeJson(join(dir, 'npm/package.json'), { name: 'pkg', version: '1.0.0' })
      const code = await check(dir)
      expect(code).toBeGreaterThan(0)
    })
  })

  test('немає .github/workflows/ → fail (line 609)', async () => {
    await withTmpDir(async dir => {
      await writeJson(join(dir, 'package.json'), { name: 'root', workspaces: ['npm'] })
      await ensureDir(join(dir, 'npm'))
      await writeJson(join(dir, 'npm/package.json'), { name: 'pkg', version: '1.0.0' })
      await writeFile(join(dir, 'hk.pkl'), '["pre-commit"]\nbunx -p typescript tsc\ntsconfig.emit-types.json\n', 'utf8')
      await writeFile(join(dir, 'npm/tsconfig.emit-types.json'), '{"compilerOptions":{}}\n', 'utf8')
      const code = await check(dir)
      expect(code).toBeGreaterThan(0)
    })
  })

  test('files вказує на test-файл → violations (lines 529, 530)', async () => {
    await withTmpDir(async dir => {
      await writeJson(join(dir, 'package.json'), { name: 'root', workspaces: ['npm'] })
      await ensureDir(join(dir, 'npm/lib'))
      await writeJson(join(dir, 'npm/package.json'), {
        name: 'pkg',
        version: '1.0.0',
        files: ['lib']
      })
      await writeFile(join(dir, 'npm/lib/foo.test.mjs'), 'export const x = 1\n', 'utf8')
      const code = await check(dir)
      expect(code).toBeGreaterThan(0)
    })
  })

  test('npm є файлом, а не директорією → fail (line 558)', async () => {
    await withTmpDir(async dir => {
      await writeJson(join(dir, 'package.json'), { name: 'root', workspaces: ['npm'] })
      await writeFile(join(dir, 'npm'), 'not a dir\n', 'utf8')
      const code = await check(dir)
      expect(code).toBeGreaterThan(0)
    })
  })
})
