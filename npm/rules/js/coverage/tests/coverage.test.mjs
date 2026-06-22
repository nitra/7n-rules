/**
 * Тести JS-coverage-провайдера (js-lint.mdc): detect() читає `package.json` у cwd
 * або workspace, повертає true якщо `vitest` присутній у dependencies/devDependencies.
 * collect() спавнить vitest run --coverage + Stryker (vitest-runner perTest), парсить
 * lcov і mutation.json — тестується з ін'єктованим runner-ом.
 */
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { collect, detect, extractFirstTestBlock, findExampleTest, parseStrykerReport, scopeToRoot } from '../coverage.mjs'

const JS_COVERAGE_EXIT_RE = /JS coverage.*exit 1/
const JS_COVERAGE_EXIT2_RE = /JS coverage.*exit 2/
const MUTATION_JSON_RE = /запусти `npx @nitra\/cursor fix test`/

/**
 * Тимчасова fixture-директорія з package.json для js-lint coverage-тестів.
 * @param {Record<string, unknown>} pkg вміст package.json workspace-пакета
 * @param {{workspaceRoot?: boolean}} [opts] чи емулювати monorepo з workspaces: ['app']
 * @returns {string} абсолютний шлях до тимчасового кореня
 */
function makeFixture(pkg, { workspaceRoot = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'js-lint-coverage-'))
  if (workspaceRoot) {
    mkdirSync(join(dir, 'app'), { recursive: true })
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ workspaces: ['app'] }))
    writeFileSync(join(dir, 'app', 'package.json'), JSON.stringify(pkg))
  } else {
    writeFileSync(join(dir, 'package.json'), JSON.stringify(pkg))
  }
  return dir
}

// Reset detect's one-shot `_hinted` flag між тестами, щоб порядок не впливав на console.error-перевірки.
/**
 *
 */
function resetDetectHinted() {
  delete (/** @type {typeof detect & {_hinted?: boolean}} */ (detect)._hinted)
}

describe('js-lint coverage detect()', () => {
  beforeEach(() => resetDetectHinted())
  afterEach(() => resetDetectHinted())

  test('повертає true коли vitest у devDependencies', async () => {
    const dir = makeFixture({ devDependencies: { vitest: '^2.0.0' } })
    expect(await detect(dir)).toBe(true)
    rmSync(dir, { recursive: true, force: true })
  })

  test('повертає true коли vitest у workspace-пакеті', async () => {
    const dir = makeFixture({ devDependencies: { vitest: '^2.0.0' } }, { workspaceRoot: true })
    expect(await detect(dir)).toBe(true)
    rmSync(dir, { recursive: true, force: true })
  })

  test('повертає true коли vitest у кореневому package.json, відсутній у workspace (hoisted bun monorepo)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'js-lint-coverage-root-'))
    mkdirSync(join(dir, 'app'), { recursive: true })
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({ workspaces: ['app'], devDependencies: { vitest: '^2.0.0' } })
    )
    writeFileSync(join(dir, 'app', 'package.json'), JSON.stringify({ name: 'app' }))
    expect(await detect(dir)).toBe(true)
    rmSync(dir, { recursive: true, force: true })
  })

  test('повертає true коли vitest у (звичайних) dependencies', async () => {
    const dir = makeFixture({ dependencies: { vitest: '*' } })
    expect(await detect(dir)).toBe(true)
    rmSync(dir, { recursive: true, force: true })
  })

  test('повертає false коли vitest відсутній', async () => {
    const dir = makeFixture({ scripts: { test: 'bun test src' } })
    expect(await detect(dir)).toBe(false)
    rmSync(dir, { recursive: true, force: true })
  })

  test('повертає false коли немає package.json', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'js-lint-coverage-empty-'))
    expect(await detect(dir)).toBe(false)
    rmSync(dir, { recursive: true, force: true })
  })
})

