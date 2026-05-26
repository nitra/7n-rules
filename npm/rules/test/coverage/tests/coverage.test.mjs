/**
 * Тести оркестратора `n-cursor coverage` (test.mdc):
 *   - pure helpers: addCoverage, addMutation, formatCoverage, formatScore, renderMarkdown;
 *   - runCoverageSteps: discovery провайдерів за `.n-cursor.json#rules`,
 *     агрегація, запис COVERAGE.md, обробка edge cases.
 */
import { describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  addCoverage,
  addMutation,
  formatCoverage,
  formatScore,
  renderMarkdown,
  runCoverageSteps
} from '../coverage.mjs'

const SURVIVED_JSON_BLOCK = /```json\n([\s\S]*?)\n```/

describe('addCoverage', () => {
  test('покомпонентне додавання lines та functions', () => {
    const a = { lines: { covered: 10, total: 20 }, functions: { covered: 3, total: 5 } }
    const b = { lines: { covered: 5, total: 8 }, functions: { covered: 2, total: 4 } }
    expect(addCoverage(a, b)).toEqual({
      lines: { covered: 15, total: 28 },
      functions: { covered: 5, total: 9 }
    })
  })
})

describe('addMutation', () => {
  test('покомпонентне додавання caught та total', () => {
    expect(addMutation({ caught: 4, total: 10 }, { caught: 2, total: 7 })).toEqual({ caught: 6, total: 17 })
  })
})

describe('formatCoverage', () => {
  test('обчислює відсоток і додає (covered/total)', () => {
    expect(formatCoverage({ covered: 50, total: 200 })).toBe('25.00% (50/200)')
  })

  test('total === 0 → прочерк', () => {
    expect(formatCoverage({ covered: 0, total: 0 })).toBe('— (0/0)')
  })
})

describe('formatScore', () => {
  test('обчислює відсоток мутаційного score', () => {
    expect(formatScore({ caught: 7, total: 10 })).toBe('70.00%')
  })

  test('total === 0 → прочерк', () => {
    expect(formatScore({ caught: 0, total: 0 })).toBe('—')
  })
})

describe('renderMarkdown', () => {
  test('рендерить таблицю в українській локалізації', () => {
    const rows = [
      {
        area: 'JS',
        coverage: { lines: { covered: 50, total: 100 }, functions: { covered: 10, total: 20 } },
        mutation: { caught: 7, total: 10 }
      }
    ]
    const md = renderMarkdown(rows)
    expect(md).toContain('# Coverage')
    expect(md).toContain('| Область | Рядки | Функції | Вбито мутацій | Score |')
    expect(md).toContain('| JS | 50.00% (50/100) | 50.00% (10/20) | 7/10 | 70.00% |')
    expect(md.endsWith('\n')).toBe(true)
  })

  test('рядки без survived не додають розділ Вижилі мутанти', () => {
    const rows = [
      {
        area: 'JS',
        coverage: { lines: { covered: 10, total: 10 }, functions: { covered: 5, total: 5 } },
        mutation: { caught: 5, total: 5 }
      }
    ]
    const md = renderMarkdown(rows)
    expect(md).not.toContain('## Вижилі мутанти')
  })

  test('додає секцію Вижилі мутанти з таблицею коли є survived мутанти', () => {
    const rows = [
      {
        area: 'JS',
        coverage: { lines: { covered: 10, total: 20 }, functions: { covered: 5, total: 10 } },
        mutation: { caught: 3, total: 5 },
        survived: [
          {
            file: 'src/auth.js',
            mutants: [
              {
                line: 12,
                col: 0,
                original: 'if (x === null)',
                replacement: 'false',
                mutantType: 'ConditionalExpression'
              },
              { line: 15, col: 0, original: 'return true', replacement: 'return false', mutantType: 'BooleanLiteral' }
            ],
            exampleTest: null,
            recommendationText: null
          }
        ]
      }
    ]
    const md = renderMarkdown(rows)
    expect(md).toContain('## Вижилі мутанти')
    expect(md).not.toContain('## Recommendations')
    expect(md).toContain('### src/auth.js')
    expect(md).toContain('| 12 |')
    expect(md).toContain('ConditionalExpression')
    expect(md).toContain('BooleanLiteral')
  })
})

