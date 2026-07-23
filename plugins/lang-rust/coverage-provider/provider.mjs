/**
 * CoverageProvider Rust-екосистеми (порт `coverage` plugin-api, spec
 * 2026-07-22 absorb-7n-test): line coverage через `cargo llvm-cov` (lcov) і
 * мутаційне тестування через `cargo mutants` (`mutants.out/outcomes.json`).
 * Методи викликає концерн `coverage` правила `test` ядра — CLI-оркестрації
 * тут немає. Відсутні тулзи (`cargo-llvm-cov`/`cargo-mutants`) — чесний
 * skip з одноразовим hint, не помилка. Fix-hooks (LLM-генерація тестів) для
 * Rust поки не реалізовані — fix-worker пропускає провайдер без хуків.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, realpathSync } from 'node:fs'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isAbsolute, join, relative, resolve } from 'node:path'

import { parseLcovPerFile, parseLcovTotals } from './lcov.mjs'
import { parseMutantsOutcomes } from './mutants.mjs'
import { findRustRoots } from './roots.mjs'

/** Rust-джерела делта-гейта. */
const RUST_SOURCE_RE = /\.rs$/
/** Не-джерела для гейта: інтеграційні тести, бенчі, приклади, build-скрипти. */
const NON_SOURCE_RE = /(^|[/\\])(tests|benches|examples)[/\\]|(^|[/\\])build\.rs$|_test\.rs$/

const TOOL_HINT =
  'rust coverage: потрібні cargo-llvm-cov і cargo-mutants (`cargo install cargo-llvm-cov cargo-mutants`) — вимір пропущено'

/**
 * Дефолтний spawn-runner провайдера (cargo-виклики; інжектовний у тестах).
 */
export const defaultRunner = {
  /**
   * Чи доступна cargo-підкоманда (`cargo <sub> --version` → exit 0).
   * @param {string} sub назва підкоманди (`llvm-cov`/`mutants`)
   * @returns {boolean} true — інстальовано
   */
  hasCargoTool(sub) {
    const r = spawnSync('cargo', [sub, '--version'], { encoding: 'utf8' })
    return r.status === 0
  },
  /**
   * Прогін `cargo llvm-cov` із lcov-виводом у файл.
   * @param {{cwd: string, lcovPath: string}} opts корінь крейта і шлях lcov
   * @returns {number} exit-код
   */
  runLlvmCov({ cwd, lcovPath }) {
    const r = spawnSync('cargo', ['llvm-cov', '--lcov', '--output-path', lcovPath], {
      cwd,
      stdio: 'inherit',
      env: process.env
    })
    return r.status ?? 1
  },
  /**
   * Прогін `cargo mutants` (пише `mutants.out/` у cwd крейта).
   * Ненульовий exit сам по собі не помилка: cargo-mutants повертає його і
   * при missed-мутантах — істина у `outcomes.json`.
   * @param {{cwd: string}} opts корінь крейта
   * @returns {number} exit-код
   */
  runMutants({ cwd }) {
    const r = spawnSync('cargo', ['mutants', '--no-times'], { cwd, stdio: 'inherit', env: process.env })
    return r.status ?? 1
  }
}

/**
 * Рібейзить шлях із lcov (абсолютний або відносний до root-а) у relative-до-cwd.
 * @param {string} file шлях із lcov
 * @param {string} rustRoot корінь крейта
 * @param {string} cwd корінь проєкту
 * @returns {string} шлях relative до cwd
 */
function rebaseLcovPath(file, rustRoot, cwd) {
  const abs = isAbsolute(file) ? file : resolve(realPathSafe(rustRoot), file)
  return relative(realPathSafe(cwd), abs)
}

/**
 * realpath з fallback на вхідний шлях: llvm-cov віддає realpath (на macOS
 * `/var` → `/private/var`), тож бази рібейзингу канонізуються теж — інакше
 * делта мовчки не матчить файли.
 * @param {string} p шлях
 * @returns {string} канонічний шлях
 */
function realPathSafe(p) {
  try {
    return realpathSync(p)
  } catch {
    return p
  }
}

/**
 * Чи файл — кандидат делта-гейта Rust.
 * @param {string} rel відносний шлях
 * @returns {boolean} true — гейтиться
 */
function isGateCandidate(rel) {
  return RUST_SOURCE_RE.test(rel) && !NON_SOURCE_RE.test(rel)
}

/**
 * Line coverage одного крейта через llvm-cov у тимчасовий lcov.
 * @param {string} rustRoot корінь крейта
 * @param {typeof defaultRunner} runner spawn-інʼєкція
 * @returns {Promise<{totals: object, perFile: Array<object>}>} totals + per-file (шляхи як у lcov)
 * @throws {Error} коли llvm-cov завершився з помилкою
 */
