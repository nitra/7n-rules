import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'

import { parseLcovPerFile, parseLcovTotals } from '@7n/rules/rules/test/coverage/lib/lcov.mjs'
import { parseMutantsOutcomes } from '../mutants.mjs'
import provider from '../provider.mjs'
import { findRustRoots } from '../roots.mjs'

// Фрагмент реального виводу `cargo llvm-cov --lcov` (проба 2026-07-22): SF — абсолютний шлях.
const LCOV_FIXTURE = [
  'SF:/tmp/crate/src/main.rs',
  'FN:1,_add',
  'FNDA:1,_add',
  'FNF:2',
  'FNH:1',
  'LF:10',
  'LH:7',
  'end_of_record',
  'SF:/tmp/crate/src/lib.rs',
  'FNF:1',
  'FNH:1',
  'LF:4',
  'LH:4',
  'end_of_record'
].join('\n')

// Форма реального mutants.out/outcomes.json (cargo-mutants 27.0, проба 2026-07-22).
const OUTCOMES_FIXTURE = {
  outcomes: [
    { scenario: 'Baseline', summary: 'Success' },
    {
      scenario: {
        Mutant: {
          name: 'src/main.rs:2:5: replace add -> i32 with 0',
          file: 'src/main.rs',
          function: { function_name: 'add' },
          span: { start: { line: 2, column: 5 }, end: { line: 2, column: 10 } },
          replacement: '0',
          genre: 'FnValue'
        }
      },
      summary: 'CaughtMutant'
    },
    {
      scenario: {
        Mutant: {
          name: 'src/main.rs:6:5: replace main with ()',
          file: 'src/main.rs',
          function: { function_name: 'main' },
          span: { start: { line: 6, column: 5 }, end: { line: 7, column: 1 } },
          replacement: '()',
          genre: 'FnValue'
        }
      },
      summary: 'MissedMutant'
    },
    {
      scenario: {
        Mutant: {
          name: 'src/lib.rs:1:1: broken',
          file: 'src/lib.rs',
          span: { start: { line: 1, column: 1 } },
          replacement: 'x',
          genre: 'FnValue'
        }
      },
      summary: 'Unviable'
    }
  ]
}

describe('parseLcovTotals / parseLcovPerFile', () => {
  test('агрегує totals по всіх записах', () => {
    expect(parseLcovTotals(LCOV_FIXTURE)).toEqual({
      lines: { covered: 11, total: 14 },
      functions: { covered: 2, total: 3 }
    })
  })

  test('per-file рядки з pct', () => {
    const rows = parseLcovPerFile(LCOV_FIXTURE)
    expect(rows).toHaveLength(2)
    expect(rows[0]).toEqual({ file: '/tmp/crate/src/main.rs', pct: 70, linesFound: 10, linesCovered: 7 })
    expect(rows[1].pct).toBe(100)
  })
})

describe('parseMutantsOutcomes', () => {
  test('caught/total рахуються, Unviable поза знаменником, survived групуються', () => {
    const r = parseMutantsOutcomes(OUTCOMES_FIXTURE)
    expect(r.caught).toBe(1)
    expect(r.total).toBe(2)
    expect(r.survived).toHaveLength(1)
    expect(r.survived[0].file).toBe('src/main.rs')
    expect(r.survived[0].mutants[0]).toEqual({
      line: 6,
      col: 5,
      mutantType: 'FnValue',
      original: 'main',
      replacement: '()'
    })
  })

  test('порожній звіт → нулі', () => {
    expect(parseMutantsOutcomes({})).toEqual({ caught: 0, total: 0, survived: [] })
  })
})

describe('findRustRoots', () => {
  let dir

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'rust-roots-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  test('корінь із Cargo.toml + перший рівень, службові теки пропущені', async () => {
    writeFileSync(join(dir, 'Cargo.toml'), '[package]\n')
    mkdirSync(join(dir, 'src-tauri'))
    writeFileSync(join(dir, 'src-tauri', 'Cargo.toml'), '[package]\n')
    mkdirSync(join(dir, 'node_modules', 'x'), { recursive: true })
    writeFileSync(join(dir, 'node_modules', 'x', 'Cargo.toml'), '[package]\n')
    const roots = await findRustRoots(dir)
    expect(roots).toEqual([dir, join(dir, 'src-tauri')])
  })

  test('без Cargo.toml ніде → порожньо', async () => {
    expect(await findRustRoots(dir)).toEqual([])
  })
})

