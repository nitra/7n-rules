// cspell:ignore mutmut — назва тулзи мутаційного тестування Python
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'

import { parseMutantShow, parseMutmutResults } from '../mutmut.mjs'
import provider from '../provider.mjs'

// Форма реального виводу `mutmut results --all true` (mutmut 4.x, проба 2026-07-23).
const RESULTS_FIXTURE = [
  '',
  '    demo.calc.x_add__mutmut_1: killed',
  '    demo.calc.x_add__mutmut_2: survived',
  '    demo.calc.x_add__mutmut_3: timeout',
  '    demo.calc.x_mul__mutmut_1: suspicious',
  '    demo.calc.x_mul__mutmut_2: skipped',
  '    demo.calc.x_mul__mutmut_3: no tests',
  '    demo.calc.x_sub__mutmut_1: survived',
  ''
].join('\n')

// Форма реального виводу `mutmut show <name>` (статус-заголовок + unified diff).
const SHOW_FIXTURE = [
  '# name: survived',
  '',
  '--- src/demo/calc.py',
  '+++ src/demo/calc.py',
  '@@ -4,7 +4,7 @@',
  '',
  ' def add(a, b):',
  '-    return a + b',
  '+    return a - b',
  '',
  ''
].join('\n')

// lcov pytest-cov: SF-шляхи ВІДНОСНІ кореня python-пакета.
const LCOV_FIXTURE = [
  'SF:src/demo/calc.py',
  'FN:1,add',
  'FNDA:1,add',
  'FNF:2',
  'FNH:1',
  'LF:10',
  'LH:7',
  'end_of_record',
  'SF:src/demo/io.py',
  'FNF:1',
  'FNH:1',
  'LF:4',
  'LH:4',
  'end_of_record'
].join('\n')

const PYPROJECT_WITH_MUTMUT = '[project]\nname = "t"\n\n[tool.mutmut]\nsource_paths = ["src"]\n'

describe('parseMutmutResults', () => {
  test('killed+timeout → caught; survived у знаменнику і списку; решта статусів поза лічбою', () => {
    const r = parseMutmutResults(RESULTS_FIXTURE)
    expect(r.caught).toBe(2)
    expect(r.total).toBe(4)
    expect(r.survivedNames).toEqual(['demo.calc.x_add__mutmut_2', 'demo.calc.x_sub__mutmut_1'])
  })

  test('порожній вивід → нулі', () => {
    expect(parseMutmutResults('')).toEqual({ caught: 0, total: 0, survivedNames: [] })
  })
})

describe('parseMutantShow', () => {
  test('file з `---`, line = старт hunk-а + індекс `-`-рядка, original/replacement без префіксів', () => {
    expect(parseMutantShow(SHOW_FIXTURE)).toEqual({
      file: 'src/demo/calc.py',
      line: 6,
      original: 'return a + b',
      replacement: 'return a - b'
    })
  })

  test('вивід без diff-а → null', () => {
    expect(parseMutantShow('# name: survived\n')).toBeNull()
  })
})

/**
 * Runner-стаб: пише lcov у запитаний файл і віддає фіксовані mutmut-тексти.
 * @param {string} lcov вміст lcov (SF відносні кореня)
 * @param {{results?: string, show?: string}} [mut] тексти mutmut або {} (вимір без survived)
 * @returns {typeof import('../provider.mjs').defaultRunner} стаб
 */
function stubRunner(lcov, mut = {}) {
  return {
    hasUv: () => true,
    runPytestCov({ lcovPath }) {
      writeFileSync(lcovPath, lcov)
      return 0
    },
    runMutmut: () => 0,
    mutmutResults: () => mut.results ?? '',
    mutmutShow: () => mut.show ?? ''
  }
}

