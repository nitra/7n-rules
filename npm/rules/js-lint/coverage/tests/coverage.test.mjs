/**
 * Тести JS-coverage-провайдера (js-lint.mdc): detect() читає `package.json`
 * у cwd або workspace, повертає true якщо є `scripts.test:coverage` чи
 * `scripts.test` з прапором --coverage. collect() спавнить bun test + Stryker,
 * парсить lcov і mutation.json — тестується з ін'єктованим runner-ом.
 */
import { describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { collect, detect } from '../coverage.mjs'

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

describe('js-lint coverage detect()', () => {
  test('повертає true коли scripts.test:coverage існує в кореневому package.json', async () => {
    const dir = makeFixture({ scripts: { 'test:coverage': 'bun test --coverage' } })
    expect(await detect(dir)).toBe(true)
    rmSync(dir, { recursive: true, force: true })
  })

  test('повертає true коли scripts.test:coverage існує в workspace-пакеті', async () => {
    const dir = makeFixture({ scripts: { 'test:coverage': 'bun test --coverage' } }, { workspaceRoot: true })
    expect(await detect(dir)).toBe(true)
    rmSync(dir, { recursive: true, force: true })
  })

  test('повертає true коли scripts.test містить --coverage', async () => {
    const dir = makeFixture({ scripts: { test: 'bun test --coverage src' } })
    expect(await detect(dir)).toBe(true)
    rmSync(dir, { recursive: true, force: true })
  })

  test('повертає false коли немає coverage-сумісного скрипта', async () => {
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

    const reportDir = join(dir, 'reports', 'stryker')
    mkdirSync(reportDir, { recursive: true })
    writeFileSync(
      join(reportDir, 'mutation.json'),
      JSON.stringify({
        files: {
          'src/a.js': {
            mutants: [{ status: 'Killed' }, { status: 'Killed' }, { status: 'Survived' }, { status: 'CompileError' }]
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
        mutation: { caught: 2, total: 3 }
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

  test('падає якщо Stryker не залишив mutation.json', async () => {
    const dir = makeFixture({ scripts: { 'test:coverage': 'bun test --coverage' } })
    const runner = {
      runJsCoverage({ lcovDir }) {
        writeFileSync(join(lcovDir, 'lcov.info'), 'LF:0\nLH:0\nFNF:0\nFNH:0\n')
        return 0
      },
      runStryker() {
        return 0
      }
    }
    await expect(collect(dir, { runner })).rejects.toThrow(MUTATION_JSON_RE)
    rmSync(dir, { recursive: true, force: true })
  })
})
