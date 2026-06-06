/**
 * Тести для skills/fix/js/t0.mjs:
 *   - applyT0Auto: кожен паттерн (vscode-ext-add, rm-forbidden-file)
 *   - filterT0AutoRules: відсіює правила без T0 паттерну
 *   - edge cases: дублікати, відсутні файли, невалідний JSON
 */
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { withTmpDir } from '../../../../scripts/utils/test-helpers.mjs'
import { applyT0Auto, filterT0AutoRules } from '../t0.mjs'

// ─── applyT0Auto: vscode-ext-add ─────────────────────────────────────────────

describe('applyT0Auto: vscode-ext-add', () => {
  test('додає відсутнє розширення до recommendations', async () => {
    await withTmpDir(async dir => {
      mkdirSync(join(dir, '.vscode'))
      writeFileSync(
        join(dir, '.vscode/extensions.json'),
        JSON.stringify({ recommendations: ['existing.ext'] }, null, 2),
        'utf8'
      )

      const result = applyT0Auto(
        'rego',
        '❌ .vscode/extensions.json: recommendations має містити "tsandall.opa" (rego.mdc)',
        dir
      )

      expect(result.applied).toBe(true)
      expect(result.actions).toHaveLength(1)
      expect(result.actions[0]).toContain('tsandall.opa')

      const written = JSON.parse(readFileSync(join(dir, '.vscode/extensions.json'), 'utf8'))
      expect(written.recommendations).toContain('tsandall.opa')
      expect(written.recommendations).toContain('existing.ext')
    })
  })

  test('не дублює якщо розширення вже є', async () => {
    await withTmpDir(async dir => {
      mkdirSync(join(dir, '.vscode'))
      writeFileSync(
        join(dir, '.vscode/extensions.json'),
        JSON.stringify({ recommendations: ['tsandall.opa'] }, null, 2),
        'utf8'
      )

      const result = applyT0Auto(
        'rego',
        'recommendations має містити "tsandall.opa"',
        dir
      )

      expect(result.applied).toBe(false)
      expect(result.actions[0]).toContain('вже є')
    })
  })

  test('додає кілька розширень з одного output', async () => {
    await withTmpDir(async dir => {
      mkdirSync(join(dir, '.vscode'))
      writeFileSync(
        join(dir, '.vscode/extensions.json'),
        JSON.stringify({ recommendations: [] }, null, 2),
        'utf8'
      )

      const result = applyT0Auto(
        'multi',
        'recommendations має містити "tsandall.opa"\nrecommendations має містити "stylelint.vscode-stylelint"',
        dir
      )

      expect(result.applied).toBe(true)
      const written = JSON.parse(readFileSync(join(dir, '.vscode/extensions.json'), 'utf8'))
      expect(written.recommendations).toContain('tsandall.opa')
      expect(written.recommendations).toContain('stylelint.vscode-stylelint')
    })
  })

  test('повертає applied=false якщо .vscode/extensions.json відсутній', async () => {
    await withTmpDir(async dir => {
      const result = applyT0Auto(
        'rego',
        'recommendations має містити "tsandall.opa"',
        dir
      )
      expect(result.applied).toBe(false)
      expect(result.actions[0]).toContain('не знайдено')
    })
  })

  test('повертає applied=false якщо extensions.json невалідний JSON', async () => {
    await withTmpDir(async dir => {
      mkdirSync(join(dir, '.vscode'))
      writeFileSync(join(dir, '.vscode/extensions.json'), 'not-json', 'utf8')

      const result = applyT0Auto(
        'rego',
        'recommendations має містити "tsandall.opa"',
        dir
      )
      expect(result.applied).toBe(false)
      expect(result.actions[0]).toContain('невалідний JSON')
    })
  })
})

// ─── applyT0Auto: rm-forbidden-file ─────────────────────────────────────────

describe('applyT0Auto: rm-forbidden-file', () => {
  test('видаляє заборонений файл', async () => {
    await withTmpDir(async dir => {
      writeFileSync(join(dir, 'package-lock.json'), '{}', 'utf8')

      const result = applyT0Auto(
        'bun',
        '❌ Знайдено заборонений файл: package-lock.json — видали його',
        dir
      )

      expect(result.applied).toBe(true)
      expect(result.actions[0]).toContain('package-lock.json')
      expect(existsSync(join(dir, 'package-lock.json'))).toBe(false)
    })
  })

  test('видаляє кілька заборонених файлів', async () => {
    await withTmpDir(async dir => {
      writeFileSync(join(dir, 'package-lock.json'), '{}', 'utf8')
      writeFileSync(join(dir, 'yarn.lock'), '', 'utf8')

      const result = applyT0Auto(
        'bun',
        'Знайдено заборонений файл: package-lock.json\nЗнайдено заборонений файл: yarn.lock',
        dir
      )

      expect(result.applied).toBe(true)
      expect(existsSync(join(dir, 'package-lock.json'))).toBe(false)
      expect(existsSync(join(dir, 'yarn.lock'))).toBe(false)
    })
  })

  test('applied=false якщо файл вже відсутній', async () => {
    await withTmpDir(async dir => {
      const result = applyT0Auto(
        'bun',
        'Знайдено заборонений файл: package-lock.json',
        dir
      )
      expect(result.applied).toBe(false)
      expect(result.actions[0]).toContain('не знайдено')
    })
  })
})

// ─── applyT0Auto: без паттерну ───────────────────────────────────────────────

describe('applyT0Auto: output без T0 паттерну', () => {
  test('повертає applied=false для нерозпізнаного output', async () => {
    await withTmpDir(async dir => {
      const result = applyT0Auto('ci4', 'ESLint: no-console violation in src/main.js', dir)
      expect(result.applied).toBe(false)
      expect(result.actions).toHaveLength(0)
    })
  })
})

// ─── filterT0AutoRules ────────────────────────────────────────────────────────

describe('filterT0AutoRules', () => {
  test('повертає лише правила з T0 паттерном', () => {
    const rules = [
      { ruleId: 'rego', output: 'recommendations має містити "tsandall.opa"' },
      { ruleId: 'ci4', output: 'ESLint: no-console violation' },
      { ruleId: 'bun', output: 'Знайдено заборонений файл: package-lock.json' },
    ]
    const t0Rules = filterT0AutoRules(rules)
    expect(t0Rules).toContain('rego')
    expect(t0Rules).toContain('bun')
    expect(t0Rules).not.toContain('ci4')
  })

  test('порожній масив якщо жодного T0 паттерну', () => {
    const rules = [{ ruleId: 'ci4', output: 'no match here' }]
    expect(filterT0AutoRules(rules)).toEqual([])
  })
})
