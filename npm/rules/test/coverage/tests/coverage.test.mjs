/**
 * Тести оркестратора `n-cursor coverage` (test.mdc):
 *   - pure helpers: addCoverage, addMutation, formatCoverage, formatScore, renderMarkdown;
 *   - runCoverageSteps: discovery провайдерів за `.n-cursor.json#rules`,
 *     агрегація, запис COVERAGE.md, обробка edge cases.
 */
import { afterEach, describe, expect, test, vi } from 'vitest'
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

  test('рядки без survived не додають розділ Вцілілі мутанти', () => {
    const rows = [
      {
        area: 'JS',
        coverage: { lines: { covered: 10, total: 10 }, functions: { covered: 5, total: 5 } },
        mutation: { caught: 5, total: 5 }
      }
    ]
    const md = renderMarkdown(rows)
    expect(md).not.toContain('## Вцілілі мутанти')
  })

  test('додає секцію Вцілілі мутанти з таблицею коли є survived мутанти', () => {
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
    expect(md).toContain('## Вцілілі мутанти')
    expect(md).not.toContain('## Recommendations')
    expect(md).toContain('### src/auth.js')
    expect(md).toContain('| 12 |')
    expect(md).toContain('ConditionalExpression')
    expect(md).toContain('BooleanLiteral')
  })
})

