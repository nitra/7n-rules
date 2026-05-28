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

import { collect, detect, parseStrykerReport } from '../coverage.mjs'

const JS_COVERAGE_EXIT_RE = /JS coverage.*exit 1/
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
    await expect(collect(dir, { runner })).rejects.toThrow(/JS coverage.*exit 2/)
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
