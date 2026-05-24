/**
 * Rust-провайдер для `n-cursor coverage`: збирає метрики покриття (`cargo llvm-cov`)
 * і мутаційного тестування (`cargo-mutants`) для Rust-коду. Активується через
 * правило `rust` у `.n-cursor.json#rules`; applies-логіка — у `detect(cwd)`
 * (наявність Cargo.toml у cwd або workspace-підкаталозі).
 *
 * Контракт провайдера — у docs/superpowers/specs/2026-05-24-coverage-rule-design.md.
 */
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { hasCargoTomlInTree } from '../lib/has-cargo-toml.mjs'

const IGNORED_DIR_NAMES = new Set(['node_modules', '.git', '.next', '.turbo', 'target'])

/**
 * Чи провайдер застосовний у поточному cwd.
 * @param {string} cwd корінь проєкту
 * @returns {Promise<boolean>} true, якщо знайдено Cargo.toml у cwd або workspace-піддереві
 */
export function detect(cwd) {
  if (existsSync(join(cwd, 'Cargo.toml'))) return Promise.resolve(true)
  return Promise.resolve(hasCargoTomlInTree(cwd, IGNORED_DIR_NAMES))
}

/**
 * Знайти Cargo.toml: cwd/Cargo.toml або в одному з workspace-підкаталогів.
 * @param {string} cwd корінь проєкту
 * @returns {Promise<string>} абсолютний шлях до Cargo.toml
 */
async function resolveCargoManifest(cwd) {
  const rootManifest = join(cwd, 'Cargo.toml')
  if (existsSync(rootManifest)) return rootManifest

  const rootPkgPath = join(cwd, 'package.json')
  if (existsSync(rootPkgPath)) {
    const rootPkg = JSON.parse(await readFile(rootPkgPath, 'utf8'))
    const workspaces = Array.isArray(rootPkg.workspaces) ? rootPkg.workspaces : []
    for (const ws of workspaces) {
      const tauriManifest = join(cwd, ws, 'src-tauri', 'Cargo.toml')
      if (existsSync(tauriManifest)) return tauriManifest
      const flatManifest = join(cwd, ws, 'Cargo.toml')
      if (existsSync(flatManifest)) return flatManifest
    }
  }

  throw new Error('rust coverage: Cargo.toml не знайдено (cwd + workspaces)')
}

const defaultRunner = {
  async runLlvmCov({ manifestPath }) {
    const proc = Bun.spawn(['cargo', 'llvm-cov', '--manifest-path', manifestPath, '--json', '--summary-only'], {
      stdout: 'pipe',
      stderr: 'inherit'
    })
    const stdout = await new Response(proc.stdout).text()
    const exitCode = await proc.exited
    return { exitCode, stdout }
  },
  runCargoMutants({ manifestPath, outDir }) {
    const proc = Bun.spawn(['cargo', 'mutants', '--in-place', '-o', outDir, '--manifest-path', manifestPath], {
      stdout: 'inherit',
      stderr: 'inherit'
    })
    return proc.exited
  }
}

/**
 * Збирає Rust-метрики покриття + мутаційного тестування.
 * @param {string} cwd корінь проєкту
 * @param {{runner?: typeof defaultRunner}} [opts] ін'єкція runner-а для тестів
 * @returns {Promise<Array<{area:string, coverage:object, mutation:{caught:number,total:number}}>>} рядки для COVERAGE.md
 */
export async function collect(cwd, opts = {}) {
  const runner = opts.runner ?? defaultRunner
  const manifestPath = await resolveCargoManifest(cwd)

  // 1. Coverage через cargo llvm-cov
  const { exitCode: llvmCode, stdout: llvmJson } = await runner.runLlvmCov({ manifestPath })
  if (llvmCode !== 0) {
    throw new Error('rust coverage: cargo llvm-cov упав — встанови: cargo install cargo-llvm-cov')
  }
  const totals = JSON.parse(llvmJson).data[0].totals
  const coverage = {
    lines: { covered: totals.lines.covered, total: totals.lines.count },
    functions: { covered: totals.functions.covered, total: totals.functions.count }
  }

  // 2. Mutation через cargo mutants
  const outDir = await mkdtemp(join(tmpdir(), 'rust-mutants-'))
  let mutation
  try {
    // cargo-mutants exit ≠ 0 коли є missed — це нормально, не помилка.
    // Реальний крах — відсутній outcomes.json.
    await runner.runCargoMutants({ manifestPath, outDir })
    let outcomes
    try {
      outcomes = JSON.parse(await readFile(join(outDir, 'mutants.out', 'outcomes.json'), 'utf8'))
    } catch {
      throw new Error('rust coverage: cargo mutants не залишив outcomes.json — встанови: cargo install cargo-mutants')
    }
    const caught = (outcomes.caught ?? 0) + (outcomes.timeout ?? 0)
    mutation = { caught, total: caught + (outcomes.missed ?? 0) }
  } finally {
    await rm(outDir, { recursive: true, force: true })
  }

  return [{ area: 'Rust', coverage, mutation }]
}