describe('renderMarkdown — секція вцілілих мутантів', () => {
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

  test('секція називається "Вцілілі мутанти", а не "Recommendations"', () => {
    const rows = [
      {
        area: 'JS',
        coverage: { lines: { covered: 10, total: 20 }, functions: { covered: 5, total: 10 } },
        mutation: { caught: 3, total: 5 },
        survived: survivedFixture
      }
    ]
    const md = renderMarkdown(rows)
    expect(md).toContain('## Вцілілі мутанти')
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

  test('зрозуміла для людини таблиця залишається після JSON-блоку', () => {
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
    expect(renderMarkdown(rowsEmpty)).not.toContain('## Вцілілі мутанти')
    const rowsNone = [
      {
        area: 'JS',
        coverage: { lines: { covered: 50, total: 100 }, functions: { covered: 10, total: 20 } },
        mutation: { caught: 2, total: 2 }
      }
    ]
    expect(renderMarkdown(rowsNone)).not.toContain('## Вцілілі мутанти')
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

describe('renderMarkdown — точні розділювачі та порожні рядки', () => {
  test('містить empty-line після "# Coverage" і header separator таблиці на 5 стовпців', () => {
    const rows = [
      {
        area: 'JS',
        coverage: { lines: { covered: 50, total: 100 }, functions: { covered: 10, total: 20 } },
        mutation: { caught: 7, total: 10 }
      }
    ]
    const md = renderMarkdown(rows)
    // \n\n після '# Coverage' = empty line (line 82) + рівно цей header separator (line 83-84)
    expect(md).toContain('# Coverage\n\n| Область | Рядки | Функції | Вбито мутацій | Score |\n| --- | --- | --- | --- | --- |\n')
  })

  test('обрамлює секцію "## Вцілілі мутанти" порожніми рядками і ```json блоком', () => {
    const rows = [
      {
        area: 'JS',
        coverage: { lines: { covered: 10, total: 20 }, functions: { covered: 5, total: 10 } },
        mutation: { caught: 3, total: 5 },
        survived: [
          {
            file: 'src/auth.js',
            mutants: [
              { line: 12, col: 0, mutantType: 'ConditionalExpression', original: 'if (x)', replacement: 'false' }
            ],
            exampleTest: null,
            recommendationText: null
          }
        ]
      }
    ]
    const md = renderMarkdown(rows)
    // \n\n## Вцілілі мутанти\n\n```json (line 95 — два empty-line літерали)
    expect(md).toContain('\n\n## Вцілілі мутанти\n\n```json\n')
  })

  test('per-file секція має empty-lines та header separator 4-стовпцевої таблиці', () => {
    const rows = [
      {
        area: 'JS',
        coverage: { lines: { covered: 10, total: 20 }, functions: { covered: 5, total: 10 } },
        mutation: { caught: 3, total: 5 },
        survived: [
          {
            file: 'src/auth.js',
            mutants: [
              { line: 12, col: 0, mutantType: 'ConditionalExpression', original: 'if (x)', replacement: 'false' }
            ],
            exampleTest: null,
            recommendationText: null
          }
        ]
      }
    ]
    const md = renderMarkdown(rows)
    // line 98 — empty, '### file', empty, header, separator '| --- | --- | --- | --- |'
    expect(md).toContain('\n\n### src/auth.js\n\n| Рядок | Оригінал | Заміна | Тип |\n| --- | --- | --- | --- |\n')
  })

  test('exampleTest рендериться як ```js блок з testFile та кодом', () => {
    const rows = [
      {
        area: 'JS',
        coverage: { lines: { covered: 10, total: 20 }, functions: { covered: 5, total: 10 } },
        mutation: { caught: 3, total: 5 },
        survived: [
          {
            file: 'src/auth.js',
            mutants: [
              { line: 12, col: 0, mutantType: 'ConditionalExpression', original: 'if (x)', replacement: 'false' }
            ],
            exampleTest: { testFile: 'tests/auth.test.mjs', code: 'expect(x).toBe(1)' },
            recommendationText: null
          }
        ]
      }
    ]
    const md = renderMarkdown(rows)
    // Порожній рядок (L104) має створювати \n\n перед "**Приклад тесту**"
    expect(md).toContain('\n\n**Приклад тесту** (`tests/auth.test.mjs`):')
    expect(md).toContain('```js\nexpect(x).toBe(1)\n```')
  })

  test('exampleTest === null → блок "Приклад тесту" відсутній', () => {
    const rows = [
      {
        area: 'JS',
        coverage: { lines: { covered: 10, total: 20 }, functions: { covered: 5, total: 10 } },
        mutation: { caught: 3, total: 5 },
        survived: [
          {
            file: 'src/auth.js',
            mutants: [
              { line: 12, col: 0, mutantType: 'ConditionalExpression', original: 'if (x)', replacement: 'false' }
            ],
            exampleTest: null,
            recommendationText: null
          }
        ]
      }
    ]
    const md = renderMarkdown(rows)
    expect(md).not.toContain('Приклад тесту')
    // ```js блок з'являється лише якщо exampleTest != null; для null не повинен
    expect(md).not.toMatch(/```js\n/)
  })

  test('recommendationText рендериться як секція "Що треба протестувати"', () => {
    const rows = [
      {
        area: 'JS',
        coverage: { lines: { covered: 10, total: 20 }, functions: { covered: 5, total: 10 } },
        mutation: { caught: 3, total: 5 },
        survived: [
          {
            file: 'src/auth.js',
            mutants: [
              { line: 12, col: 0, mutantType: 'ConditionalExpression', original: 'if (x)', replacement: 'false' }
            ],
            exampleTest: null,
            recommendationText: 'Покрий if-гілку коли x === null'
          }
        ]
      }
    ]
    const md = renderMarkdown(rows)
    expect(md).toContain('**Що треба протестувати:**\n\nПокрий if-гілку коли x === null')
  })

  test('recommendationText === null → блок "Що треба протестувати" відсутній', () => {
    const rows = [
      {
        area: 'JS',
        coverage: { lines: { covered: 10, total: 20 }, functions: { covered: 5, total: 10 } },
        mutation: { caught: 3, total: 5 },
        survived: [
          {
            file: 'src/auth.js',
            mutants: [
              { line: 12, col: 0, mutantType: 'ConditionalExpression', original: 'if (x)', replacement: 'false' }
            ],
            exampleTest: null,
            recommendationText: null
          }
        ]
      }
    ]
    const md = renderMarkdown(rows)
    expect(md).not.toContain('Що треба протестувати')
  })
})

const DETECT_ONLY_PROVIDER = `
  export async function detect() { return true }
  // collect навмисно відсутній — loadProvider має повернути null
`

const COLLECT_ONLY_PROVIDER = `
  export async function collect() {
    return [{
      area: 'X',
      coverage: { lines: { covered: 1, total: 1 }, functions: { covered: 1, total: 1 } },
      mutation: { caught: 1, total: 1 }
    }]
  }
  // detect навмисно відсутній — loadProvider має повернути null
`

const SURVIVED_PROVIDER = `
  export async function detect() { return true }
  export async function collect() {
    return [{
      area: 'Test',
      coverage: { lines: { covered: 10, total: 20 }, functions: { covered: 3, total: 5 } },
      mutation: { caught: 4, total: 5 },
      survived: [{
        file: 'src/foo.js',
        mutants: [{ line: 1, col: 0, mutantType: 'BooleanLiteral', original: 'true', replacement: 'false' }],
        exampleTest: null,
        recommendationText: null
      }]
    }]
  }
`

describe('runCoverageSteps — loadProvider skip умови', () => {
  test('провайдер без collect() пропускається (exit 1, якщо він єдиний)', async () => {
    const fx = makeOrchestratorFixture({
      rules: ['detect-only'],
      providers: { 'detect-only': DETECT_ONLY_PROVIDER }
    })
    const exitCode = await runCoverageSteps({ cwd: fx.cwd, rulesDir: fx.rulesDir })
    expect(exitCode).toBe(1)
    fx.cleanup()
  })

  test('провайдер без detect() пропускається (exit 1, якщо він єдиний)', async () => {
    const fx = makeOrchestratorFixture({
      rules: ['collect-only'],
      providers: { 'collect-only': COLLECT_ONLY_PROVIDER }
    })
    const exitCode = await runCoverageSteps({ cwd: fx.cwd, rulesDir: fx.rulesDir })
    expect(exitCode).toBe(1)
    fx.cleanup()
  })

  test('обидва часткові провайдери пропускаються одночасно (exit 1)', async () => {
    const fx = makeOrchestratorFixture({
      rules: ['detect-only', 'collect-only'],
      providers: { 'detect-only': DETECT_ONLY_PROVIDER, 'collect-only': COLLECT_ONLY_PROVIDER }
    })
    const exitCode = await runCoverageSteps({ cwd: fx.cwd, rulesDir: fx.rulesDir })
    expect(exitCode).toBe(1)
    fx.cleanup()
  })
})

/**
 * Розширений fixture — підтримує disableRules у `.n-cursor.json#disable-rules`.
 * @param {{rules?: string[], disableRules?: string[], providers?: Record<string,string>}} [opts] активні rules, disable-rules і provider source
 * @returns {{cwd: string, rulesDir: string, cleanup: () => void}} fixture з функцією cleanup
 */
function makeFixtureWithDisable({ rules = [], disableRules = [], providers = {} } = {}) {
  const cwd = mkdtempSync(join(tmpdir(), 'orchestrator-cwd-'))
  writeFileSync(join(cwd, '.n-cursor.json'), JSON.stringify({ rules, 'disable-rules': disableRules }))

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

describe('runCoverageSteps — disable-rules', () => {
  test('правило у disable-rules пропускається ще до loadProvider (provider не викликається)', async () => {
    // BROKEN_PROVIDER кидав би помилку при detect/collect — якби pipeline його не скіпнув.
    const BROKEN_PROVIDER = `
      export async function detect() { throw new Error('detect не повинен викликатись для disabled rule') }
      export async function collect() { throw new Error('collect не повинен викликатись для disabled rule') }
    `
    const fx = makeFixtureWithDisable({
      rules: ['broken'],
      disableRules: ['broken'],
      providers: { broken: BROKEN_PROVIDER }
    })
    const exitCode = await runCoverageSteps({ cwd: fx.cwd, rulesDir: fx.rulesDir })
    // broken скіпнутий → жодного провайдера → exit 1
    expect(exitCode).toBe(1)
    fx.cleanup()
  })

  test('правило у disable-rules скіпається, але інші правила працюють', async () => {
    const fx = makeFixtureWithDisable({
      rules: ['js-lint', 'rust'],
      disableRules: ['rust'],
      providers: { 'js-lint': ONE_ROW_PROVIDER, rust: ONE_ROW_PROVIDER }
    })
    const exitCode = await runCoverageSteps({ cwd: fx.cwd, rulesDir: fx.rulesDir })
    expect(exitCode).toBe(0)
    const md = readFileSync(join(fx.cwd, 'COVERAGE.md'), 'utf8')
    // Лише один Test (js-lint), бо rust був disabled
    expect(md.match(/\| Test \|/g)).toHaveLength(1)
    fx.cleanup()
  })
})

describe('runCoverageSteps — console output', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  test('друкує "→ <ruleId> coverage…" для активного провайдера', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const fx = makeOrchestratorFixture({ rules: ['js-lint'], providers: { 'js-lint': ONE_ROW_PROVIDER } })
    await runCoverageSteps({ cwd: fx.cwd, rulesDir: fx.rulesDir })
    const calls = logSpy.mock.calls.map(args => String(args[0]))
    expect(calls.some(s => s.includes('→ js-lint coverage…'))).toBe(true)
    fx.cleanup()
  })

  test('друкує "✓ COVERAGE.md" після успішного запису', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const fx = makeOrchestratorFixture({ rules: ['js-lint'], providers: { 'js-lint': ONE_ROW_PROVIDER } })
    await runCoverageSteps({ cwd: fx.cwd, rulesDir: fx.rulesDir })
    const calls = logSpy.mock.calls.map(args => String(args[0]))
    expect(calls).toContain('✓ COVERAGE.md')
    fx.cleanup()
  })

  test('друкує error-повідомлення "Жодного провайдера..." коли rows порожні', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const fx = makeOrchestratorFixture({ rules: ['js-lint'], providers: { 'js-lint': SKIP_PROVIDER } })
    const exitCode = await runCoverageSteps({ cwd: fx.cwd, rulesDir: fx.rulesDir })
    expect(exitCode).toBe(1)
    const calls = errSpy.mock.calls.map(args => String(args[0]))
    expect(calls.some(s => s.startsWith('✗') && s.includes('Жодного провайдера'))).toBe(true)
    fx.cleanup()
  })
})

describe('runCoverageSteps — utf8 кодування', () => {
  test('COVERAGE.md читається як utf8 і містить кирилицю заголовків', async () => {
    const fx = makeOrchestratorFixture({ rules: ['js-lint'], providers: { 'js-lint': ONE_ROW_PROVIDER } })
    const exitCode = await runCoverageSteps({ cwd: fx.cwd, rulesDir: fx.rulesDir })
    expect(exitCode).toBe(0)
    const md = readFileSync(join(fx.cwd, 'COVERAGE.md'), 'utf8')
    // Кирилиця у заголовках таблиці — підтверджує, що writeFile використав 'utf8' encoding.
    expect(md).toContain('Область')
    expect(md).toContain('Рядки')
    expect(md).toContain('Функції')
    expect(md).toContain('Вбито мутацій')
    expect(md).toContain('**Разом**')
    fx.cleanup()
  })
})

describe('runCoverageSteps — opts.fix гілка', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  // Source-файл робить dynamic import('../../scripts/coverage-fix.mjs') відносно
  // npm/rules/test/coverage/coverage.mjs → шукає npm/rules/scripts/coverage-fix.mjs,
  // якого не існує (реальний файл — у npm/scripts/coverage-fix.mjs). Тому при
  // opts.fix === true виклик dynamic import має кинути ERR_MODULE_NOT_FOUND.
  // Це чітко відрізняє гілку `if (opts.fix)` (line 188) від мутації `→ false`:
  // мутація НЕ виконує dynamic import, тож і не кидає.

  test('opts.fix === true виконує гілку dynamic import (відрізняється від opts.fix === false)', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const fxFix = makeOrchestratorFixture({ rules: ['js-lint'], providers: { 'js-lint': ONE_ROW_PROVIDER } })
    // dynamic import шукає '../../scripts/coverage-fix.mjs' відносно coverage.mjs → файл не існує.
    // Помилка має містити 'coverage-fix' у шляху (не TypeError від undefined).
    await expect(runCoverageSteps({ cwd: fxFix.cwd, rulesDir: fxFix.rulesDir, fix: true })).rejects.toThrow(
      /coverage-fix/
    )
    fxFix.cleanup()
  })

  test('opts.fix === false НЕ виконує dynamic import — runCoverageSteps завершується успішно', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const fxNoFix = makeOrchestratorFixture({ rules: ['js-lint'], providers: { 'js-lint': ONE_ROW_PROVIDER } })
    const code = await runCoverageSteps({ cwd: fxNoFix.cwd, rulesDir: fxNoFix.rulesDir, fix: false })
    expect(code).toBe(0)
    fxNoFix.cleanup()
  })
})