describe('js-lint coverage collect()', () => {
  test('парсить lcov + stryker mutation.json і повертає один CoverageRow', async () => {
    const dir = makeFixture({ scripts: { 'test:coverage': 'bun test --coverage' } })

    mkdirSync(join(dir, 'src'), { recursive: true })
    writeFileSync(join(dir, 'src', 'a.js'), 'export function f() {\n  if (x !== null) return 1\n}\n')

    const reportDir = join(dir, 'reports', 'stryker')
    mkdirSync(reportDir, { recursive: true })
    writeFileSync(
      join(reportDir, 'mutation.json'),
      JSON.stringify({
        files: {
          'src/a.js': {
            mutants: [
              { status: 'Killed' },
              { status: 'Killed' },
              {
                status: 'Survived',
                mutatorName: 'ConditionalExpression',
                replacement: 'false',
                location: { start: { line: 2, column: 6 }, end: { line: 2, column: 16 } }
              },
              { status: 'CompileError' }
            ]
          }
        }
      })
    )

    const calls = []
    const runner = {
      runJsCoverage({ cwd, lcovDir }) {
        calls.push({ kind: 'js', cwd, lcovDir })
        writeFileSync(join(lcovDir, 'lcov.info'), ['LF:100', 'LH:50', 'FNF:20', 'FNH:10', ''].join('\n'))
        return 0
      },
      runStryker({ cwd }) {
        calls.push({ kind: 'stryker', cwd })
        return 0
      }
    }

    const rows = await collect(dir, { runner })
    expect(rows).toEqual([
      {
        area: 'JS',
        coverage: { lines: { covered: 50, total: 100 }, functions: { covered: 10, total: 20 } },
        mutation: { caught: 2, total: 3 },
        survived: [
          {
            file: 'src/a.js',
            mutants: [
              { line: 2, col: 6, mutantType: 'ConditionalExpression', original: 'x !== null', replacement: 'false' }
            ],
            exampleTest: null,
            recommendationText: null
          }
        ]
      }
    ])
    expect(calls[0].kind).toBe('js')
    expect(calls[1].kind).toBe('stryker')

    rmSync(dir, { recursive: true, force: true })
  })

  test('падає з explainer-ом якщо JS-coverage exit ≠ 0', async () => {
    const dir = makeFixture({ scripts: { 'test:coverage': 'bun test --coverage' } })
    const runner = {
      runJsCoverage() {
        return 1
      },
      runStryker() {
        return 0
      }
    }
    await expect(collect(dir, { runner })).rejects.toThrow(JS_COVERAGE_EXIT_RE)
    rmSync(dir, { recursive: true, force: true })
  })

  test('агрегує lcov + survived по всіх workspaces у monorepo (glob)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'js-lint-coverage-mono-'))
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ workspaces: ['cf/*'] }))
    for (const ws of ['a', 'b']) {
      const wsDir = join(dir, 'cf', ws)
      mkdirSync(join(wsDir, 'src'), { recursive: true })
      writeFileSync(join(wsDir, 'package.json'), JSON.stringify({ name: ws }))
      writeFileSync(join(wsDir, 'src', `${ws}.js`), 'export function f() {\n  if (x) return 1\n}\n')
      const reportDir = join(wsDir, 'reports', 'stryker')
      mkdirSync(reportDir, { recursive: true })
      writeFileSync(
        join(reportDir, 'mutation.json'),
        JSON.stringify({
          files: {
            [`src/${ws}.js`]: {
              mutants: [
                { status: 'Killed' },
                {
                  status: 'Survived',
                  mutatorName: 'ConditionalExpression',
                  replacement: 'false',
                  location: { start: { line: 2, column: 6 }, end: { line: 2, column: 7 } }
                }
              ]
            }
          }
        })
      )
    }

    const cwds = []
    const runner = {
      runJsCoverage({ cwd, lcovDir }) {
        cwds.push(cwd)
        writeFileSync(join(lcovDir, 'lcov.info'), ['LF:10', 'LH:5', 'FNF:4', 'FNH:2', ''].join('\n'))
        return 0
      },
      runStryker() {
        return 0
      }
    }

    const rows = await collect(dir, { runner })
    expect(rows).toHaveLength(1)
    expect(rows[0].coverage).toEqual({
      lines: { covered: 10, total: 20 },
      functions: { covered: 4, total: 8 }
    })
    expect(rows[0].mutation).toEqual({ caught: 2, total: 4 })
    expect(rows[0].survived.map(g => g.file).sort()).toEqual([join('cf', 'a', 'src', 'a.js'), join('cf', 'b', 'src', 'b.js')])
    expect(cwds.sort()).toEqual([join(dir, 'cf', 'a'), join(dir, 'cf', 'b')])

    rmSync(dir, { recursive: true, force: true })
  })

  test('падає якщо Stryker не залишив mutation.json (при наявних тестах)', async () => {
    const dir = makeFixture({ scripts: { 'test:coverage': 'bun test --coverage' } })
    const runner = {
      runJsCoverage({ lcovDir }) {
        // Non-zero LF/FNF — workspace має тести, тож відсутність mutation.json є помилкою конфігурації
        writeFileSync(join(lcovDir, 'lcov.info'), 'LF:10\nLH:5\nFNF:4\nFNH:2\n')
        return 0
      },
      runStryker() {
        return 0
      }
    }
    await expect(collect(dir, { runner })).rejects.toThrow(MUTATION_JSON_RE)
    rmSync(dir, { recursive: true, force: true })
  })

  test('single-package без тестів — повертає [] (не throw)', async () => {
    const dir = makeFixture({ scripts: { 'test:coverage': 'bun test --coverage' } })
    const runner = {
      runJsCoverage({ lcovDir }) {
        // --passWithNoTests: vitest exit 0, але lcov порожній
        writeFileSync(join(lcovDir, 'lcov.info'), '')
        return 0
      },
      runStryker() {
        return 0
      }
    }
    expect(await collect(dir, { runner })).toEqual([])
    rmSync(dir, { recursive: true, force: true })
  })

  test('monorepo: workspaces без тестів тихо пропускаються; агрегує тільки workspace з тестами', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'js-lint-coverage-mixed-'))
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ workspaces: ['cf/*', 'gt'] }))

    // 2 workspaces без тестів (cf/a, cf/b)
    for (const ws of ['cf/a', 'cf/b']) {
      mkdirSync(join(dir, ws, 'src'), { recursive: true })
      writeFileSync(join(dir, ws, 'package.json'), JSON.stringify({ name: ws.replace('/', '-') }))
    }

    // 1 workspace з тестами (gt)
    const gtDir = join(dir, 'gt')
    mkdirSync(join(gtDir, 'src'), { recursive: true })
    writeFileSync(join(gtDir, 'package.json'), JSON.stringify({ name: 'gt' }))
    writeFileSync(join(gtDir, 'src', 'a.js'), 'export function f() { return 1 }\n')
    const reportDir = join(gtDir, 'reports', 'stryker')
    mkdirSync(reportDir, { recursive: true })
    writeFileSync(
      join(reportDir, 'mutation.json'),
      JSON.stringify({ files: { 'src/a.js': { mutants: [{ status: 'Killed' }, { status: 'Killed' }] } } })
    )

    const cwds = []
    const strykerCalls = []
    const runner = {
      runJsCoverage({ cwd, lcovDir }) {
        cwds.push(cwd)
        const isGt = cwd.endsWith('/gt')
        // Пусті cf/* — порожній lcov; gt — з даними
        writeFileSync(join(lcovDir, 'lcov.info'), isGt ? 'LF:20\nLH:15\nFNF:5\nFNH:4\n' : '')
        return 0
      },
      runStryker({ cwd }) {
        strykerCalls.push(cwd)
        return 0
      }
    }

    const rows = await collect(dir, { runner })
    expect(rows).toEqual([
      {
        area: 'JS',
        coverage: { lines: { covered: 15, total: 20 }, functions: { covered: 4, total: 5 } },
        mutation: { caught: 2, total: 2 },
        survived: []
      }
    ])
    // vitest викликано у трьох workspaces (cf/a, cf/b, gt), Stryker — лише в gt
    expect(cwds).toHaveLength(3)
    expect(strykerCalls).toEqual([join(dir, 'gt')])
    rmSync(dir, { recursive: true, force: true })
  })

  test('monorepo: усі workspaces без тестів — повертає []', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'js-lint-coverage-allempty-'))
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ workspaces: ['cf/*'] }))
    for (const ws of ['a', 'b']) {
      mkdirSync(join(dir, 'cf', ws), { recursive: true })
      writeFileSync(join(dir, 'cf', ws, 'package.json'), JSON.stringify({ name: ws }))
    }
    const strykerCalls = []
    const runner = {
      runJsCoverage({ lcovDir }) {
        writeFileSync(join(lcovDir, 'lcov.info'), '')
        return 0
      },
      runStryker({ cwd }) {
        strykerCalls.push(cwd)
        return 0
      }
    }
    expect(await collect(dir, { runner })).toEqual([])
    expect(strykerCalls).toEqual([])
    rmSync(dir, { recursive: true, force: true })
  })

  test('monorepo: vitest exit ≠ 0 в одному workspace — throw (реальні помилки не маскуються)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'js-lint-coverage-fail-'))
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ workspaces: ['cf/*'] }))
    mkdirSync(join(dir, 'cf', 'a'), { recursive: true })
    writeFileSync(join(dir, 'cf', 'a', 'package.json'), JSON.stringify({ name: 'a' }))
    const runner = {
      runJsCoverage() {
        return 2
      },
      runStryker() {
        return 0
      }
    }
    await expect(collect(dir, { runner })).rejects.toThrow(JS_COVERAGE_EXIT2_RE)
    rmSync(dir, { recursive: true, force: true })
  })
})

