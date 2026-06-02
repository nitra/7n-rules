/**
 * Тести Rust-coverage-провайдера (rust.mdc): detect() — наявність Cargo.toml
 * у cwd або workspace-підкаталозі; collect() спавнить cargo llvm-cov +
 * cargo-mutants, парсить JSON-виводи. collect() тестується з ін'єктованим runner-ом.
 */
import { describe, expect, test } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { cpus, tmpdir } from 'node:os'
import { join } from 'node:path'

import { buildCargoMutantsArgs, collect, detect, resolveBaseRef, resolveBaseline, resolveJobs } from '../coverage.mjs'

const CARGO_LLVM_COV_INSTALL_RE = /cargo install cargo-llvm-cov/
const CARGO_MUTANTS_INSTALL_RE = /cargo install cargo-mutants/
const CARGO_TOML_MISSING_RE = /Cargo\.toml не знайдено/u

/**
 * Тимчасова fixture-директорія з опційним Cargo.toml.
 * @param {{withCargo?: boolean, nested?: boolean}} [opts] чи створювати manifest і де саме
 * @returns {string} абсолютний шлях до тимчасового кореня
 */
function makeFixture({ withCargo = true, nested = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'rust-coverage-'))
  if (withCargo) {
    if (nested) {
      mkdirSync(join(dir, 'src-tauri'), { recursive: true })
      writeFileSync(join(dir, 'src-tauri', 'Cargo.toml'), '[package]\nname="foo"\nversion="0.1.0"\n')
    } else {
      writeFileSync(join(dir, 'Cargo.toml'), '[package]\nname="foo"\nversion="0.1.0"\n')
    }
  }
  return dir
}

describe('rust coverage detect()', () => {
  test('повертає true коли Cargo.toml у корені cwd', async () => {
    const dir = makeFixture()
    expect(await detect(dir)).toBe(true)
    rmSync(dir, { recursive: true, force: true })
  })

  test('повертає true коли Cargo.toml у workspace-підкаталозі (src-tauri/)', async () => {
    const dir = makeFixture({ nested: true })
    expect(await detect(dir)).toBe(true)
    rmSync(dir, { recursive: true, force: true })
  })

  test('повертає false без Cargo.toml', async () => {
    const dir = makeFixture({ withCargo: false })
    expect(await detect(dir)).toBe(false)
    rmSync(dir, { recursive: true, force: true })
  })
})

describe('rust coverage collect()', () => {
  test('парсить llvm-cov JSON + cargo-mutants outcomes.json', async () => {
    const dir = makeFixture()
    const calls = []
    const runner = {
      runLlvmCov({ manifestPath }) {
        calls.push({ kind: 'llvm-cov', manifestPath })
        return {
          exitCode: 0,
          stdout: JSON.stringify({
            data: [
              {
                totals: {
                  lines: { covered: 80, count: 100, percent: 80 },
                  functions: { covered: 18, count: 20, percent: 90 }
                }
              }
            ]
          })
        }
      },
      runCargoMutants({ manifestPath, outDir }) {
        calls.push({ kind: 'mutants', manifestPath, outDir })
        const dotOut = join(outDir, 'mutants.out')
        mkdirSync(dotOut, { recursive: true })
        writeFileSync(join(dotOut, 'outcomes.json'), JSON.stringify({ caught: 7, timeout: 1, missed: 2, unviable: 5 }))
        return 0
      }
    }

    const rows = await collect(dir, { runner })
    expect(rows).toEqual([
      {
        area: 'Rust',
        coverage: { lines: { covered: 80, total: 100 }, functions: { covered: 18, total: 20 } },
        mutation: { caught: 8, total: 10 }
      }
    ])
    expect(calls[0].kind).toBe('llvm-cov')
    expect(calls[1].kind).toBe('mutants')
    rmSync(dir, { recursive: true, force: true })
  })

  test('падає якщо llvm-cov exit ≠ 0 — explainer з install-командою', async () => {
    const dir = makeFixture()
    const runner = {
      runLlvmCov() {
        return { exitCode: 1, stdout: '' }
      },
      runCargoMutants() {
        return 0
      }
    }
    await expect(collect(dir, { runner })).rejects.toThrow(CARGO_LLVM_COV_INSTALL_RE)
    rmSync(dir, { recursive: true, force: true })
  })

  test('падає коли Cargo.toml не знайдено', async () => {
    const dir = makeFixture({ withCargo: false })
    await expect(collect(dir, { runner: {} })).rejects.toThrow(CARGO_TOML_MISSING_RE)
    rmSync(dir, { recursive: true, force: true })
  })

  test('падає якщо cargo-mutants не залишив outcomes.json', async () => {
    const dir = makeFixture()
    const runner = {
      runLlvmCov() {
        return {
          exitCode: 0,
          stdout: JSON.stringify({
            data: [{ totals: { lines: { covered: 0, count: 0 }, functions: { covered: 0, count: 0 } } }]
          })
        }
      },
      runCargoMutants() {
        return 0
      }
    }
    await expect(collect(dir, { runner })).rejects.toThrow(CARGO_MUTANTS_INSTALL_RE)
    rmSync(dir, { recursive: true, force: true })
  })
})