describe('renderMarkdown — секція вижилих мутантів', () => {
  const survivedFixture = [
    {
      file: 'src/auth.js',
      mutants: [
        { line: 12, col: 0, mutantType: 'ConditionalExpression', original: 'if (x === null)', replacement: 'false' },
        { line: 15, col: 0, mutantType: 'BooleanLiteral', original: 'return true', replacement: 'return false' }
      ],
      exampleTest: null,
      recommendationText: null
    }
  ]

  test('секція називається "Вижилі мутанти", а не "Recommendations"', () => {
    const rows = [
      {
        area: 'JS',
        coverage: { lines: { covered: 10, total: 20 }, functions: { covered: 5, total: 10 } },
        mutation: { caught: 3, total: 5 },
        survived: survivedFixture
      }
    ]
    const md = renderMarkdown(rows)
    expect(md).toContain('## Вижилі мутанти')
    expect(md).not.toContain('## Recommendations')
  })

  test('містить ```json блок з масивом survived, придатний для /n-fix-tests', () => {
    const rows = [
      {
        area: 'JS',
        coverage: { lines: { covered: 10, total: 20 }, functions: { covered: 5, total: 10 } },
        mutation: { caught: 3, total: 5 },
        survived: survivedFixture
      }
    ]
    const md = renderMarkdown(rows)
    const jsonMatch = md.match(SURVIVED_JSON_BLOCK)
    expect(jsonMatch).not.toBeNull()
    const parsed = JSON.parse(jsonMatch[1])
    expect(parsed).toEqual(survivedFixture)
  })

  test('людиночитабельна таблиця залишається після JSON-блоку', () => {
    const rows = [
      {
        area: 'JS',
        coverage: { lines: { covered: 10, total: 20 }, functions: { covered: 5, total: 10 } },
        mutation: { caught: 3, total: 5 },
        survived: survivedFixture
      }
    ]
    const md = renderMarkdown(rows)
    expect(md).toContain('### src/auth.js')
    expect(md).toContain('| Рядок | Оригінал | Заміна | Тип |')
    expect(md).toContain('| 12 |')
    expect(md).toContain('ConditionalExpression')
  })

  test('НЕ додає секцію коли survived порожній або відсутній', () => {
    const rowsEmpty = [
      {
        area: 'JS',
        coverage: { lines: { covered: 50, total: 100 }, functions: { covered: 10, total: 20 } },
        mutation: { caught: 2, total: 2 },
        survived: []
      }
    ]
    expect(renderMarkdown(rowsEmpty)).not.toContain('## Вижилі мутанти')
    const rowsNone = [
      {
        area: 'JS',
        coverage: { lines: { covered: 50, total: 100 }, functions: { covered: 10, total: 20 } },
        mutation: { caught: 2, total: 2 }
      }
    ]
    expect(renderMarkdown(rowsNone)).not.toContain('## Вижилі мутанти')
  })
})

const ONE_ROW_PROVIDER = `
  export async function detect() { return true }
  export async function collect() {
    return [{
      area: 'Test',
      coverage: { lines: { covered: 10, total: 20 }, functions: { covered: 3, total: 5 } },
      mutation: { caught: 4, total: 5 }
    }]
  }
`

const SKIP_PROVIDER = `
  export async function detect() { return false }
  export async function collect() { throw new Error('should not be called') }
`

/**
 * Тимчасовий cwd + rulesDir з ін'єктованими coverage-провайдерами для runCoverageSteps.
 * @param {{rules?: string[], providers?: Record<string,string>}} [opts] активні rules і provider source
 * @returns {{cwd: string, rulesDir: string, cleanup: () => void}} fixture з функцією cleanup
 */
function makeOrchestratorFixture({ rules = [], providers = {} } = {}) {
  const cwd = mkdtempSync(join(tmpdir(), 'orchestrator-cwd-'))
  writeFileSync(join(cwd, '.n-cursor.json'), JSON.stringify({ rules }))

  const rulesDir = mkdtempSync(join(tmpdir(), 'orchestrator-rules-'))
  for (const [ruleId, providerSource] of Object.entries(providers)) {
    const providerDir = join(rulesDir, ruleId, 'coverage')
    mkdirSync(providerDir, { recursive: true })
    writeFileSync(join(providerDir, 'coverage.mjs'), providerSource)
  }

  return {
    cwd,
    rulesDir,
    cleanup() {
      rmSync(cwd, { recursive: true, force: true })
      rmSync(rulesDir, { recursive: true, force: true })
    }
  }
}