describe('extractFirstTestBlock', () => {
  test('повертає перший тест-блок зі вкладеними {}', () => {
    const code = `import { test } from 'vitest'\ntest('foo', () => {\n  expect({ a: 1 }).toEqual({ a: 1 })\n})\ntest('bar', () => {})\n`
    const result = extractFirstTestBlock(code)
    expect(result).toContain("test('foo'")
    expect(result).not.toContain("test('bar'")
  })

  test('повертає null коли немає тест-блоків', () => {
    expect(extractFirstTestBlock('export const x = 1\n')).toBeNull()
  })
})

describe('findExampleTest', () => {
  test('повертає null коли тест-файл не знайдено', () => {
    const dir = mkdtempSync(join(tmpdir(), 'findExampleTest-'))
    const result = findExampleTest(dir, 'src/foo.mjs')
    rmSync(dir, { recursive: true, force: true })
    expect(result).toBeNull()
  })

  test('знаходить тест поряд з source (<base>.test.mjs)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'findExampleTest-'))
    mkdirSync(join(dir, 'src'), { recursive: true })
    writeFileSync(join(dir, 'src', 'foo.test.mjs'), `test('x', () => {\n  expect(1).toBe(1)\n})\n`)
    const result = findExampleTest(dir, 'src/foo.mjs')
    rmSync(dir, { recursive: true, force: true })
    expect(result).not.toBeNull()
    expect(result?.testFile).toBe('src/foo.test.mjs')
    expect(result?.code).toContain("test('x'")
  })

  test('знаходить тест у <dir>/tests/<name>.test.mjs', () => {
    const dir = mkdtempSync(join(tmpdir(), 'findExampleTest-'))
    mkdirSync(join(dir, 'src', 'tests'), { recursive: true })
    writeFileSync(join(dir, 'src', 'tests', 'bar.test.mjs'), `test('y', () => {\n  expect(2).toBe(2)\n})\n`)
    const result = findExampleTest(dir, 'src/bar.mjs')
    rmSync(dir, { recursive: true, force: true })
    expect(result).not.toBeNull()
    expect(result?.testFile).toBe('src/tests/bar.test.mjs')
  })

  test('для файлу без "/" у шляху — перебирає лише базові кандидати', () => {
    const dir = mkdtempSync(join(tmpdir(), 'findExampleTest-'))
    writeFileSync(join(dir, 'foo.test.js'), `test('z', () => {})\n`)
    const result = findExampleTest(dir, 'foo.mjs')
    rmSync(dir, { recursive: true, force: true })
    expect(result).not.toBeNull()
    expect(result?.testFile).toBe('foo.test.js')
  })
})

