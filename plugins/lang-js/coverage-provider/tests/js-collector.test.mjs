/**
 * Тести JS-coverage-колектора (js-collector.mjs): detect() читає `package.json` у cwd
 * або workspace, повертає true якщо `vitest` присутній у dependencies/devDependencies.
 * collect() спавнить vitest run --coverage + Stryker (vitest-runner perTest), парсить
 * lcov і mutation.json — тестується з ін'єктованим runner-ом.
 */
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  collect,
  detect,
  extractFirstTestBlock,
  findExampleTest,
  parseStrykerReport,
  scopeToRoot,
  scopeToStorybookRoot
} from '../js-collector.mjs'

const JS_COVERAGE_EXIT_RE = /JS coverage.*exit 1/
const JS_COVERAGE_EXIT2_RE = /JS coverage.*exit 2/
const MUTATION_JSON_RE = /canonical stryker.config.mjs/
const STRYKER_ISOLATION_RE = /vitest\.stryker\.config/
const STORYBOOK_COVERAGE_EXIT_RE = /Storybook coverage exit 1.*Playwright/s
const STORYBOOK_STRYKER_FULL_EXIT_RE = /Storybook Stryker \(command runner\) exit 1/

/**
 * Fixture workspace з канонічними Storybook-identity devDeps і одним *.stories.* файлом.
 * @param {string} dir абсолютний шлях workspace-кореня
 */
function makeStorybookRoot(dir) {
  mkdirSync(join(dir, 'src'), { recursive: true })
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify({ devDependencies: { vitest: '^2.0.0', storybook: '9.1.10', '@storybook/vue3-vite': '9.1.10' } })
  )
  writeFileSync(join(dir, 'src', 'Card.stories.js'), 'export default {}\n')
}

/**
 * Тимчасова fixture-директорія з package.json для js coverage-тестів.
 * @param {Record<string, unknown>} pkg вміст package.json workspace-пакета
 * @param {{workspaceRoot?: boolean}} [opts] чи емулювати monorepo з workspaces: ['app']
 * @returns {string} абсолютний шлях до тимчасового кореня
 */
function makeFixture(pkg, { workspaceRoot = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'js-coverage-'))
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

describe('js coverage detect()', () => {
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
    const dir = mkdtempSync(join(tmpdir(), 'js-coverage-root-'))
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
    const dir = mkdtempSync(join(tmpdir(), 'js-coverage-empty-'))
    expect(await detect(dir)).toBe(false)
    rmSync(dir, { recursive: true, force: true })
  })
})

describe('js coverage collect()', () => {
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
    const dir = mkdtempSync(join(tmpdir(), 'js-coverage-mono-'))
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
    expect(rows[0].survived.map(g => g.file).toSorted()).toEqual([
      join('cf', 'a', 'src', 'a.js'),
      join('cf', 'b', 'src', 'b.js')
    ])
    expect(cwds.toSorted()).toEqual([join(dir, 'cf', 'a'), join(dir, 'cf', 'b')])

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
    const dir = mkdtempSync(join(tmpdir(), 'js-coverage-mixed-'))
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
    const dir = mkdtempSync(join(tmpdir(), 'js-coverage-allempty-'))
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
    const dir = mkdtempSync(join(tmpdir(), 'js-coverage-fail-'))
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

  test('розпізнає .vue (Stryker core мутує <script>/<script setup> SFC)', () => {
    const cwd = '/repo'
    const files = ['a.vue', 'b.stories.js', 'c.js']
    expect(scopeToRoot(files, cwd, cwd)).toEqual(['a.vue', 'b.stories.js', 'c.js'])
  })
})

