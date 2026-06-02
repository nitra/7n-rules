/**
 * Rust-провайдер для `n-cursor coverage`: збирає метрики покриття (`cargo llvm-cov`)
 * і мутаційного тестування (`cargo-mutants`) для Rust-коду. Активується через
 * правило `rust` у `.n-cursor.json#rules`; applies-логіка — у `detect(cwd)`
 * (наявність Cargo.toml у cwd або workspace-підкаталозі).
 *
 * Контракт провайдера — у docs/superpowers/specs/2026-05-24-coverage-rule-design.md.
 */
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { cpus, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { hasCargoTomlInTree } from '../lib/has-cargo-toml.mjs'
import { resolveCargoManifest } from '../../../scripts/utils/resolve-cargo-manifest.mjs'

const IGNORED_DIR_NAMES = new Set(['node_modules', '.git', '.next', '.turbo', 'target'])
/** Rust-релевантні зміни: `.rs`-джерела або маніфести Cargo. */
const RUST_CHANGE = /(\.rs$)|((^|\/)Cargo\.(toml|lock)$)/

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
 * Обчислює кількість паралельних воркерів cargo-mutants. Env override через
 * CARGO_MUTANTS_JOBS (валідне ціле >= 1). Fallback — min(4, max(1, cpus/2)):
 * на ≤2 ядрах = 1, на 4 = 2, на 8+ = 4. Стеля 4 — Rust linker bottleneck:
 * вище практичного приросту не дає навіть на 16+ ядрах.
 * @param {string | undefined} envValue значення `process.env.CARGO_MUTANTS_JOBS`
 * @returns {number} кількість паралельних воркерів (>= 1)
 */
export function resolveJobs(envValue) {
  if (envValue !== undefined && envValue !== '') {
    const n = Number.parseInt(envValue, 10)
    if (Number.isFinite(n) && n >= 1) return n
  }
  return Math.min(4, Math.max(1, Math.floor(cpus().length / 2)))
}

/**
 * Резолвить базовий git-ref для incremental mutation через cargo-mutants `--in-diff`.
 * Порожнє/відсутнє значення → `null` = повний прогін усіх мутантів (дефолт для `main`).
 * Непорожнє (напр. `origin/main`) → мутуємо лише змінене у `<ref>...HEAD` (для feature-гілки).
 * cargo-mutants не має persistent-кешу вердиктів (як Stryker `incremental.json`) — scoping
 * за git-diff це його штатний аналог «не передивляйся незмінений код».
 * @param {string | undefined} envValue значення `process.env.CARGO_MUTANTS_BASE_REF`
 * @returns {string | null} trimmed ref або null
 */
export function resolveBaseRef(envValue) {
  if (envValue === undefined) return null
  const trimmed = envValue.trim()
  return trimmed === '' ? null : trimmed
}

/**
 * Резолвить режим baseline для cargo-mutants. `CARGO_MUTANTS_BASELINE=skip`
 * (case-insensitive) → `'skip'` = пропустити немутований baseline build+test:
 * фіксована економія в один повний `cargo test`, безпечна ЛИШЕ коли тести вже
 * зелені у попередньому CI-степі (інакше всі вердикти сміттєві). Будь-що інше →
 * `null` = дефолтний baseline-прогін. Цінність найбільша разом з `--in-diff`,
 * де baseline — більша частка дрібного прогону.
 * @param {string | undefined} envValue значення `process.env.CARGO_MUTANTS_BASELINE`
 * @returns {'skip' | null} режим або null для дефолту
 */
export function resolveBaseline(envValue) {
  return envValue !== undefined && envValue.trim().toLowerCase() === 'skip' ? 'skip' : null
}

/**
 * Будує argv для `cargo mutants`. `--in-place` навмисно відсутній: cargo-mutants
 * створює власну sandbox-копію в `target/mutants.<i>/`, що обов'язкове для `--jobs > 1`.
 * `diffPath` (опційно) вмикає `--in-diff` — мутуються лише рядки з цього unified-diff.
 * `baseline === 'skip'` (опційно) додає `--baseline skip` — без немутованого baseline-прогону.
 * @param {{ manifestPath: string, outDir: string, jobs: number, diffPath?: string, baseline?: 'skip' | null }} opts параметри запуску
 * @returns {string[]} argv для cargo
 */
export function buildCargoMutantsArgs({ manifestPath, outDir, jobs, diffPath, baseline }) {
  const args = ['mutants', '--jobs', String(jobs), '-o', outDir, '--manifest-path', manifestPath]
  if (diffPath) args.push('--in-diff', diffPath)
  if (baseline === 'skip') args.push('--baseline', 'skip')
  return args
}

const defaultRunner = {
  runLlvmCov({ manifestPath }) {
    const r = spawnSync('cargo', ['llvm-cov', '--manifest-path', manifestPath, '--json', '--summary-only'], {
      stdio: ['inherit', 'pipe', 'inherit'],
      env: process.env
    })
    return { exitCode: r.status ?? 1, stdout: r.stdout?.toString('utf8') ?? '' }
  },
  runCargoMutants({ manifestPath, outDir, diffPath }) {
    const jobs = resolveJobs(process.env.CARGO_MUTANTS_JOBS)
    const baseline = resolveBaseline(process.env.CARGO_MUTANTS_BASELINE)
    const r = spawnSync('cargo', buildCargoMutantsArgs({ manifestPath, outDir, jobs, diffPath, baseline }), {
      stdio: 'inherit',
      env: process.env
    })
    return r.status ?? 1
  },
  runGitDiff({ manifestPath, baseRef }) {
    // `--relative` + cwd = каталог crate → шляхи в diff збігаються з тим, що
    // cargo-mutants мутує (relative до package), навіть у monorepo з src-tauri/.
    // Three-dot `<ref>...HEAD` = зміни гілки від merge-base, а не «з того часу в ref».
    const r = spawnSync('git', ['diff', '--relative', `${baseRef}...HEAD`], {
      cwd: dirname(manifestPath),
      stdio: ['inherit', 'pipe', 'inherit'],
      env: process.env
    })
    return { exitCode: r.status ?? 1, stdout: r.stdout?.toString('utf8') ?? '' }
  }
}

/**
 * Збирає Rust-метрики покриття + мутаційного тестування.
 *
 * Changed-режим (`opts.changedFiles` задано): якщо серед змінених немає Rust-релевантних
 * файлів (`.rs` / `Cargo.toml` / `Cargo.lock`) — повертає `[]` (skip), щоб JS-only крок
 * турнікета не ганяв повний `cargo mutants`. Якщо Rust змінено — наразі прогін повний по
 * crate (per-file scoping cargo-mutants — окремий крок).
 * @param {string} cwd корінь проєкту
 * @param {{runner?: typeof defaultRunner, changedFiles?: string[]}} [opts] ін'єкція runner-а + changed-scope
 * @returns {Promise<Array<{area:string, coverage:object, mutation:{caught:number,total:number}}>>} рядки для COVERAGE.md
 */
export async function collect(cwd, opts = {}) {
  const runner = opts.runner ?? defaultRunner
  // Changed-режим без Rust-релевантних змін → не запускаємо повний crate-прогін.
  if (Array.isArray(opts.changedFiles) && !opts.changedFiles.some(f => RUST_CHANGE.test(f))) {
    return []
  }
  const manifestPath = await resolveCargoManifest(cwd)
  if (manifestPath === null) {
    throw new Error('rust coverage: Cargo.toml не знайдено (cwd + workspaces)')
  }

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

  // 2. Mutation через cargo mutants.
  // CARGO_MUTANTS_BASE_REF (напр. `origin/main`) вмикає incremental-режим: мутуємо
  // лише рядки, змінені у `<baseRef>...HEAD` (`git diff --relative` → cargo-mutants
  // `--in-diff`). Env не задано — повний прогін усіх мутантів (дефолт для `main`).
  const baseRef = resolveBaseRef(process.env.CARGO_MUTANTS_BASE_REF)
  const outDir = await mkdtemp(join(tmpdir(), 'rust-mutants-'))
  let mutation
  try {
    let diffPath
    if (baseRef !== null) {
      const { exitCode: diffCode, stdout: diff } = await runner.runGitDiff({ manifestPath, baseRef })
      if (diffCode !== 0) {
        // Невідомий ref / не git-репо — не валимо прогін, відкочуємось до повного.
        process.stderr.write(`rust coverage: git diff проти '${baseRef}' упав — повний mutation-прогін\n`)
      } else if (diff.trim() === '') {
        // У `<baseRef>...HEAD` немає змін під цим crate — мутувати нічого.
        return [{ area: 'Rust', coverage, mutation: { caught: 0, total: 0 } }]
      } else {
        diffPath = join(outDir, 'in-diff.patch')
        await writeFile(diffPath, diff)
      }
    }
    // cargo-mutants exit ≠ 0 коли є missed — це нормально, не помилка.
    // Реальний крах — відсутній outcomes.json.
    await runner.runCargoMutants({ manifestPath, outDir, diffPath })
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