describe('parseStrykerReport — multiline original', () => {
  test('extractOriginal для мутанта що охоплює кілька рядків', () => {
    const dir = mkdtempSync(join(tmpdir(), 'parse-stryker-multi-'))
    mkdirSync(join(dir, 'src'), { recursive: true })
    writeFileSync(join(dir, 'src', 'multi.js'), 'export function f(x,\ny) {\n  return x + y\n}\n')
    const report = {
      files: {
        'src/multi.js': {
          mutants: [
            {
              status: 'Survived',
              mutatorName: 'StringLiteral',
              replacement: '""',
              location: { start: { line: 1, column: 17 }, end: { line: 2, column: 2 } }
            }
          ]
        }
      }
    }
    const result = parseStrykerReport(report, dir)
    rmSync(dir, { recursive: true, force: true })
    expect(result.survived[0].mutants[0].original).toContain('\n')
  })

  test('extractOriginal для мутанта що охоплює 3 рядки (middle-line path, line 98)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'parse-stryker-3line-'))
    mkdirSync(join(dir, 'src'), { recursive: true })
    writeFileSync(join(dir, 'src', 'three.js'), 'line1\nline2\nline3\n')
    const report = {
      files: {
        'src/three.js': {
          mutants: [
            {
              status: 'Survived',
              mutatorName: 'StringLiteral',
              replacement: '""',
              location: { start: { line: 1, column: 0 }, end: { line: 3, column: 5 } }
            }
          ]
        }
      }
    }
    const result = parseStrykerReport(report, dir)
    rmSync(dir, { recursive: true, force: true })
    const original = result.survived[0].mutants[0].original
    expect(original).toContain('line2')
  })

  test('readFileSync помилка (файл не існує) → original порожній рядок', () => {
    const dir = mkdtempSync(join(tmpdir(), 'parse-stryker-missing-'))
    const report = {
      files: {
        'src/missing.js': {
          mutants: [
            {
              status: 'Survived',
              mutatorName: 'BooleanLiteral',
              replacement: 'true',
              location: { start: { line: 1, column: 0 }, end: { line: 1, column: 4 } }
            }
          ]
        }
      }
    }
    const result = parseStrykerReport(report, dir)
    rmSync(dir, { recursive: true, force: true })
    expect(result.survived[0].mutants[0].original).toBe('')
  })
})