describe('provider (інжектований runner)', () => {
  let dir

  beforeEach(() => {
    dir = realpathSync(mkdtempSync(join(tmpdir(), 'py-prov-')))
    writeFileSync(join(dir, 'pyproject.toml'), PYPROJECT_WITH_MUTMUT)
    mkdirSync(join(dir, 'src', 'demo'), { recursive: true })
    writeFileSync(join(dir, 'src', 'demo', 'calc.py'), 'def add(a, b):\n    return a + b\n')
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  test('контракт порту: id/title/detect/collect/collectPerFile', () => {
    expect(provider.id).toBe('python')
    expect(provider.title).toContain('mutmut')
    expect(typeof provider.detect).toBe('function')
    expect(typeof provider.collect).toBe('function')
    expect(typeof provider.collectPerFile).toBe('function')
  })

  test('collect: coverage + мутаційний вимір в один рядок Python, шляхи survived відносні cwd', async () => {
    const rows = await provider.collect(dir, {
      runner: stubRunner(LCOV_FIXTURE, { results: RESULTS_FIXTURE, show: SHOW_FIXTURE })
    })
    expect(rows).toHaveLength(1)
    expect(rows[0].area).toBe('Python')
    expect(rows[0].coverage.lines).toEqual({ covered: 11, total: 14 })
    expect(rows[0].coverage.functions).toEqual({ covered: 2, total: 3 })
    expect(rows[0].mutation).toEqual({ caught: 2, total: 4 })
    expect(rows[0].survived).toHaveLength(1)
    expect(rows[0].survived[0].file).toBe(join('src', 'demo', 'calc.py'))
    expect(rows[0].survived[0].mutants[0]).toEqual({
      line: 6,
      col: 0,
      mutantType: 'mutmut',
      original: 'return a + b',
      replacement: 'return a - b'
    })
  })

  test('collect без [tool.mutmut] у pyproject → лише line coverage, без помилки', async () => {
    writeFileSync(join(dir, 'pyproject.toml'), '[project]\nname = "t"\n')
    const rows = await provider.collect(dir, { runner: stubRunner(LCOV_FIXTURE) })
    expect(rows[0].coverage.lines).toEqual({ covered: 11, total: 14 })
    expect(rows[0].mutation).toEqual({ caught: 0, total: 0 })
    expect(rows[0].survived).toEqual([])
  })

  test('collect із порожнім виміром → []', async () => {
    writeFileSync(join(dir, 'pyproject.toml'), '[project]\nname = "t"\n')
    const rows = await provider.collect(dir, { runner: stubRunner('') })
    expect(rows).toEqual([])
  })

  test('collectPerFile: фільтрує до запитаних .py, тести/conftest/setup поза гейтом', async () => {
    const rows = await provider.collectPerFile(dir, {
      files: [
        'src/demo/calc.py',
        'tests/test_calc.py',
        'src/demo/test_helpers.py',
        'src/demo/io_test.py',
        'conftest.py',
        'setup.py'
      ],
      runner: stubRunner(LCOV_FIXTURE)
    })
    expect(rows).toEqual([{ file: join('src', 'demo', 'calc.py'), pct: 70, linesFound: 10, linesCovered: 7 }])
  })

  test('collectPerFile без .py-кандидатів → без прогонів', async () => {
    const rows = await provider.collectPerFile(dir, { files: ['src/app.mjs'], runner: stubRunner(LCOV_FIXTURE) })
    expect(rows).toEqual([])
  })

  test('collectPerFile без uv → порожньо', async () => {
    const runner = { ...stubRunner(LCOV_FIXTURE), hasUv: () => false }
    const rows = await provider.collectPerFile(dir, { files: ['src/demo/calc.py'], runner })
    expect(rows).toEqual([])
  })
})

describe('помилкові гілки', () => {
  test('collect: pytest exit ≠ 0 → кидає з кодом', async () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'py-err-')))
    try {
      writeFileSync(join(dir, 'pyproject.toml'), '[project]\nname = "t"\n')
      const runner = {
        hasUv: () => true,
        runPytestCov: () => 2,
        runMutmut: () => 0,
        mutmutResults: () => '',
        mutmutShow: () => ''
      }
      await expect(provider.collect(dir, { runner })).rejects.toThrow('exit 2')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
