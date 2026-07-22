/**
 * Тести детекції bun-native workspace-ів (bun-native.mjs) та bun-гілки
 * js-collector-а: coverage через `bun test`, mutation skipped.
 */
import { describe, expect, test } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { hasRunnableTests, isBunNativeRoot } from '../bun-native.mjs'
import { collect } from '../js-collector.mjs'

const JS_COVERAGE_EXIT_RE = /JS coverage.*exit 1/

/**
 * Тимчасова fixture-директорія workspace-а.
 * @param {Record<string, string>} files відносний шлях → вміст
 * @returns {string} абсолютний шлях до тимчасового кореня
 */
function makeFixture(files) {
  const dir = mkdtempSync(join(tmpdir(), 'bun-native-'))
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'fixture' }))
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(dir, rel)
    mkdirSync(join(abs, '..'), { recursive: true })
    writeFileSync(abs, content)
  }
  return dir
}

describe('isBunNativeRoot', () => {
  test("true: prod-код з import { SQL } from 'bun'", async () => {
    const dir = makeFixture({ 'src/conn/pg-read.js': `import { SQL } from 'bun'\nexport const pg = new SQL()\n` })
    expect(await isBunNativeRoot(dir)).toBe(true)
    rmSync(dir, { recursive: true, force: true })
  })

  test("true: import 'bun:sqlite'", async () => {
    const dir = makeFixture({ 'src/db.js': `import { Database } from "bun:sqlite"\n` })
    expect(await isBunNativeRoot(dir)).toBe(true)
    rmSync(dir, { recursive: true, force: true })
  })

  test("false: лише 'bun:test' (його криє lint no-bun-test-import)", async () => {
    // Fixture-рядок навмисно не пишеться як буквальний `from 'bun:test'` (текстовий,
    // не AST-aware detector `test/no-bun-test-import` інакше сприйняв би цей рядок
    // fixture-даних за справжній import і переписав його на 'vitest' — зламавши тест).
    const dir = makeFixture({ 'src/helper.js': `import { test } from '${'bun:test'}'\n` })
    expect(await isBunNativeRoot(dir)).toBe(false)
    rmSync(dir, { recursive: true, force: true })
  })

  test("false: 'bun' лише у тест-файлах — не prod-сигнал", async () => {
    const dir = makeFixture({ 'src/tests/x.test.mjs': `import { SQL } from 'bun'\n` })
    expect(await isBunNativeRoot(dir)).toBe(false)
    rmSync(dir, { recursive: true, force: true })
  })

  test('false: звичайний node-код без bun-імпортів', async () => {
    const dir = makeFixture({ 'src/a.js': `import { readFile } from 'node:fs/promises'\n` })
    expect(await isBunNativeRoot(dir)).toBe(false)
    rmSync(dir, { recursive: true, force: true })
  })

  test('node_modules не скануються', async () => {
    const dir = makeFixture({ 'node_modules/pkg/index.js': `import { SQL } from 'bun'\n` })
    expect(await isBunNativeRoot(dir)).toBe(false)
    rmSync(dir, { recursive: true, force: true })
  })
})

describe('hasRunnableTests', () => {
  test('true: є *.test.mjs у tests/', async () => {
    const dir = makeFixture({ 'src/tests/a.test.mjs': `import { test } from 'vitest'\n` })
    expect(await hasRunnableTests(dir)).toBe(true)
    rmSync(dir, { recursive: true, force: true })
  })

  test('false: лише prod-код', async () => {
    const dir = makeFixture({ 'src/a.js': `export const x = 1\n` })
    expect(await hasRunnableTests(dir)).toBe(false)
    rmSync(dir, { recursive: true, force: true })
  })
})