async function collectLcov(rustRoot, runner) {
  const dir = await mkdtemp(join(tmpdir(), 'rust-cov-'))
  const lcovPath = join(dir, 'lcov.info')
  try {
    const code = await runner.runLlvmCov({ cwd: rustRoot, lcovPath })
    if (code !== 0) throw new Error(`rust coverage: cargo llvm-cov exit ${code}`)
    const text = existsSync(lcovPath) ? await readFile(lcovPath, 'utf8') : ''
    return { totals: parseLcovTotals(text), perFile: parseLcovPerFile(text) }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

/** CoverageProvider Rust: detect/collect/collectPerFile через cargo llvm-cov і cargo-mutants. */
export default {
  id: 'rust',
  title: 'Rust (cargo llvm-cov + cargo-mutants)',

  /**
   * Чи застосовний вимір: є Rust-корені і встановлений cargo-llvm-cov.
   * Відсутній тулчейн — одноразовий hint у stderr і false (тихий skip виміру).
   * @param {string} cwd корінь проєкту
   * @returns {Promise<boolean>} true — провайдер активний
   */
  async detect(cwd) {
    const roots = await findRustRoots(cwd)
    if (roots.length === 0) return false
    if (!defaultRunner.hasCargoTool('llvm-cov')) {
      if (!this._hinted) {
        console.error(TOOL_HINT)
        this._hinted = true
      }
      return false
    }
    return true
  },

  /**
   * Повний вимір: llvm-cov (рядки/функції) + cargo-mutants (score, survived)
   * по кожному Rust-кореню, агрегація в один рядок області `Rust`.
   * Мутаційне тестування пропускається з попередженням, якщо cargo-mutants
   * не встановлено (лише line coverage — та сама семантика, що bun-native у JS).
   * @param {string} cwd корінь проєкту
   * @param {{runner?: typeof defaultRunner}} [opts] spawn-інʼєкція
   * @returns {Promise<Array<{area: string, coverage: object, mutation: {caught: number, total: number}, survived: Array<object>}>>} рядок `Rust` або []
   */
  async collect(cwd, opts = {}) {
    const runner = opts.runner ?? defaultRunner
    const roots = await findRustRoots(cwd)
    if (roots.length === 0) return []
    const hasMutants = runner.hasCargoTool('mutants')
    if (!hasMutants) console.error('⚠ rust coverage: cargo-mutants не встановлено — лише line coverage')

    const coverage = { lines: { covered: 0, total: 0 }, functions: { covered: 0, total: 0 } }
    const mutation = { caught: 0, total: 0 }
    const survived = []
    for (const rustRoot of roots) {
      const { totals } = await collectLcov(rustRoot, runner)
      coverage.lines.covered += totals.lines.covered
      coverage.lines.total += totals.lines.total
      coverage.functions.covered += totals.functions.covered
      coverage.functions.total += totals.functions.total

      if (!hasMutants) continue
      await runner.runMutants({ cwd: rustRoot })
      const outcomesPath = join(rustRoot, 'mutants.out', 'outcomes.json')
      if (!existsSync(outcomesPath)) {
        throw new Error('rust coverage: cargo mutants не лишив mutants.out/outcomes.json — перевір прогін')
      }
      const parsed = parseMutantsOutcomes(JSON.parse(await readFile(outcomesPath, 'utf8')))
      mutation.caught += parsed.caught
      mutation.total += parsed.total
      survived.push(...parsed.survived.map(group => ({ ...group, file: relative(cwd, resolve(rustRoot, group.file)) })))
    }

    if (coverage.lines.total === 0 && mutation.total === 0) return []
    return [{ area: 'Rust', coverage, mutation, survived }]
  },

  /**
   * Делта-вимір per-file line coverage змінених `.rs`-файлів (без мутаційного
   * тестування): один llvm-cov-прогін на кожен Rust-корінь зі зміненими
   * файлами, фільтрація per-file lcov до запитаних.
   * @param {string} cwd корінь проєкту
   * @param {{files: string[], runner?: typeof defaultRunner}} opts змінені файли (relative до cwd) + spawn-інʼєкція
   * @returns {Promise<Array<{file: string, pct: number, linesFound: number, linesCovered: number}>>} рядки гейта
   */
  async collectPerFile(cwd, opts) {
    const runner = opts.runner ?? defaultRunner
    const wanted = opts.files.filter(f => isGateCandidate(f))
    if (wanted.length === 0) return []
    if (!runner.hasCargoTool('llvm-cov')) return []

    const roots = await findRustRoots(cwd)
    const rows = []
    for (const rustRoot of roots) {
      const rootWanted = new Set(
        wanted
          .map(f => ({ f, rel: relative(rustRoot, join(cwd, f)) }))
          .filter(({ rel }) => !rel.startsWith('..') && !isAbsolute(rel))
          .map(({ f }) => f)
      )
      if (rootWanted.size === 0) continue

      const { perFile } = await collectLcov(rustRoot, runner)
      for (const row of perFile) {
        const rel = rebaseLcovPath(row.file, rustRoot, cwd)
        if (!rootWanted.has(rel)) continue
        rows.push({ ...row, file: rel })
      }
    }
    return rows
  }
}
