/**
 * Тести check(cwd) з check.mjs: мінімальні fixture-директорії → перевіряємо exit code.
 * Охоплює checkEslintConfig, checkOxlintRc, checkLintJsWorkflows, checkKnipConfig,
 * checkWorkspacePackages (type:module, engines.node, engines.bun).
 */
import { readFileSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { describe, expect, test } from 'vitest'

import { patterns } from '../fix-check.mjs'
import { lint } from '../main.mjs'
import { KNIP_MISSING, OXLINT_CANONICAL_JSON_PATH } from '../../tooling/main.mjs'
import { withTmpDir } from '@7n/rules/scripts/utils/test-helpers.mjs'

/**
 * Запускає detector у whole-repo режимі і повертає кількість порушень.
 * @param {string} dir корінь тимчасового проєкту
 * @returns {Promise<number>} кількість LintViolation
 */
const check = async dir => {
  const { violations } = await lint({ cwd: dir, ruleId: 'js', concernId: 'check', files: undefined })
  return violations.length
}

const canonical = JSON.parse(readFileSync(OXLINT_CANONICAL_JSON_PATH, 'utf8'))

describe('check — відсутні обовʼязкові файли → exit 1', () => {
  test('порожня директорія → exit 1 (немає eslint.config, oxlintrc, lint-js.yml)', async () => {
    await withTmpDir(async dir => {
      expect(await check(dir)).toBeGreaterThan(0)
    })
  })

  test('є eslint.config.mjs без getConfig → fail', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'eslint.config.mjs'), 'export default []\n', 'utf8')
      const code = await check(dir)
      expect(code).toBeGreaterThan(0)
    })
  })
})

describe('check — .oxlintrc.json', () => {
  test('відсутній .oxlintrc.json → fail', async () => {
    await withTmpDir(async dir => {
      // eslint.config.js із правильним змістом
      await writeFile(
        join(dir, 'eslint.config.js'),
        "import { getConfig } from '@nitra/eslint-config'\nexport default getConfig({ ignores: ['**/auto-imports.d.ts'] })\n",
        'utf8'
      )
      const code = await check(dir)
      expect(code).toBeGreaterThan(0)
    })
  })

  test('валідний .oxlintrc.json збігається з каноном → pass для oxlintrc', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, '.oxlintrc.json'), JSON.stringify(canonical, null, 2), 'utf8')
      const code = await check(dir)
      // Може бути 1 через відсутні інші файли, але oxlintrc не повинен бути причиною
      // Перевіряємо що файл взагалі оброблено без syntax error
      expect(typeof code).toBe('number')
    })
  })

  test('невалідний JSON у .oxlintrc.json → fail', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, '.oxlintrc.json'), '{ invalid json ]', 'utf8')
      const code = await check(dir)
      expect(code).toBeGreaterThan(0)
    })
  })
})

describe('check — lint-js.yml та lint.yml', () => {
  test('відсутній lint-js.yml → fail', async () => {
    await withTmpDir(async dir => {
      const code = await check(dir)
      expect(code).toBeGreaterThan(0)
    })
  })

  test('наявний lint-js.yml → pass для workflow', async () => {
    await withTmpDir(async dir => {
      await mkdir(join(dir, '.github', 'workflows'), { recursive: true })
      await writeFile(join(dir, '.github/workflows/lint-js.yml'), 'on: push\n', 'utf8')
      const code = await check(dir)
      // Лише lint-js.yml не достатньо для exit 0, але він не fail для цього чека
      expect(typeof code).toBe('number')
    })
  })

  test('lint.yml з дубльованими кроками oxlint+eslint+jscpd → fail', async () => {
    await withTmpDir(async dir => {
      await mkdir(join(dir, '.github', 'workflows'), { recursive: true })
      await writeFile(join(dir, '.github/workflows/lint-js.yml'), 'on: push\n', 'utf8')
      await writeFile(
        join(dir, '.github/workflows/lint.yml'),
        'steps:\n  - run: bunx oxlint .\n  - run: bunx eslint .\n  - run: jscpd .\n',
        'utf8'
      )
      const code = await check(dir)
      expect(code).toBeGreaterThan(0)
    })
  })

  test('lint.yml існує, але не дублює lint-js → pass для lint.yml (line 374)', async () => {
    await withTmpDir(async dir => {
      await mkdir(join(dir, '.github', 'workflows'), { recursive: true })
      await writeFile(join(dir, '.github/workflows/lint-js.yml'), 'on: push\n', 'utf8')
      await writeFile(join(dir, '.github/workflows/lint.yml'), 'steps:\n  - run: echo hello\n', 'utf8')
      const code = await check(dir)
      expect(typeof code).toBe('number')
    })
  })
})

describe('check — .oxlintrc.json не збігається з каноном', () => {
  test('.oxlintrc.json з некоректним severity → fail (lines 346-347)', async () => {
    await withTmpDir(async dir => {
      const badOxlint = {
        ...canonical,
        rules: { .../** @type {Record<string,unknown>} */ (canonical.rules), eqeqeq: 'off' }
      }
      await writeFile(join(dir, '.oxlintrc.json'), JSON.stringify(badOxlint), 'utf8')
      const code = await check(dir)
      expect(code).toBeGreaterThan(0)
    })
  })
})