describe('collect — крайні випадки', () => {
  test('кидає якщо package.json не знайдено у cwd', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'no-pkg-'))
    const runner = { runJsCoverage: () => 0, runStryker: () => 0 }
    await expect(collect(dir, { runner })).rejects.toThrow('package.json не знайдено')
    rmSync(dir, { recursive: true, force: true })
  })
})

describe('parseStrykerReport', () => {
  test('повертає survived мутанти з file/line/col/mutantType/original/replacement', () => {
    const dir = mkdtempSync(join(tmpdir(), 'parse-stryker-'))
    mkdirSync(join(dir, 'src'), { recursive: true })
    writeFileSync(join(dir, 'src', 'foo.js'), 'export function f(x) {\n  if (x === 1) return true\n}\n')

    const report = {
      files: {
        'src/foo.js': {
          mutants: [
            {
              status: 'Survived',
              mutatorName: 'ConditionalExpression',
              replacement: 'false',
              location: { start: { line: 2, column: 2 }, end: { line: 2, column: 14 } }
            },
            {
              status: 'Killed',
              mutatorName: 'EqualityOperator',
              replacement: 'x !== 1',
              location: { start: { line: 2, column: 6 }, end: { line: 2, column: 13 } }
            }
          ]
        }
      }
    }

    const result = parseStrykerReport(report, dir)
    expect(result.caught).toBe(1)
    expect(result.total).toBe(2)
    expect(result.survived).toEqual([
      {
        file: 'src/foo.js',
        mutants: [
          { line: 2, col: 2, mutantType: 'ConditionalExpression', original: 'if (x === 1)', replacement: 'false' }
        ],
        exampleTest: null,
        recommendationText: null
      }
    ])
    rmSync(dir, { recursive: true, force: true })
  })

  test('NoCoverage не входить у survived', () => {
    const dir = mkdtempSync(join(tmpdir(), 'parse-stryker-'))
    const report = {
      files: {
        'src/bar.js': {
          mutants: [
            {
              status: 'NoCoverage',
              mutatorName: 'BooleanLiteral',
              replacement: 'true',
              location: { start: { line: 1, column: 0 }, end: { line: 1, column: 4 } }
            },
            {
              status: 'Survived',
              mutatorName: 'BooleanLiteral',
              replacement: 'false',
              location: { start: { line: 1, column: 0 }, end: { line: 1, column: 4 } }
            }
          ]
        }
      }
    }
    const result = parseStrykerReport(report, dir)
    expect(result.survived).toHaveLength(1)
    expect(result.survived[0].mutants[0].mutantType).toBe('BooleanLiteral')
    rmSync(dir, { recursive: true, force: true })
  })

  test('мутанти без location не входять у survived', () => {
    const dir = mkdtempSync(join(tmpdir(), 'parse-stryker-'))
    const report = {
      files: {
        'src/x.js': {
          mutants: [{ status: 'Survived' }]
        }
      }
    }
    const result = parseStrykerReport(report, dir)
    expect(result.survived).toEqual([])
    rmSync(dir, { recursive: true, force: true })
  })
})

