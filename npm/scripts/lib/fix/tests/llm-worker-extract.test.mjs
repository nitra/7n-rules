import { describe, expect, test } from 'vitest'
import { extractFilePaths } from '../llm-worker.mjs'

describe('extractFilePaths', () => {
  describe('❌ рядки — явний парсинг', () => {
    test('bare filename: ❌ main.mdc: msg', () => {
      expect(extractFilePaths('❌ main.mdc: відсутнє посилання')).toContain('main.mdc')
    })

    test('повний шлях: ❌ .cursor/rules/n-text.mdc: msg', () => {
      expect(extractFilePaths('❌ .cursor/rules/n-text.mdc: у прикладі')).toContain('.cursor/rules/n-text.mdc')
    })

    test('workspace prefix: ❌ [npm] rules/foo.mjs:92 — msg', () => {
      expect(extractFilePaths('❌ [npm] rules/foo.mjs:92 — пряме присвоєння')).toContain('npm/rules/foo.mjs')
    })

    test('em-dash роздільник без пробілу: ❌ file.mjs:35—msg', () => {
      expect(extractFilePaths('❌ foo/bar.mjs:35—some error')).toContain('foo/bar.mjs')
    })

    test('відступ перед ❌: "  ❌ main.mdc: msg"', () => {
      expect(extractFilePaths('  ❌ main.mdc: відсутнє')).toContain('main.mdc')
    })

    test('directory без розширення — не витягує: ❌ rules/ga: немає lint.mjs', () => {
      const paths = extractFilePaths('❌ rules/ga: lint:"full" але немає js/lint.mjs')
      expect(paths).not.toContain('rules/ga')
    })
  })

  describe('generic regex — контекст ✅ і описи', () => {
    test('✅ рядок з файлом підтягується як контекст', () => {
      expect(extractFilePaths('✅ bunfig.toml є')).toContain('bunfig.toml')
    })

    test('workspace ✅: [npm] rules/foo.mjs', () => {
      expect(extractFilePaths('✅ [npm] rules/text/js/cspell-fix.mjs: ok')).toContain(
        'npm/rules/text/js/cspell-fix.mjs'
      )
    })
  })

  describe('дедуплікація', () => {
    test('❌ і generic regex не дублюють той самий файл', () => {
      const output = '❌ main.mdc: відсутнє\n  деталі main.mdc тут'
      const paths = extractFilePaths(output)
      expect(paths.filter(p => p === 'main.mdc')).toHaveLength(1)
    })

    test('❌ workspace і generic не дублюють: [npm] foo.mjs', () => {
      const output = '❌ [npm] rules/foo.mjs:5 — err\nдивись [npm] rules/foo.mjs'
      const paths = extractFilePaths(output)
      expect(paths.filter(p => p === 'npm/rules/foo.mjs')).toHaveLength(1)
    })
  })

  describe('порядок: ❌ файли першими', () => {
    test('❌ файл іде перед ✅ файлом у результаті', () => {
      const output = '✅ bunfig.toml є\n❌ main.mdc: відсутнє'
      const paths = extractFilePaths(output)
      expect(paths.indexOf('main.mdc')).toBeLessThan(paths.indexOf('bunfig.toml'))
    })
  })
})
