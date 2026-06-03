/**
 * Тести pure-функцій package_structure.mjs:
 *   - globToRegex: glob-шаблони з *, ?, **, !
 *   - findTestFrameworkImport: детектує test-фреймворк у JS-коді
 */
import { describe, expect, test } from 'vitest'

import { findTestFrameworkImport, globToRegex } from '../package_structure.mjs'

describe('globToRegex', () => {
  test('буквальний шлях без wildcard', () => {
    const re = globToRegex('bin/n-cursor.js')
    expect(re.test('bin/n-cursor.js')).toBe(true)
    expect(re.test('other/n-cursor.js')).toBe(false)
  })

  test('* — будь-яка послідовність без слешу', () => {
    const re = globToRegex('rules/*/fix.mjs')
    expect(re.test('rules/adr/fix.mjs')).toBe(true)
    expect(re.test('rules/adr/sub/fix.mjs')).toBe(false)
  })

  test('? — будь-який один символ без слешу', () => {
    const re = globToRegex('bin/?.js')
    expect(re.test('bin/x.js')).toBe(true)
    expect(re.test('bin/xy.js')).toBe(false)
  })

  test('** — будь-яка глибина (починаючи від кореня)', () => {
    const re = globToRegex('**/tests/**')
    expect(re.test('rules/adr/js/tests/check.test.mjs')).toBe(true)
    expect(re.test('tests/integration.test.mjs')).toBe(true)
  })

  test('провідний ** (без слешу перед залишком)', () => {
    const re = globToRegex('**/*.test.mjs')
    expect(re.test('rules/adr/check.test.mjs')).toBe(true)
    expect(re.test('check.test.mjs')).toBe(true)
    expect(re.test('check.mjs')).toBe(false)
  })

  test('trailing **', () => {
    const re = globToRegex('rules/test/**')
    expect(re.test('rules/test/js/check.mjs')).toBe(true)
    expect(re.test('rules/other/js/check.mjs')).toBe(false)
  })

  test('спецсимволи RegExp у назві файлу екрануються', () => {
    const re = globToRegex('tsconfig.emit-types.json')
    expect(re.test('tsconfig.emit-types.json')).toBe(true)
    expect(re.test('tsconfig-emit-types-json')).toBe(false)
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
  test('знаходить vitest статичний імпорт', () => {
    const code = `import { describe, test } from 'vitest'\ndescribe('x', () => {})\n`
    expect(findTestFrameworkImport(code, 'check.test.mjs')).toBe('vitest')
  })

  test('знаходить bun:test статичний імпорт', () => {
    const code = `import { test } from 'bun:test'\ntest('x', () => {})\n`
    expect(findTestFrameworkImport(code, 'check.test.mjs')).toBe('bun:test')
  })

  test('знаходить vitest через dynamic import', () => {
    const code = `const { test } = await import('vitest')\n`
    expect(findTestFrameworkImport(code, 'check.test.mjs')).toBe('vitest')
  })

  test('знаходить mocha через require', () => {
    const code = `const { describe } = require('mocha')\n`
    expect(findTestFrameworkImport(code, 'check.test.cjs')).toBe('mocha')
  })

  test('null для звичайного JS без тест-імпортів', () => {
    const code = `import { readFile } from 'node:fs/promises'\nexport function foo() {}\n`
    expect(findTestFrameworkImport(code, 'helper.mjs')).toBeNull()
  })

  test('null для синтаксичної помилки', () => {
    const code = `import { from 'vitest'\n`
    expect(findTestFrameworkImport(code, 'bad.mjs')).toBeNull()
  })

  test('null для порожнього файлу', () => {
    expect(findTestFrameworkImport('', 'empty.mjs')).toBeNull()
  })
})