describe('scopeToRoot', () => {
  test('фільтрує не-JS і рібейзить JS відносно root (single-package: root===cwd)', () => {
    const cwd = '/repo'
    expect(scopeToRoot(['src/a.js', 'README.md', 'docs/x.png'], cwd, cwd)).toEqual(['src/a.js'])
  })

  test('лишає лише файли під workspace-root, рібейзить', () => {
    const cwd = '/repo'
    const root = '/repo/cf/app'
    const files = ['cf/app/src/a.js', 'cf/app/b.mjs', 'cf/other/c.js', 'top.ts']
    expect(scopeToRoot(files, cwd, root)).toEqual(['src/a.js', 'b.mjs'])
  })

  test('розпізнає .ts/.tsx/.cjs/.mjs/.jsx', () => {
    const cwd = '/repo'
    const files = ['a.ts', 'b.tsx', 'c.cjs', 'd.mjs', 'e.jsx', 'f.json', 'g.css']
    expect(scopeToRoot(files, cwd, cwd)).toEqual(['a.ts', 'b.tsx', 'c.cjs', 'd.mjs', 'e.jsx'])
  })
})

describe('js-lint coverage collect() — --changed scope', () => {
  test('передає base у vitest і --mutate (non-test src) у Stryker; пропускає roots без змін', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'js-lint-cov-changed-'))
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ workspaces: ['cf/*'] }))
    for (const ws of ['a', 'b']) {
      const wsDir = join(dir, 'cf', ws)
      mkdirSync(join(wsDir, 'src'), { recursive: true })
      writeFileSync(join(wsDir, 'package.json'), JSON.stringify({ name: ws }))
    }
    // mutation.json лише для cf/a (єдиний зі зміненим src)
    const reportDir = join(dir, 'cf', 'a', 'reports', 'stryker')
    mkdirSync(reportDir, { recursive: true })
    writeFileSync(
      join(reportDir, 'mutation.json'),
      JSON.stringify({ files: { 'src/a.js': { mutants: [{ status: 'Killed' }, { status: 'Survived' }] } } })
    )

    const jsCalls = []
    const strykerCalls = []
    const runner = {
      runJsCoverage({ cwd, lcovDir, base }) {
        jsCalls.push({ cwd, base })
        writeFileSync(join(lcovDir, 'lcov.info'), 'LF:10\nLH:8\nFNF:2\nFNH:2\n')
        return 0
      },
      runStryker({ cwd, mutate }) {
        strykerCalls.push({ cwd, mutate })
        return 0
      }
    }

    // Змінено лише src у cf/a; cf/b без змін → пропускається повністю.
    const rows = await collect(dir, {
      runner,
      base: 'BASE_SHA',
      changedFiles: ['cf/a/src/a.js', 'cf/a/src/a.test.js']
    })

    expect(rows).toHaveLength(1)
    expect(rows[0].mutation).toEqual({ caught: 1, total: 2 })
    // vitest викликано лише для cf/a, з base
    expect(jsCalls).toEqual([{ cwd: join(dir, 'cf', 'a'), base: 'BASE_SHA' }])
    // Stryker мутує лише production-src (test-файл відкинуто)
    expect(strykerCalls).toEqual([{ cwd: join(dir, 'cf', 'a'), mutate: ['src/a.js'] }])
    rmSync(dir, { recursive: true, force: true })
  })

  test('змінено лише тест-файли → Stryker не запускається, mutation 0/0', async () => {
    const dir = makeFixture({ devDependencies: { vitest: '^2.0.0' } })
    const strykerCalls = []
    const runner = {
      runJsCoverage({ lcovDir }) {
        writeFileSync(join(lcovDir, 'lcov.info'), 'LF:10\nLH:8\nFNF:2\nFNH:2\n')
        return 0
      },
      runStryker() {
        strykerCalls.push(1)
        return 0
      }
    }
    const rows = await collect(dir, { runner, base: 'B', changedFiles: ['tests/a.test.mjs'] })
    expect(rows).toHaveLength(1)
    expect(rows[0].mutation).toEqual({ caught: 0, total: 0 })
    expect(rows[0].survived).toEqual([])
    expect(strykerCalls).toEqual([]) // нема production-src → Stryker не викликано
    rmSync(dir, { recursive: true, force: true })
  })

  test('немає змінених JS ніде → [] (без error)', async () => {
    const dir = makeFixture({ devDependencies: { vitest: '^2.0.0' } })
    const calls = []
    const runner = {
      runJsCoverage() {
        calls.push('js')
        return 0
      },
      runStryker() {
        calls.push('stryker')
        return 0
      }
    }
    const rows = await collect(dir, { runner, base: 'B', changedFiles: ['README.md', 'docs/x.png'] })
    expect(rows).toEqual([])
    expect(calls).toEqual([]) // жодного root зі зміненим JS → нічого не запускалось
    rmSync(dir, { recursive: true, force: true })
  })

  test('порожній lcov, але змінений src → Stryker все одно запускається (не пропускаємо root)', async () => {
    const dir = makeFixture({ devDependencies: { vitest: '^2.0.0' } })
    const reportDir = join(dir, 'reports', 'stryker')
    mkdirSync(reportDir, { recursive: true })
    writeFileSync(
      join(reportDir, 'mutation.json'),
      JSON.stringify({ files: { 'src/a.js': { mutants: [{ status: 'NoCoverage' }, { status: 'NoCoverage' }] } } })
    )
    const strykerCalls = []
    const runner = {
      runJsCoverage({ lcovDir }) {
        writeFileSync(join(lcovDir, 'lcov.info'), '') // порожній lcov (нема covering-тестів)
        return 0
      },
      runStryker({ mutate }) {
        strykerCalls.push(mutate)
        return 0
      }
    }
    const rows = await collect(dir, { runner, base: 'B', changedFiles: ['src/a.js'] })
    expect(rows).toHaveLength(1)
    // змінений src без тестів → NoCoverage-мутанти у total (gate впаде, як і має)
    expect(rows[0].mutation).toEqual({ caught: 0, total: 2 })
    expect(strykerCalls).toEqual([['src/a.js']])
    rmSync(dir, { recursive: true, force: true })
  })
})