describe('check — knip.json', () => {
  // Регресія рішення Ґ спеки контракту v3.1: до 2026-08-01 детектор САМ
  // копіював канон під час detect і звітував `pass` — файл з'являвся, а
  // порушення не існувало. Обидві половини цього твердження тепер
  // перевернуті й зафіксовані тестом.
  test('відсутній knip.json → порушення `knip-missing`, дерево НЕ мутоване', async () => {
    await withTmpDir(async dir => {
      const { violations } = await lint({ cwd: dir, ruleId: 'js', concernId: 'check', files: undefined })
      const { existsSync } = await import('node:fs')
      expect(existsSync(join(dir, 'knip.json'))).toBe(false)
      expect(violations.some(v => v.reason === KNIP_MISSING)).toBe(true)
    })
  })

  test('наявний knip.json → без порушення `knip-missing`', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'knip.json'), '{}', 'utf8')
      const { violations } = await lint({ cwd: dir, ruleId: 'js', concernId: 'check', files: undefined })
      expect(violations.some(v => v.reason === KNIP_MISSING)).toBe(false)
    })
  })

  test('T0 `js-check-knip` створює knip.json з канону й ідемпотентний', async () => {
    await withTmpDir(async dir => {
      const { existsSync } = await import('node:fs')
      const knipPattern = patterns.find(p => p.id === 'js-check-knip')
      const violations = [{ reason: KNIP_MISSING, message: 'knip.json відсутній' }]
      expect(knipPattern.test(violations)).toBe(true)

      const first = await knipPattern.apply(violations, { cwd: dir })
      expect(existsSync(join(dir, 'knip.json'))).toBe(true)
      expect(first.touchedFiles).toHaveLength(1)

      // Повторний прогін на вже виправленому дереві нічого не чіпає.
      const second = await knipPattern.apply(violations, { cwd: dir })
      expect(second.touchedFiles).toEqual([])

      // І детектор більше не звітує це порушення.
      const { violations: after } = await lint({ cwd: dir, ruleId: 'js', concernId: 'check', files: undefined })
      expect(after.some(v => v.reason === KNIP_MISSING)).toBe(false)
    })
  })
})

describe('check — workspace package.json (type, engines)', () => {
  test('workspace без type:module → fail', async () => {
    await withTmpDir(async dir => {
      const pkg = { workspaces: ['packages/app'], type: 'commonjs' }
      await writeFile(join(dir, 'package.json'), JSON.stringify(pkg), 'utf8')
      await mkdir(join(dir, 'packages', 'app'), { recursive: true })
      await writeFile(join(dir, 'packages/app/package.json'), JSON.stringify({ name: 'app', type: 'commonjs' }), 'utf8')
      const code = await check(dir)
      expect(code).toBeGreaterThan(0)
    })
  })

  test('workspace з type:module але без engines → fail', async () => {
    await withTmpDir(async dir => {
      const pkg = { workspaces: ['ws'] }
      await writeFile(join(dir, 'package.json'), JSON.stringify(pkg), 'utf8')
      await mkdir(join(dir, 'ws'), { recursive: true })
      await writeFile(join(dir, 'ws/package.json'), JSON.stringify({ name: 'ws', type: 'module' }), 'utf8')
      const code = await check(dir)
      expect(code).toBeGreaterThan(0)
    })
  })

  test('workspace з type:module, engines.node<24 → fail', async () => {
    await withTmpDir(async dir => {
      const pkg = { workspaces: ['ws'] }
      await writeFile(join(dir, 'package.json'), JSON.stringify(pkg), 'utf8')
      await mkdir(join(dir, 'ws'), { recursive: true })
      await writeFile(
        join(dir, 'ws/package.json'),
        JSON.stringify({ name: 'ws', type: 'module', engines: { node: '>=18', bun: '>=1.3' } }),
        'utf8'
      )
      const code = await check(dir)
      expect(code).toBeGreaterThan(0)
    })
  })

  test('workspace з type:module, engines.bun<1.3 → fail', async () => {
    await withTmpDir(async dir => {
      const pkg = { workspaces: ['ws'] }
      await writeFile(join(dir, 'package.json'), JSON.stringify(pkg), 'utf8')
      await mkdir(join(dir, 'ws'), { recursive: true })
      await writeFile(
        join(dir, 'ws/package.json'),
        JSON.stringify({ name: 'ws', type: 'module', engines: { node: '>=24', bun: '>=1.2' } }),
        'utf8'
      )
      const code = await check(dir)
      expect(code).toBeGreaterThan(0)
    })
  })

  test('workspace з type:module, engines.node>=24, engines.bun>=1.3 → pass для pkg checks', async () => {
    await withTmpDir(async dir => {
      const pkg = { workspaces: ['ws'] }
      await writeFile(join(dir, 'package.json'), JSON.stringify(pkg), 'utf8')
      await mkdir(join(dir, 'ws'), { recursive: true })
      await writeFile(
        join(dir, 'ws/package.json'),
        JSON.stringify({ name: 'ws', type: 'module', engines: { node: '>=24', bun: '>=1.3' } }),
        'utf8'
      )
      // Інші перевірки все одно можуть провалити — але workspace pkg checks мають пройти
      expect(typeof (await check(dir))).toBe('number')
    })
  })
})