/**
 * Runner-стаб: пише lcov (шляхи відносно крейта) і outcomes.json.
 * @param {string} lcov вміст lcov (з SF-шляхами)
 * @param {object|null} outcomes вміст outcomes.json або null (без мутаційного виміру)
 * @returns {typeof import('../provider.mjs').defaultRunner} стаб
 */
function stubRunner(lcov, outcomes) {
  return {
    hasCargoTool: () => outcomes !== null,
    runLlvmCov({ lcovPath }) {
      writeFileSync(lcovPath, lcov)
      return 0
    },
    runMutants({ cwd }) {
      mkdirSync(join(cwd, 'mutants.out'), { recursive: true })
      writeFileSync(join(cwd, 'mutants.out', 'outcomes.json'), JSON.stringify(outcomes))
      return 2
    }
  }
}

describe('provider (інжектований runner)', () => {
  let dir

  beforeEach(() => {
    dir = realpathSync(mkdtempSync(join(tmpdir(), 'rust-prov-')))
    writeFileSync(join(dir, 'Cargo.toml'), '[package]\nname = "t"\n')
    mkdirSync(join(dir, 'src'))
    writeFileSync(join(dir, 'src', 'main.rs'), 'fn main() {}\n')
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  test('контракт порту: id/title/detect/collect/collectPerFile', () => {
    expect(provider.id).toBe('rust')
    expect(typeof provider.detect).toBe('function')
    expect(typeof provider.collect).toBe('function')
    expect(typeof provider.collectPerFile).toBe('function')
  })

  test('collect: coverage + мутаційний вимір в один рядок Rust', async () => {
    const lcov = `SF:${join(dir, 'src', 'main.rs')}\nFNF:1\nFNH:1\nLF:5\nLH:4\nend_of_record\n`
    const rows = await provider.collect(dir, { runner: stubRunner(lcov, OUTCOMES_FIXTURE) })
    expect(rows).toHaveLength(1)
    expect(rows[0].area).toBe('Rust')
    expect(rows[0].coverage.lines).toEqual({ covered: 4, total: 5 })
    expect(rows[0].mutation).toEqual({ caught: 1, total: 2 })
    expect(rows[0].survived[0].file).toBe(join('src', 'main.rs'))
  })

  test('collect без cargo-mutants → лише line coverage, без помилки', async () => {
    const lcov = `SF:${join(dir, 'src', 'main.rs')}\nLF:5\nLH:5\nend_of_record\n`
    const rows = await provider.collect(dir, { runner: stubRunner(lcov, null) })
    expect(rows[0].mutation).toEqual({ caught: 0, total: 0 })
    expect(rows[0].survived).toEqual([])
  })

  test('collectPerFile: фільтрує до запитаних .rs, тести/бенчі поза гейтом', async () => {
    const lcov = [
      `SF:${join(dir, 'src', 'main.rs')}`,
      'LF:10',
      'LH:3',
      'end_of_record',
      `SF:${join(dir, 'src', 'other.rs')}`,
      'LF:2',
      'LH:2',
      'end_of_record'
    ].join('\n')
    const rows = await provider.collectPerFile(dir, {
      files: ['src/main.rs', 'tests/integration.rs', 'benches/bench.rs', 'build.rs'],
      runner: stubRunner(lcov, OUTCOMES_FIXTURE)
    })
    expect(rows).toEqual([{ file: join('src', 'main.rs'), pct: 30, linesFound: 10, linesCovered: 3 }])
  })

  test('collectPerFile без .rs-кандидатів → без прогонів', async () => {
    const rows = await provider.collectPerFile(dir, { files: ['src/app.mjs'], runner: stubRunner('', null) })
    expect(rows).toEqual([])
  })
})

describe('comment-only делта-ігнор (Rust)', () => {
  const RS = 'fn add(a: i32, b: i32) -> i32 {\n    a + b\n}\n'
  let dir

  beforeEach(() => {
    dir = realpathSync(mkdtempSync(join(tmpdir(), 'rust-comments-')))
    const git = (...args) => spawnSync('git', args, { cwd: dir, encoding: 'utf8' })
    git('init', '-q', '-b', 'main')
    writeFileSync(join(dir, 'Cargo.toml'), '[package]\nname = "t"\n')
    mkdirSync(join(dir, 'src'))
    writeFileSync(join(dir, 'src', 'lib.rs'), RS)
    git('add', '.')
    git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'init')
    git('checkout', '-qb', 'feature')
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  test('доданий doc-коментар → файл пропущено без прогону', async () => {
    writeFileSync(join(dir, 'src', 'lib.rs'), `/// Додає числа.\n${RS}`)
    const runner = stubRunner('', OUTCOMES_FIXTURE)
    const rows = await provider.collectPerFile(dir, { files: ['src/lib.rs'], runner })
    expect(rows).toEqual([])
  })

  test('реальна зміна коду → файл у гейті', async () => {
    writeFileSync(join(dir, 'src', 'lib.rs'), RS.replace('a + b', 'a - b'))
    const lcov = `SF:${join(dir, 'src', 'lib.rs')}\nLF:3\nLH:0\nend_of_record\n`
    const rows = await provider.collectPerFile(dir, {
      files: ['src/lib.rs'],
      runner: stubRunner(lcov, OUTCOMES_FIXTURE)
    })
    expect(rows).toHaveLength(1)
    expect(rows[0].pct).toBe(0)
  })
})

describe('fix-hooks (промпти — чисті)', () => {
  test('buildGenTestsPrompt містить файли і канон #[cfg(test)]', async () => {
    const { buildGenTestsPrompt } = await import('../fix-hooks.mjs')
    const p = buildGenTestsPrompt([{ file: 'src/lib.rs', pct: 12.5 }])
    expect(p).toContain('src/lib.rs')
    expect(p).toContain('12.5%')
    expect(p).toContain('#[cfg(test)]')
  })

  test('buildFixSurvivedPrompt містить мутанти з рядками і replacement', async () => {
    const { buildFixSurvivedPrompt } = await import('../fix-hooks.mjs')
    const p = buildFixSurvivedPrompt([
      { file: 'src/lib.rs', mutants: [{ line: 6, mutantType: 'FnValue', original: 'main', replacement: '()' }] }
    ])
    expect(p).toContain('src/lib.rs')
    expect(p).toContain('рядок 6')
    expect(p).toContain('cargo test')
  })

  test('generateTests/fixSurvived — опційні хуки присутні на провайдері', () => {
    expect(typeof provider.generateTests).toBe('function')
    expect(typeof provider.fixSurvived).toBe('function')
  })
})

describe('помилкові гілки', () => {
  test('detect: без Cargo.toml → false', async () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'rust-empty-')))
    try {
      expect(await provider.detect(dir)).toBe(false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('collect: llvm-cov exit ≠ 0 → кидає з кодом', async () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'rust-err-')))
    try {
      writeFileSync(join(dir, 'Cargo.toml'), '[package]\n')
      const runner = { hasCargoTool: () => true, runLlvmCov: () => 3, runMutants: () => 0 }
      await expect(provider.collect(dir, { runner })).rejects.toThrow('exit 3')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('collect: mutants без outcomes.json → зрозуміла помилка', async () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'rust-no-report-')))
    try {
      writeFileSync(join(dir, 'Cargo.toml'), '[package]\n')
      const lcov = `SF:${join(dir, 'src', 'main.rs')}\nLF:1\nLH:1\nend_of_record\n`
      const runner = {
        hasCargoTool: () => true,
        runLlvmCov({ lcovPath }) {
          writeFileSync(lcovPath, lcov)
          return 0
        },
        runMutants: () => 0
      }
      await expect(provider.collect(dir, { runner })).rejects.toThrow('outcomes.json')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