describe('js-collector: bun-native гілка', () => {
  test('bun-native root з тестами → runBunCoverage, Stryker і vitest НЕ викликаються, mutation 0/0', async () => {
    const dir = makeFixture({
      'src/pg.js': `import { SQL } from 'bun'\nexport const pg = new SQL()\n`,
      'src/tests/pg.test.mjs': `import { test } from 'vitest'\ntest('x', () => {})\n`
    })

    const calls = []
    const runner = {
      runJsCoverage() {
        calls.push('vitest')
        return 0
      },
      runBunCoverage({ lcovDir }) {
        calls.push('bun')
        writeFileSync(join(lcovDir, 'lcov.info'), 'LF:10\nLH:8\nFNF:2\nFNH:2\n')
        return 0
      },
      runStryker() {
        calls.push('stryker')
        return 0
      }
    }

    const rows = await collect(dir, { runner })
    expect(calls).toEqual(['bun'])
    expect(rows).toEqual([
      {
        area: 'JS',
        coverage: { lines: { covered: 8, total: 10 }, functions: { covered: 2, total: 2 } },
        mutation: { caught: 0, total: 0 },
        survived: []
      }
    ])
    rmSync(dir, { recursive: true, force: true })
  })

  test('bun-native root БЕЗ тестів → повний skip (bun test навіть не запускається)', async () => {
    const dir = makeFixture({
      'src/pg.js': `import { SQL } from 'bun'\n`
    })

    const calls = []
    const runner = {
      runJsCoverage() {
        calls.push('vitest')
        return 0
      },
      runBunCoverage() {
        calls.push('bun')
        return 0
      },
      runStryker() {
        calls.push('stryker')
        return 0
      }
    }

    const rows = await collect(dir, { runner })
    expect(calls).toEqual([])
    expect(rows).toEqual([])
    rmSync(dir, { recursive: true, force: true })
  })

  test('bun-native: bun test exit ≠ 0 → throw (падаючі тести не маскуються)', async () => {
    const dir = makeFixture({
      'src/pg.js': `import { SQL } from 'bun'\n`,
      'src/tests/pg.test.mjs': `import { test } from 'vitest'\n`
    })
    const runner = {
      runJsCoverage: () => 0,
      runBunCoverage: () => 1,
      runStryker: () => 0
    }
    await expect(collect(dir, { runner })).rejects.toThrow(JS_COVERAGE_EXIT_RE)
    rmSync(dir, { recursive: true, force: true })
  })

  test('mixed monorepo: vitest-ws + bun-native-ws агрегуються в один рядок', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'bun-native-mixed-'))
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ workspaces: ['a', 'b'] }))
    // a: звичайний vitest-workspace зі stryker-репортом
    mkdirSync(join(dir, 'a', 'src'), { recursive: true })
    writeFileSync(join(dir, 'a', 'package.json'), JSON.stringify({ name: 'a' }))
    const reportDir = join(dir, 'a', 'reports', 'stryker')
    mkdirSync(reportDir, { recursive: true })
    writeFileSync(
      join(reportDir, 'mutation.json'),
      JSON.stringify({ files: { 'src/a.js': { mutants: [{ status: 'Killed' }, { status: 'Killed' }] } } })
    )
    // b: bun-native workspace з тестом
    mkdirSync(join(dir, 'b', 'src', 'tests'), { recursive: true })
    writeFileSync(join(dir, 'b', 'package.json'), JSON.stringify({ name: 'b' }))
    writeFileSync(join(dir, 'b', 'src', 'pg.js'), `import { SQL } from 'bun'\n`)
    writeFileSync(join(dir, 'b', 'src', 'tests', 'pg.test.mjs'), `import { test } from 'vitest'\n`)

    const calls = []
    const runner = {
      runJsCoverage({ cwd, lcovDir }) {
        calls.push(`vitest:${cwd.endsWith('/a') ? 'a' : '?'}`)
        writeFileSync(join(lcovDir, 'lcov.info'), 'LF:20\nLH:10\nFNF:4\nFNH:2\n')
        return 0
      },
      runBunCoverage({ cwd, lcovDir }) {
        calls.push(`bun:${cwd.endsWith('/b') ? 'b' : '?'}`)
        writeFileSync(join(lcovDir, 'lcov.info'), 'LF:10\nLH:5\nFNF:2\nFNH:1\n')
        return 0
      },
      runStryker({ cwd }) {
        calls.push(`stryker:${cwd.endsWith('/a') ? 'a' : '?'}`)
        return 0
      }
    }

    const rows = await collect(dir, { runner })
    expect(calls).toEqual(['vitest:a', 'stryker:a', 'bun:b'])
    expect(rows).toEqual([
      {
        area: 'JS',
        coverage: { lines: { covered: 15, total: 30 }, functions: { covered: 3, total: 6 } },
        mutation: { caught: 2, total: 2 },
        survived: []
      }
    ])
    rmSync(dir, { recursive: true, force: true })
  })
})