describe('runCoverageSteps', () => {
  test('агрегує дані одного провайдера і додає рядок Разом', async () => {
    const fx = makeOrchestratorFixture({ rules: ['js-lint'], providers: { 'js-lint': ONE_ROW_PROVIDER } })
    const exitCode = await runCoverageSteps({ cwd: fx.cwd, rulesDir: fx.rulesDir })
    expect(exitCode).toBe(0)
    const md = readFileSync(join(fx.cwd, 'COVERAGE.md'), 'utf8')
    expect(md).toContain('| Test |')
    expect(md).toContain('| **Разом** |')
    fx.cleanup()
  })

  test('пропускає правила без провайдера (silently)', async () => {
    const fx = makeOrchestratorFixture({
      rules: ['js-lint', 'no-such-rule'],
      providers: { 'js-lint': ONE_ROW_PROVIDER }
    })
    const exitCode = await runCoverageSteps({ cwd: fx.cwd, rulesDir: fx.rulesDir })
    expect(exitCode).toBe(0)
    fx.cleanup()
  })

  test('пропускає правила де detect() === false', async () => {
    const fx = makeOrchestratorFixture({
      rules: ['js-lint', 'rust'],
      providers: { 'js-lint': ONE_ROW_PROVIDER, rust: SKIP_PROVIDER }
    })
    const exitCode = await runCoverageSteps({ cwd: fx.cwd, rulesDir: fx.rulesDir })
    expect(exitCode).toBe(0)
    const md = readFileSync(join(fx.cwd, 'COVERAGE.md'), 'utf8')
    expect(md).toContain('| Test |')
    fx.cleanup()
  })

  test('exit 1 коли жоден провайдер не відпрацював', async () => {
    const fx = makeOrchestratorFixture({ rules: ['js-lint'], providers: { 'js-lint': SKIP_PROVIDER } })
    const exitCode = await runCoverageSteps({ cwd: fx.cwd, rulesDir: fx.rulesDir })
    expect(exitCode).toBe(1)
    fx.cleanup()
  })

  test('пропускає модулі без detect/collect (наприклад сам оркестратор)', async () => {
    // Edge case: коли test rule у .n-cursor.json#rules, loadProvider знаходить
    // власний npm/rules/test/coverage/coverage.mjs, але це оркестратор без detect/collect.
    const NOT_A_PROVIDER = `
      export function something() {}
      export const otherExport = 42
    `
    const fx = makeOrchestratorFixture({
      rules: ['test', 'js-lint'],
      providers: { test: NOT_A_PROVIDER, 'js-lint': ONE_ROW_PROVIDER }
    })
    const exitCode = await runCoverageSteps({ cwd: fx.cwd, rulesDir: fx.rulesDir })
    expect(exitCode).toBe(0)
    const md = readFileSync(join(fx.cwd, 'COVERAGE.md'), 'utf8')
    expect(md).toContain('| Test |')
    fx.cleanup()
  })

  test('агрегує два провайдери і рахує total коректно', async () => {
    const fx = makeOrchestratorFixture({
      rules: ['js-lint', 'rust'],
      providers: { 'js-lint': ONE_ROW_PROVIDER, rust: ONE_ROW_PROVIDER }
    })
    const exitCode = await runCoverageSteps({ cwd: fx.cwd, rulesDir: fx.rulesDir })
    expect(exitCode).toBe(0)
    const md = readFileSync(join(fx.cwd, 'COVERAGE.md'), 'utf8')
    // Два рядки Test + один Разом = 3 рядки після хедера
    expect(md.match(/\| Test \|/g)).toHaveLength(2)
    // Разом: lines 20/40 → 50.00%; functions 6/10 → 60.00%; mutation 8/10 → 80.00%
    expect(md).toContain('| **Разом** | 50.00% (20/40) | 60.00% (6/10) | 8/10 | 80.00% |')
    fx.cleanup()
  })
})