/** Записує outcomes.json у sandbox, що його залишає cargo-mutants. */
function writeOutcomes(outDir) {
  const dotOut = join(outDir, 'mutants.out')
  mkdirSync(dotOut, { recursive: true })
  writeFileSync(join(dotOut, 'outcomes.json'), JSON.stringify({ caught: 1, missed: 0 }))
}

/** Runner з llvm-cov-заглушкою (0/0 покриття) для incremental-тестів. */
const LLVM_OK_RUNNER = {
  runLlvmCov() {
    return {
      exitCode: 0,
      stdout: JSON.stringify({
        data: [{ totals: { lines: { covered: 0, count: 0 }, functions: { covered: 0, count: 0 } } }]
      })
    }
  }
}

describe('rust coverage collect() incremental --in-diff', () => {
  test('baseRef + непорожній diff → передає diffPath і пише diff у файл', async () => {
    const dir = makeFixture()
    const prev = process.env.CARGO_MUTANTS_BASE_REF
    process.env.CARGO_MUTANTS_BASE_REF = 'origin/main'
    const DIFF = 'diff --git a/src/lib.rs b/src/lib.rs\n@@\n-1\n+2\n'
    let seenDiffPath
    let writtenDiff
    const runner = {
      ...LLVM_OK_RUNNER,
      runGitDiff({ baseRef }) {
        expect(baseRef).toBe('origin/main')
        return { exitCode: 0, stdout: DIFF }
      },
      runCargoMutants({ outDir, diffPath }) {
        seenDiffPath = diffPath
        writtenDiff = readFileSync(diffPath, 'utf8')
        writeOutcomes(outDir)
        return 0
      }
    }
    try {
      const rows = await collect(dir, { runner })
      expect(rows[0].mutation).toEqual({ caught: 1, total: 1 })
      expect(seenDiffPath).toMatch(/in-diff\.patch$/u)
      expect(writtenDiff).toBe(DIFF)
    } finally {
      if (prev === undefined) delete process.env.CARGO_MUTANTS_BASE_REF
      else process.env.CARGO_MUTANTS_BASE_REF = prev
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('baseRef + порожній diff → cargo-mutants не викликається, mutation 0/0', async () => {
    const dir = makeFixture()
    const prev = process.env.CARGO_MUTANTS_BASE_REF
    process.env.CARGO_MUTANTS_BASE_REF = 'origin/main'
    let mutantsCalled = false
    const runner = {
      ...LLVM_OK_RUNNER,
      runGitDiff() {
        return { exitCode: 0, stdout: '   \n' }
      },
      runCargoMutants() {
        mutantsCalled = true
        return 0
      }
    }
    try {
      const rows = await collect(dir, { runner })
      expect(rows[0].mutation).toEqual({ caught: 0, total: 0 })
      expect(mutantsCalled).toBe(false)
    } finally {
      if (prev === undefined) delete process.env.CARGO_MUTANTS_BASE_REF
      else process.env.CARGO_MUTANTS_BASE_REF = prev
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('baseRef + git diff падає → fallback до повного прогону (diffPath undefined)', async () => {
    const dir = makeFixture()
    const prev = process.env.CARGO_MUTANTS_BASE_REF
    process.env.CARGO_MUTANTS_BASE_REF = 'origin/main'
    let seenDiffPath = 'sentinel'
    const runner = {
      ...LLVM_OK_RUNNER,
      runGitDiff() {
        return { exitCode: 1, stdout: '' }
      },
      runCargoMutants({ outDir, diffPath }) {
        seenDiffPath = diffPath
        writeOutcomes(outDir)
        return 0
      }
    }
    try {
      const rows = await collect(dir, { runner })
      expect(rows[0].mutation).toEqual({ caught: 1, total: 1 })
      expect(seenDiffPath).toBeUndefined()
    } finally {
      if (prev === undefined) delete process.env.CARGO_MUTANTS_BASE_REF
      else process.env.CARGO_MUTANTS_BASE_REF = prev
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('rust coverage buildCargoMutantsArgs()', () => {
  test('містить --jobs <N> як рядок і не містить --in-place', () => {
    const args = buildCargoMutantsArgs({ manifestPath: '/tmp/x/Cargo.toml', outDir: '/tmp/out', jobs: 4 })
    expect(args).not.toContain('--in-place')
    expect(args).toContain('--jobs')
    const i = args.indexOf('--jobs')
    expect(args[i + 1]).toBe('4')
    expect(typeof args[i + 1]).toBe('string')
  })

  test('передає -o outDir і --manifest-path manifestPath', () => {
    const args = buildCargoMutantsArgs({ manifestPath: '/m/Cargo.toml', outDir: '/o', jobs: 2 })
    const oi = args.indexOf('-o')
    expect(args[oi + 1]).toBe('/o')
    const mi = args.indexOf('--manifest-path')
    expect(args[mi + 1]).toBe('/m/Cargo.toml')
  })

  test('без diffPath не додає --in-diff', () => {
    const args = buildCargoMutantsArgs({ manifestPath: '/m/Cargo.toml', outDir: '/o', jobs: 2 })
    expect(args).not.toContain('--in-diff')
  })

  test('з diffPath додає --in-diff <шлях>', () => {
    const args = buildCargoMutantsArgs({
      manifestPath: '/m/Cargo.toml',
      outDir: '/o',
      jobs: 2,
      diffPath: '/o/in-diff.patch'
    })
    const di = args.indexOf('--in-diff')
    expect(di).toBeGreaterThan(-1)
    expect(args[di + 1]).toBe('/o/in-diff.patch')
  })

  test('без baseline не додає --baseline', () => {
    const args = buildCargoMutantsArgs({ manifestPath: '/m/Cargo.toml', outDir: '/o', jobs: 2 })
    expect(args).not.toContain('--baseline')
  })

  test("з baseline 'skip' додає --baseline skip", () => {
    const args = buildCargoMutantsArgs({ manifestPath: '/m/Cargo.toml', outDir: '/o', jobs: 2, baseline: 'skip' })
    const bi = args.indexOf('--baseline')
    expect(bi).toBeGreaterThan(-1)
    expect(args[bi + 1]).toBe('skip')
  })
})

describe('rust coverage resolveBaseline()', () => {
  test("повертає 'skip' для skip (case-insensitive, з пробілами)", () => {
    expect(resolveBaseline('skip')).toBe('skip')
    expect(resolveBaseline('SKIP')).toBe('skip')
    expect(resolveBaseline('  Skip \n')).toBe('skip')
  })

  test('повертає null для відсутнього/іншого значення', () => {
    expect(resolveBaseline(undefined)).toBe(null)
    expect(resolveBaseline('')).toBe(null)
    expect(resolveBaseline('run')).toBe(null)
  })
})

describe('rust coverage resolveBaseRef()', () => {
  test('повертає null для відсутнього/порожнього env', () => {
    expect(resolveBaseRef(undefined)).toBe(null)
    expect(resolveBaseRef('')).toBe(null)
    expect(resolveBaseRef('   ')).toBe(null)
  })

  test('повертає trimmed ref для непорожнього значення', () => {
    expect(resolveBaseRef('origin/main')).toBe('origin/main')
    expect(resolveBaseRef('  main \n')).toBe('main')
  })
})

describe('rust coverage resolveJobs()', () => {
  test('повертає значення env CARGO_MUTANTS_JOBS, коли воно валідне (>=1)', () => {
    expect(resolveJobs('1')).toBe(1)
    expect(resolveJobs('8')).toBe(8)
    expect(resolveJobs('16')).toBe(16)
  })

  test('повертає cpus-based fallback для пустого/відсутнього env', () => {
    const expected = Math.min(4, Math.max(1, Math.floor(cpus().length / 2)))
    expect(resolveJobs()).toBe(expected)
    expect(resolveJobs('')).toBe(expected)
  })

  test('повертає cpus-based fallback для невалідних значень env', () => {
    const expected = Math.min(4, Math.max(1, Math.floor(cpus().length / 2)))
    expect(resolveJobs('abc')).toBe(expected)
    expect(resolveJobs('0')).toBe(expected)
    expect(resolveJobs('-3')).toBe(expected)
  })
})

describe('rust coverage collect() — --changed skip', () => {
  test('changedFiles без Rust-релевантних → [] (runner не викликається)', async () => {
    const dir = makeFixture({ withCargo: true })
    const runner = {
      runLlvmCov() {
        throw new Error('не має викликатись для JS-only змін')
      },
      runCargoMutants() {
        throw new Error('не має викликатись для JS-only змін')
      }
    }
    expect(await collect(dir, { runner, changedFiles: ['app.js', 'README.md'] })).toEqual([])
    rmSync(dir, { recursive: true, force: true })
  })

  test('changedFiles з .rs → повний прогін (runner викликається)', async () => {
    const dir = makeFixture({ withCargo: true })
    const calls = []
    const runner = {
      runLlvmCov() {
        calls.push('llvm')
        return {
          exitCode: 0,
          stdout: JSON.stringify({
            data: [{ totals: { lines: { covered: 1, count: 2 }, functions: { covered: 1, count: 1 } } }]
          })
        }
      },
      runCargoMutants({ outDir }) {
        calls.push('mutants')
        const dotOut = join(outDir, 'mutants.out')
        mkdirSync(dotOut, { recursive: true })
        writeFileSync(join(dotOut, 'outcomes.json'), JSON.stringify({ caught: 1, missed: 0 }))
        return 0
      }
    }
    const rows = await collect(dir, { runner, changedFiles: ['src/lib.rs'] })
    expect(rows).toHaveLength(1)
    expect(calls).toEqual(['llvm', 'mutants'])
    rmSync(dir, { recursive: true, force: true })
  })
})