describe('js coverage collect() — --changed scope', () => {
  test('передає base у vitest і --mutate (non-test src) у Stryker; пропускає roots без змін', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'js-cov-changed-'))
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

describe('scopeToStorybookRoot', () => {
  test('лишає лише .vue і .stories.* файли, рібейзить відносно root', () => {
    const cwd = '/repo'
    const files = ['src/Card.vue', 'src/Card.stories.ts', 'src/a.js', 'README.md']
    expect(scopeToStorybookRoot(files, cwd, cwd)).toEqual(['src/Card.vue', 'src/Card.stories.ts'])
  })

  test('лишає лише файли під workspace-root, рібейзить', () => {
    const cwd = '/repo'
    const root = '/repo/cf/app'
    const files = ['cf/app/src/Card.vue', 'cf/other/Btn.vue', 'top.stories.js']
    expect(scopeToStorybookRoot(files, cwd, root)).toEqual(['src/Card.vue'])
  })
})

describe('js coverage collect() — Storybook-рядок', () => {
  test('full-режим: JS-root без Storybook-конфігурації — лише рядок JS', async () => {
    const dir = makeFixture({ devDependencies: { vitest: '^2.0.0' } })
    const runner = {
      runJsCoverage({ lcovDir }) {
        writeFileSync(join(lcovDir, 'lcov.info'), 'LF:10\nLH:8\nFNF:2\nFNH:2\n')
        return 0
      },
      runStryker() {
        return 0
      },
      runStorybookCoverage() {
        throw new Error('не мало викликатись — root не Storybook')
      }
    }
    const reportDir = join(dir, 'reports', 'stryker')
    mkdirSync(reportDir, { recursive: true })
    writeFileSync(join(reportDir, 'mutation.json'), JSON.stringify({ files: {} }))

    const rows = await collect(dir, { runner })
    expect(rows.map(r => r.area)).toEqual(['JS'])
    rmSync(dir, { recursive: true, force: true })
  })

  test('full-режим: Storybook-root без vitest-тестів — лише рядок Vue (Storybook), mutation 0/0', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'js-cov-storybook-'))
    makeStorybookRoot(dir)

    const calls = []
    const runner = {
      runJsCoverage({ lcovDir }) {
        calls.push('js')
        writeFileSync(join(lcovDir, 'lcov.info'), '') // немає unit-тестів
        return 0
      },
      runStryker() {
        calls.push('stryker')
        return 0
      },
      runStorybookCoverage({ cwd, lcovDir }) {
        calls.push('storybook')
        expect(cwd).toBe(dir)
        writeFileSync(join(lcovDir, 'lcov.info'), 'LF:20\nLH:15\nFNF:4\nFNH:3\n')
        return 0
      }
    }

    const rows = await collect(dir, { runner })
    expect(rows).toEqual([
      {
        area: 'Vue (Storybook)',
        coverage: { lines: { covered: 15, total: 20 }, functions: { covered: 3, total: 4 } },
        mutation: { caught: 0, total: 0 },
        survived: []
      }
    ])
    // JS без тестів (порожній lcov) → Stryker не викликається; Storybook — окремий раннер
    expect(calls).toEqual(['js', 'storybook'])
    rmSync(dir, { recursive: true, force: true })
  })

  test('full-режим: root з JS-тестами І Storybook-сторі — два рядки, «Разом» рахує buildTotalsRow окремо', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'js-cov-mixed-sb-'))
    makeStorybookRoot(dir)
    writeFileSync(join(dir, 'src', 'a.test.js'), 'test("x", () => {})\n')
    const reportDir = join(dir, 'reports', 'stryker')
    mkdirSync(reportDir, { recursive: true })
    writeFileSync(join(reportDir, 'mutation.json'), JSON.stringify({ files: {} }))

    const runner = {
      runJsCoverage({ lcovDir }) {
        writeFileSync(join(lcovDir, 'lcov.info'), 'LF:10\nLH:5\nFNF:2\nFNH:1\n')
        return 0
      },
      runStryker() {
        return 0
      },
      runStorybookCoverage({ lcovDir }) {
        writeFileSync(join(lcovDir, 'lcov.info'), 'LF:20\nLH:20\nFNF:4\nFNH:4\n')
        return 0
      }
    }

    const rows = await collect(dir, { runner })
    expect(rows.map(r => r.area)).toEqual(['JS', 'Vue (Storybook)'])
    expect(rows[0].mutation).toEqual({ caught: 0, total: 0 })
    expect(rows[1].coverage).toEqual({ lines: { covered: 20, total: 20 }, functions: { covered: 4, total: 4 } })
    expect(rows[1].mutation).toEqual({ caught: 0, total: 0 })
    rmSync(dir, { recursive: true, force: true })
  })

  test('Storybook-root: stryker.config.mjs без vitest.stryker.config — канонічна помилка ДО запуску Stryker', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'js-cov-sb-stryker-drift-'))
    makeStorybookRoot(dir)
    writeFileSync(join(dir, 'src', 'a.test.js'), 'test("x", () => {})\n')
    writeFileSync(
      join(dir, 'stryker.config.mjs'),
      "export default { testRunner: 'vitest', vitest: { configFile: 'vitest.config.mjs' } }\n"
    )
    const runner = {
      runJsCoverage({ lcovDir }) {
        writeFileSync(join(lcovDir, 'lcov.info'), 'LF:10\nLH:5\nFNF:2\nFNH:1\n')
        return 0
      },
      runStryker() {
        throw new Error('не мало викликатись — fail-fast перевірка канону йде до Stryker')
      },
      runStorybookCoverage({ lcovDir }) {
        writeFileSync(join(lcovDir, 'lcov.info'), '')
        return 0
      }
    }
    await expect(collect(dir, { runner })).rejects.toThrow(STRYKER_ISOLATION_RE)
    rmSync(dir, { recursive: true, force: true })
  })

  test('Storybook-root: stryker.config.mjs вказує на vitest.stryker.config.mjs — Stryker запускається', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'js-cov-sb-stryker-canon-'))
    makeStorybookRoot(dir)
    writeFileSync(join(dir, 'src', 'a.test.js'), 'test("x", () => {})\n')
    writeFileSync(
      join(dir, 'stryker.config.mjs'),
      "export default { testRunner: 'vitest', vitest: { configFile: 'vitest.stryker.config.mjs' } }\n"
    )
    const reportDir = join(dir, 'reports', 'stryker')
    mkdirSync(reportDir, { recursive: true })
    writeFileSync(join(reportDir, 'mutation.json'), JSON.stringify({ files: {} }))

    const calls = []
    const runner = {
      runJsCoverage({ lcovDir }) {
        writeFileSync(join(lcovDir, 'lcov.info'), 'LF:10\nLH:5\nFNF:2\nFNH:1\n')
        return 0
      },
      runStryker() {
        calls.push('stryker')
        return 0
      },
      runStorybookCoverage({ lcovDir }) {
        writeFileSync(join(lcovDir, 'lcov.info'), '')
        return 0
      }
    }
    const rows = await collect(dir, { runner })
    expect(calls).toEqual(['stryker'])
    expect(rows.map(r => r.area)).toEqual(['JS', 'Vue (Storybook)'])
    rmSync(dir, { recursive: true, force: true })
  })

  test('Storybook-root без *.stories.* файлів — Storybook-раннер не викликається', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'js-cov-sb-no-stories-'))
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({ devDependencies: { vitest: '^2.0.0', storybook: '9.1.10', '@storybook/vue3-vite': '9.1.10' } })
    )
    const runner = {
      runJsCoverage({ lcovDir }) {
        writeFileSync(join(lcovDir, 'lcov.info'), '')
        return 0
      },
      runStryker() {
        return 0
      },
      runStorybookCoverage() {
        throw new Error('не мало викликатись — немає *.stories.* файлів')
      }
    }
    const rows = await collect(dir, { runner })
    expect(rows).toEqual([])
    rmSync(dir, { recursive: true, force: true })
  })

  test('Storybook coverage exit ≠ 0 → throw з підказкою про Playwright/named-проєкт', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'js-cov-sb-fail-'))
    makeStorybookRoot(dir)
    const runner = {
      runJsCoverage({ lcovDir }) {
        writeFileSync(join(lcovDir, 'lcov.info'), '')
        return 0
      },
      runStryker() {
        return 0
      },
      runStorybookCoverage() {
        return 1
      }
    }
    await expect(collect(dir, { runner })).rejects.toThrow(STORYBOOK_COVERAGE_EXIT_RE)
    rmSync(dir, { recursive: true, force: true })
  })

  test('--changed: Storybook-root, змінено лише .vue → JS-вимір мутувати НІЧОГО не намагається (.vue виключено), лише Storybook line coverage', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'js-cov-sb-changed-'))
    makeStorybookRoot(dir)
    writeFileSync(join(dir, 'src', 'Card.vue'), '<template><div /></template>\n')

    const calls = []
    const runner = {
      runJsCoverage({ cwd, lcovDir, base, excludeStorybookProject }) {
        calls.push({ kind: 'js', cwd, base, excludeStorybookProject })
        writeFileSync(join(lcovDir, 'lcov.info'), 'LF:8\nLH:6\nFNF:2\nFNH:1\n')
        return 0
      },
      runStryker() {
        calls.push({ kind: 'stryker' })
        return 0
      },
      runStorybookCoverage({ cwd, lcovDir, base }) {
        calls.push({ kind: 'storybook', cwd, base })
        writeFileSync(join(lcovDir, 'lcov.info'), 'LF:5\nLH:5\nFNF:1\nFNH:1\n')
        return 0
      }
    }

    const rows = await collect(dir, { runner, base: 'BASE_SHA', changedFiles: ['src/Card.vue'] })
    // .vue на Storybook-root виключено з JS-мутації (isStorybook-guard у mutateSrc):
    // Stryker vitest-runner структурно не може прогнати dry-run на root-і, де ЄДИНИЙ
    // vitest-проєкт — "storybook" (browser mode) — емпірично підтверджено на реальному
    // storybook init-скаффолді. `.vue`-мутація — виключно відповідальність
    // collectStorybookForRoot (own executor / command-runner).
    expect(rows).toEqual([
      {
        area: 'JS',
        coverage: { lines: { covered: 6, total: 8 }, functions: { covered: 1, total: 2 } },
        mutation: { caught: 0, total: 0 },
        survived: []
      },
      {
        area: 'Vue (Storybook)',
        coverage: { lines: { covered: 5, total: 5 }, functions: { covered: 1, total: 1 } },
        mutation: { caught: 0, total: 0 },
        survived: []
      }
    ])
    // Stryker (JS-вимір) НЕ викликається — mutateSrc порожній (єдиний змінений файл — .vue)
    expect(calls).toEqual([
      { kind: 'js', cwd: dir, base: 'BASE_SHA', excludeStorybookProject: true },
      { kind: 'storybook', cwd: dir, base: 'BASE_SHA' }
    ])
    rmSync(dir, { recursive: true, force: true })
  })

  test('--changed: Storybook-root, змінено .vue ТА .js → JS-вимір мутує лише .js (.vue виключено)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'js-cov-sb-changed-mixed-'))
    makeStorybookRoot(dir)
    writeFileSync(join(dir, 'src', 'Card.vue'), '<template><div /></template>\n')
    writeFileSync(join(dir, 'src', 'util.js'), 'export const x = 1\n')
    const reportDir = join(dir, 'reports', 'stryker')
    mkdirSync(reportDir, { recursive: true })
    writeFileSync(join(reportDir, 'mutation.json'), JSON.stringify({ files: {} }))

    const runner = {
      runJsCoverage({ lcovDir }) {
        writeFileSync(join(lcovDir, 'lcov.info'), '')
        return 0
      },
      runStryker({ mutate }) {
        expect(mutate).toEqual(['src/util.js'])
        return 0
      },
      runStorybookCoverage({ lcovDir }) {
        writeFileSync(join(lcovDir, 'lcov.info'), '')
        return 0
      }
    }

    await collect(dir, { runner, base: 'B', changedFiles: ['src/Card.vue', 'src/util.js'] })
    rmSync(dir, { recursive: true, force: true })
  })

  test('--changed: Storybook mutation executor — mutate→run→restore, survived у рядку Vue (Storybook)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'js-cov-sb-mutation-'))
    makeStorybookRoot(dir)
    // рядок 3 — мутабельний script-код (tier1 `<`→`<=`, tier2 `&&`→`||`)
    const vueSrc = '<template><div /></template>\n<script setup>\nconst ok = a < b && c\n</script>\n'
    writeFileSync(join(dir, 'src', 'Card.vue'), vueSrc)
    const reportDir = join(dir, 'reports', 'stryker')
    mkdirSync(reportDir, { recursive: true })
    writeFileSync(
      join(reportDir, 'mutation.json'),
      JSON.stringify({ files: { 'src/Card.vue': { mutants: [{ status: 'Killed' }] } } })
    )

    const mutantRuns = []
    const runner = {
      runJsCoverage({ lcovDir }) {
        writeFileSync(join(lcovDir, 'lcov.info'), 'LF:1\nLH:1\nFNF:0\nFNH:0\n')
        return 0
      },
      runStryker() {
        return 0
      },
      runStorybookCoverage({ lcovDir }) {
        writeFileSync(
          join(lcovDir, 'lcov.info'),
          [`SF:${join(dir, 'src', 'Card.vue')}`, 'DA:3,1', 'LF:1', 'LH:1', 'FNF:0', 'FNH:0', 'end_of_record', ''].join(
            '\n'
          )
        )
        return 0
      },
      runStorybookMutantTest({ cwd, storyFilter, timeoutMs }) {
        // під час прогону файл мутований, після — відновлюється (перевірка нижче)
        mutantRuns.push({ storyFilter, timeoutMs, mutated: readFileSync(join(cwd, 'src', 'Card.vue'), 'utf8') })
        return mutantRuns.length === 1 ? 1 : 0 // перший killed, другий survived
      }
    }

    const rows = await collect(dir, { runner, base: 'B', changedFiles: ['src/Card.vue'] })
    const sbRow = rows.find(r => r.area === 'Vue (Storybook)')

    expect(mutantRuns).toHaveLength(2)
    // сторі-фільтр знайдено (makeStorybookRoot кладе src/Card.stories.js), таймаут ≥ мінімуму
    expect(mutantRuns[0].storyFilter).toBe('src/Card.stories.js')
    expect(mutantRuns[0].timeoutMs).toBeGreaterThanOrEqual(30_000)
    // кожен прогін бачив мутований файл
    expect(mutantRuns.every(r => r.mutated !== vueSrc)).toBe(true)
    // а після прогону файл відновлено
    expect(readFileSync(join(dir, 'src', 'Card.vue'), 'utf8')).toBe(vueSrc)

    expect(sbRow.mutation).toEqual({ caught: 1, total: 2 })
    expect(sbRow.survived).toEqual([
      {
        file: 'src/Card.vue',
        mutants: [{ line: 3, col: 17, mutantType: 'LogicalOperator', original: '&&', replacement: '||' }],
        exampleTest: null,
        recommendationText: null
      }
    ])
    rmSync(dir, { recursive: true, force: true })
  })

  test('--changed: proposeStorybookLlmMutants (LLM-джерело) додає мутанти поверх детермінованих', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'js-cov-sb-llm-'))
    makeStorybookRoot(dir)
    const vueSrc = '<template><div /></template>\n<script setup>\nconst ok = a < b\n</script>\n'
    writeFileSync(join(dir, 'src', 'Card.vue'), vueSrc)
    const reportDir = join(dir, 'reports', 'stryker')
    mkdirSync(reportDir, { recursive: true })
    writeFileSync(join(reportDir, 'mutation.json'), JSON.stringify({ files: {} }))

    const llmCalls = []
    let mutantRuns = 0
    const runner = {
      runJsCoverage({ lcovDir }) {
        writeFileSync(join(lcovDir, 'lcov.info'), '')
        return 0
      },
      runStryker() {
        return 0
      },
      runStorybookCoverage({ lcovDir }) {
        writeFileSync(
          join(lcovDir, 'lcov.info'),
          [`SF:${join(dir, 'src', 'Card.vue')}`, 'DA:3,1', 'LF:1', 'LH:1', 'end_of_record', ''].join('\n')
        )
        return 0
      },
      runStorybookMutantTest() {
        mutantRuns++
        return 1 // все killed
      },
      proposeStorybookLlmMutants({ file, source, coveredLines, cwd }) {
        llmCalls.push({ file, cwd, covered: [...coveredLines] })
        // валідний LLM-мутант: `b` (кінець рядка 3) → `b ?? 0`
        const start = source.indexOf('a < b') + 4
        return Promise.resolve([
          {
            line: 3,
            col: 15,
            mutantType: 'llm:fallback',
            original: 'b',
            replacement: 'b ?? 0',
            start,
            end: start + 1,
            text: 'b ?? 0',
            tier: 6
          }
        ])
      }
    }

    const rows = await collect(dir, { runner, base: 'B', changedFiles: ['src/Card.vue'] })
    const sbRow = rows.find(r => r.area === 'Vue (Storybook)')

    expect(llmCalls).toEqual([{ file: 'src/Card.vue', cwd: dir, covered: [3] }])
    // 1 детермінований (`<`→`<=`) + 1 LLM
    expect(sbRow.mutation).toEqual({ caught: 2, total: 2 })
    expect(mutantRuns).toBe(2)
    // файл відновлено
    expect(readFileSync(join(dir, 'src', 'Card.vue'), 'utf8')).toBe(vueSrc)
    rmSync(dir, { recursive: true, force: true })
  })

  test('full-режим: mutation НЕ запускається навіть з runStorybookMutantTest у runner', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'js-cov-sb-full-'))
    makeStorybookRoot(dir)
    writeFileSync(join(dir, 'src', 'Card.vue'), '<script setup>\nconst ok = a < b\n</script>\n')
    const runner = {
      runJsCoverage({ lcovDir }) {
        writeFileSync(join(lcovDir, 'lcov.info'), '')
        return 0
      },
      runStryker() {
        return 0
      },
      runStorybookCoverage({ lcovDir }) {
        writeFileSync(
          join(lcovDir, 'lcov.info'),
          [`SF:${join(dir, 'src', 'Card.vue')}`, 'DA:2,1', 'LF:1', 'LH:1', 'end_of_record', ''].join('\n')
        )
        return 0
      },
      runStorybookMutantTest() {
        throw new Error('не мало викликатись у full-режимі')
      }
    }
    const rows = await collect(dir, { runner })
    const sbRow = rows.find(r => r.area === 'Vue (Storybook)')
    expect(sbRow.mutation).toEqual({ caught: 0, total: 0 })
    rmSync(dir, { recursive: true, force: true })
  })

  test('full-режим: canonical stryker.storybook.config.mjs + runStorybookStrykerFull → mutation з mutation.json', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'js-cov-sb-full-canonical-'))
    makeStorybookRoot(dir)
    writeFileSync(join(dir, 'stryker.storybook.config.mjs'), 'export default {}\n')
    writeFileSync(join(dir, 'src', 'Card.vue'), '<script setup>\nconst ok = a < b\n</script>\n')
    const reportDir = join(dir, 'reports', 'stryker-storybook')
    mkdirSync(reportDir, { recursive: true })
    writeFileSync(
      join(reportDir, 'mutation.json'),
      JSON.stringify({
        files: {
          'src/Card.vue': {
            mutants: [
              { status: 'Killed' },
              {
                status: 'Survived',
                mutatorName: 'ConditionalExpression',
                replacement: 'false',
                location: { start: { line: 2, column: 11 }, end: { line: 2, column: 16 } }
              }
            ]
          }
        }
      })
    )

    const calls = []
    const runner = {
      runJsCoverage({ lcovDir }) {
        writeFileSync(join(lcovDir, 'lcov.info'), '')
        return 0
      },
      runStryker() {
        return 0
      },
      runStorybookCoverage({ lcovDir }) {
        writeFileSync(join(lcovDir, 'lcov.info'), '')
        return 0
      },
      runStorybookStrykerFull({ cwd }) {
        calls.push(cwd)
        return 0
      }
    }

    const rows = await collect(dir, { runner })
    const sbRow = rows.find(r => r.area === 'Vue (Storybook)')
    expect(calls).toEqual([dir])
    expect(sbRow.mutation).toEqual({ caught: 1, total: 2 })
    expect(sbRow.survived).toEqual([
      {
        file: 'src/Card.vue',
        mutants: [{ line: 2, col: 11, mutantType: 'ConditionalExpression', original: 'a < b', replacement: 'false' }],
        exampleTest: null,
        recommendationText: null
      }
    ])
    rmSync(dir, { recursive: true, force: true })
  })

  test('full-режим: canonical config є, командний прогін падає БЕЗ mutation.json → throw', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'js-cov-sb-full-fail-'))
    makeStorybookRoot(dir)
    writeFileSync(join(dir, 'stryker.storybook.config.mjs'), 'export default {}\n')
    const runner = {
      runJsCoverage({ lcovDir }) {
        writeFileSync(join(lcovDir, 'lcov.info'), '')
        return 0
      },
      runStryker() {
        return 0
      },
      runStorybookCoverage({ lcovDir }) {
        writeFileSync(join(lcovDir, 'lcov.info'), '')
        return 0
      },
      runStorybookStrykerFull() {
        return 1
      }
    }
    await expect(collect(dir, { runner })).rejects.toThrow(STORYBOOK_STRYKER_FULL_EXIT_RE)
    rmSync(dir, { recursive: true, force: true })
  })

  test('full-режим: canonical config відсутній → skip з попередженням, runStorybookStrykerFull НЕ викликається', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'js-cov-sb-full-no-config-'))
    makeStorybookRoot(dir)
    const runner = {
      runJsCoverage({ lcovDir }) {
        writeFileSync(join(lcovDir, 'lcov.info'), '')
        return 0
      },
      runStryker() {
        return 0
      },
      runStorybookCoverage({ lcovDir }) {
        writeFileSync(join(lcovDir, 'lcov.info'), '')
        return 0
      },
      runStorybookStrykerFull() {
        throw new Error('не мало викликатись — нема canonical config')
      }
    }
    const rows = await collect(dir, { runner })
    const sbRow = rows.find(r => r.area === 'Vue (Storybook)')
    expect(sbRow.mutation).toEqual({ caught: 0, total: 0 })
    rmSync(dir, { recursive: true, force: true })
  })

  test('full-режим: canonical config є, але runner без runStorybookStrykerFull → skip (DI-сумісність)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'js-cov-sb-full-no-runner-'))
    makeStorybookRoot(dir)
    writeFileSync(join(dir, 'stryker.storybook.config.mjs'), 'export default {}\n')
    const runner = {
      runJsCoverage({ lcovDir }) {
        writeFileSync(join(lcovDir, 'lcov.info'), '')
        return 0
      },
      runStryker() {
        return 0
      },
      runStorybookCoverage({ lcovDir }) {
        writeFileSync(join(lcovDir, 'lcov.info'), '')
        return 0
      }
    }
    const rows = await collect(dir, { runner })
    const sbRow = rows.find(r => r.area === 'Vue (Storybook)')
    expect(sbRow.mutation).toEqual({ caught: 0, total: 0 })
    rmSync(dir, { recursive: true, force: true })
  })

  test('--changed: не-Storybook root, змінено .vue → JS-раннер БЕЗ excludeStorybookProject', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'js-cov-vue-nostorybook-'))
    mkdirSync(join(dir, 'src'), { recursive: true })
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ devDependencies: { vitest: '^2.0.0' } }))
    writeFileSync(join(dir, 'src', 'Card.vue'), '<template><div /></template>\n')
    const reportDir = join(dir, 'reports', 'stryker')
    mkdirSync(reportDir, { recursive: true })
    writeFileSync(
      join(reportDir, 'mutation.json'),
      JSON.stringify({ files: { 'src/Card.vue': { mutants: [{ status: 'Killed' }] } } })
    )

    const calls = []
    const runner = {
      runJsCoverage({ excludeStorybookProject }) {
        calls.push(excludeStorybookProject)
        return 0
      },
      runStryker() {
        return 0
      }
    }

    const rows = await collect(dir, { runner, base: 'BASE_SHA', changedFiles: ['src/Card.vue'] })
    expect(rows).toEqual([
      {
        area: 'JS',
        coverage: { lines: { covered: 0, total: 0 }, functions: { covered: 0, total: 0 } },
        mutation: { caught: 1, total: 1 },
        survived: []
      }
    ])
    expect(calls).toEqual([false])
    rmSync(dir, { recursive: true, force: true })
  })

  test('--changed: Storybook-root без relevant (.vue/.stories.*) змін — Storybook-раннер не викликається', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'js-cov-sb-changed-irrelevant-'))
    makeStorybookRoot(dir)
    writeFileSync(join(dir, 'src', 'util.js'), 'export const x = 1\n')

    const runner = {
      runJsCoverage({ lcovDir }) {
        writeFileSync(join(lcovDir, 'lcov.info'), 'LF:5\nLH:5\nFNF:1\nFNH:1\n')
        return 0
      },
      runStryker({ mutate }) {
        expect(mutate).toEqual(['src/util.js'])
        return 0
      },
      runStorybookCoverage() {
        throw new Error('не мало викликатись — .js не relevant для Storybook-scope')
      }
    }
    const reportDir = join(dir, 'reports', 'stryker')
    mkdirSync(reportDir, { recursive: true })
    writeFileSync(join(reportDir, 'mutation.json'), JSON.stringify({ files: {} }))

    const rows = await collect(dir, { runner, base: 'B', changedFiles: ['src/util.js'] })
    expect(rows.map(r => r.area)).toEqual(['JS'])
    rmSync(dir, { recursive: true, force: true })
  })

  test('mutateSrc виключає *.stories.* — Stryker не мутує сторі-файли', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'js-cov-mutate-excl-stories-'))
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ devDependencies: { vitest: '^2.0.0' } }))
    mkdirSync(join(dir, 'src'), { recursive: true })
    writeFileSync(join(dir, 'src', 'a.js'), 'export const x = 1\n')
    writeFileSync(join(dir, 'src', 'a.stories.js'), 'export default {}\n')

    const strykerCalls = []
    const runner = {
      runJsCoverage({ lcovDir }) {
        writeFileSync(join(lcovDir, 'lcov.info'), 'LF:10\nLH:5\nFNF:2\nFNH:1\n')
        return 0
      },
      runStryker({ mutate }) {
        strykerCalls.push(mutate)
        return 0
      }
    }
    const reportDir = join(dir, 'reports', 'stryker')
    mkdirSync(reportDir, { recursive: true })
    writeFileSync(join(reportDir, 'mutation.json'), JSON.stringify({ files: {} }))

    await collect(dir, { runner, base: 'B', changedFiles: ['src/a.js', 'src/a.stories.js'] })
    expect(strykerCalls).toEqual([['src/a.js']])
    rmSync(dir, { recursive: true, force: true })
  })
})
