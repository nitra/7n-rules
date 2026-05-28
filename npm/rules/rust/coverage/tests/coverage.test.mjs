/**
 * Тести Rust-coverage-провайдера (rust.mdc): detect() — наявність Cargo.toml
 * у cwd або workspace-підкаталозі; collect() спавнить cargo llvm-cov +
 * cargo-mutants, парсить JSON-виводи. collect() тестується з ін'єктованим runner-ом.
 */
import { describe, expect, test } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { cpus, tmpdir } from 'node:os'
import { join } from 'node:path'

import { buildCargoMutantsArgs, collect, detect, resolveJobs } from '../coverage.mjs'

const CARGO_LLVM_COV_INSTALL_RE = /cargo install cargo-llvm-cov/
const CARGO_MUTANTS_INSTALL_RE = /cargo install cargo-mutants/

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
})

describe('rust coverage resolveJobs()', () => {
  test('повертає значення env CARGO_MUTANTS_JOBS, коли воно валідне (>=1)', () => {
    expect(resolveJobs('1')).toBe(1)
    expect(resolveJobs('8')).toBe(8)
    expect(resolveJobs('16')).toBe(16)
  })

  test('повертає cpus-based fallback для пустого/відсутнього env', () => {
    const expected = Math.min(4, Math.max(1, Math.floor(cpus().length / 2)))
    expect(resolveJobs(undefined)).toBe(expected)
    expect(resolveJobs('')).toBe(expected)
  })

  test('повертає cpus-based fallback для невалідних значень env', () => {
    const expected = Math.min(4, Math.max(1, Math.floor(cpus().length / 2)))
    expect(resolveJobs('abc')).toBe(expected)
    expect(resolveJobs('0')).toBe(expected)
    expect(resolveJobs('-3')).toBe(expected)
  })
})
