/**
 * CoverageProvider Python-екосистеми (порт `coverage` plugin-api, spec
 * 2026-07-22 absorb-7n-test): line coverage через `uv run pytest --cov`
 * (pytest-cov, lcov-звіт) і мутаційне тестування через mutmut 4.x. Методи
 * викликає концерн `coverage` правила `test` ядра — CLI-оркестрації тут
 * немає. Без `uv` — чесний skip з одноразовим hint; без секції
 * `[tool.mutmut].source_paths` у pyproject.toml — skip лише мутаційного
 * виміру з попередженням, line coverage збирається все одно.
 */
// cspell:ignore mutmut — назва тулзи мутаційного тестування Python
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isAbsolute, join, relative, resolve } from 'node:path'

import { parseLcovPerFile, parseLcovTotals } from '@7n/rules/rules/test/coverage/lib/lcov.mjs'
import { findManifestRoots } from '@7n/rules/rules/test/coverage/lib/manifest-roots.mjs'
import { parseMutantShow, parseMutmutResults } from './mutmut.mjs'

/** Python-джерела делта-гейта. */
const PY_SOURCE_RE = /\.py$/
/** Не-джерела для гейта: теки тестів, тест-модулі, conftest і setup-скрипт. */
const NON_SOURCE_RE = /(^|[/\\])tests[/\\]|(^|[/\\])(test_[^/\\]*|conftest|setup)\.py$|_test\.py$/
/** Секція конфігурації mutmut у pyproject.toml (обовʼязкова для mutmut 4.x). */
const MUTMUT_SECTION_RE = /\[tool\.mutmut\][^[]*source_paths/

/** Стеля кількості survived-мутантів, для яких тягнеться `mutmut show`. */
const SURVIVED_SHOW_CAP = 50

const TOOL_HINT = 'python coverage: потрібен uv — вимір пропущено'
const MUTMUT_HINT =
  'python coverage: mutmut не сконфігуровано ([tool.mutmut].source_paths у pyproject.toml) — лише line coverage'

/**
 * Дефолтний spawn-runner провайдера (uv-виклики; інжектовний у тестах).
 */
export const defaultRunner = {
  /**
   * Чи доступний uv (`uv --version` → exit 0).
   * @returns {boolean} true — інстальовано
   */
  hasUv() {
    const r = spawnSync('uv', ['--version'], { encoding: 'utf8' })
    return r.status === 0
  },
  /**
   * Прогін pytest із pytest-cov і lcov-звітом у файл.
   * @param {{cwd: string, lcovPath: string}} opts корінь python-пакета і шлях lcov
   * @returns {number} exit-код
   */
  runPytestCov({ cwd, lcovPath }) {
    const r = spawnSync(
      'uv',
      ['run', '--with', 'pytest-cov', 'pytest', '--cov', `--cov-report=lcov:${lcovPath}`, '-q'],
      {
        cwd,
        stdio: 'inherit',
        env: process.env
      }
    )
    return r.status ?? 1
  },
  /**
   * Прогін мутаційного тестування (`mutmut run`, пише `mutants/` у cwd).
   * Ненульовий exit сам по собі не помилка — істина у `mutmut results`.
   * @param {{cwd: string}} opts корінь python-пакета
   * @returns {number} exit-код
   */
  runMutmut({ cwd }) {
    const r = spawnSync('uv', ['run', '--with', 'mutmut', '--with', 'pytest', 'mutmut', 'run'], {
      cwd,
      stdio: 'inherit',
      env: process.env
    })
    return r.status ?? 1
  },
  /**
   * Зведення статусів мутантів (`mutmut results --all true`).
   * @param {{cwd: string}} opts корінь python-пакета
   * @returns {string} stdout зі статус-рядками
   */
  mutmutResults({ cwd }) {
    const r = spawnSync('uv', ['run', '--with', 'mutmut', '--with', 'pytest', 'mutmut', 'results', '--all', 'true'], {
      cwd,
      encoding: 'utf8',
      env: process.env
    })
    return r.stdout ?? ''
  },
  /**
   * Diff одного мутанта (`mutmut show <name>`).
   * @param {{cwd: string, name: string}} opts корінь python-пакета та ім'я мутанта
   * @returns {string} stdout із заголовком статусу і unified diff
   */
  mutmutShow({ cwd, name }) {
    const r = spawnSync('uv', ['run', '--with', 'mutmut', '--with', 'pytest', 'mutmut', 'show', name], {
      cwd,
      encoding: 'utf8',
      env: process.env
    })
    return r.stdout ?? ''
  }
}

/**
 * Python-корені під `cwd` (корінь + перший рівень тек із pyproject.toml/setup.py).
 * @param {string} cwd корінь проєкту
 * @returns {Promise<string[]>} абсолютні шляхи коренів
 */
function findPythonRoots(cwd) {
  return findManifestRoots(cwd, ['pyproject.toml', 'setup.py'])
}

/**
 * Шлях із lcov або diff-а mutmut (відносний до python-кореня) → relative до cwd.
 * @param {string} file шлях із виводу тулзи
 * @param {string} pyRoot корінь python-пакета
 * @param {string} cwd корінь проєкту
 * @returns {string} шлях relative до cwd
 */
function rebaseToCwd(file, pyRoot, cwd) {
  return relative(cwd, isAbsolute(file) ? file : resolve(pyRoot, file))
}

/**
 * Чи сконфігуровано mutmut 4.x у корені: pyproject.toml із
 * `[tool.mutmut]` і `source_paths` усередині секції.
 * @param {string} pyRoot корінь python-пакета
 * @returns {Promise<boolean>} true — мутаційний вимір можливий
 */
async function hasMutmutConfig(pyRoot) {
  const manifest = join(pyRoot, 'pyproject.toml')
  if (!existsSync(manifest)) return false
  return MUTMUT_SECTION_RE.test(await readFile(manifest, 'utf8'))
}

/**
 * Line coverage одного python-кореня: pytest-cov у тимчасовий lcov-файл.
 * @param {string} pyRoot корінь python-пакета
 * @param {typeof defaultRunner} runner spawn-інʼєкція
 * @returns {Promise<{totals: object, perFile: Array<object>}>} totals + per-file (шляхи відносні root-а)
 * @throws {Error} коли pytest завершився з помилкою
 */
async function collectLcov(pyRoot, runner) {
  const dir = await mkdtemp(join(tmpdir(), 'py-cov-'))
  const lcovPath = join(dir, 'lcov.info')
  try {
    const code = await runner.runPytestCov({ cwd: pyRoot, lcovPath })
    if (code !== 0) throw new Error(`python coverage: pytest --cov exit ${code}`)
    const text = existsSync(lcovPath) ? await readFile(lcovPath, 'utf8') : ''
    return { totals: parseLcovTotals(text), perFile: parseLcovPerFile(text) }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

/**
 * Мутаційний вимір одного кореня: run → results → show для survived (зі
 * стелею), групування мутантів по файлах у shape CoverageRow.
 * @param {string} pyRoot корінь python-пакета
 * @param {typeof defaultRunner} runner spawn-інʼєкція
 * @returns {Promise<{caught: number, total: number, survived: Array<object>}>} лічильники + групи survived
 */
async function collectMutation(pyRoot, runner) {
  await runner.runMutmut({ cwd: pyRoot })
  const { caught, total, survivedNames } = parseMutmutResults(await runner.mutmutResults({ cwd: pyRoot }))
  if (survivedNames.length > SURVIVED_SHOW_CAP) {
    console.error(
      `⚠ python coverage: survived-мутантів ${survivedNames.length} — деталі diff обрізано до ${SURVIVED_SHOW_CAP}`
    )
  }
  /** @type {Map<string, Array<object>>} */
  const byFile = new Map()
  for (const name of survivedNames.slice(0, SURVIVED_SHOW_CAP)) {
    const shown = parseMutantShow(await runner.mutmutShow({ cwd: pyRoot, name }))
    if (!shown) continue
    if (!byFile.has(shown.file)) byFile.set(shown.file, [])
    byFile.get(shown.file).push({
      line: shown.line,
      col: 0,
      mutantType: 'mutmut',
      original: shown.original,
      replacement: shown.replacement
    })
  }
  const survived = Array.from(byFile, ([file, mutants]) => ({
    file,
    mutants,
    exampleTest: null,
    recommendationText: null
  }))
  return { caught, total, survived }
}

/** CoverageProvider Python: detect/collect/collectPerFile через uv + pytest-cov + mutmut. */
export default {
  id: 'python',
  title: 'Python (pytest-cov + mutmut)',

  /**
   * Чи застосовний вимір: є Python-корені і встановлений uv.
   * Відсутній uv — одноразовий hint у stderr і false (тихий skip виміру).
   * @param {string} cwd корінь проєкту
   * @returns {Promise<boolean>} true — провайдер активний
   */
  async detect(cwd) {
    const roots = await findPythonRoots(cwd)
    if (roots.length === 0) return false
    if (!defaultRunner.hasUv()) {
      if (!this._hinted) {
        console.error(TOOL_HINT)
        this._hinted = true
      }
      return false
    }
    return true
  },

  /**
   * Повний вимір: pytest-cov (рядки/функції) + mutmut (score, survived) по
   * кожному Python-кореню, агрегація в один рядок області `Python`.
   * @param {string} cwd корінь проєкту
   * @param {{runner?: typeof defaultRunner}} [opts] spawn-інʼєкція
   * @returns {Promise<Array<{area: string, coverage: object, mutation: {caught: number, total: number}, survived: Array<object>}>>} рядок `Python` або []
   */
  async collect(cwd, opts = {}) {
    const runner = opts.runner ?? defaultRunner
    const roots = await findPythonRoots(cwd)
    if (roots.length === 0) return []

    const coverage = { lines: { covered: 0, total: 0 }, functions: { covered: 0, total: 0 } }
    const mutation = { caught: 0, total: 0 }
    const survived = []
    for (const pyRoot of roots) {
      const { totals } = await collectLcov(pyRoot, runner)
      coverage.lines.covered += totals.lines.covered
      coverage.lines.total += totals.lines.total
      coverage.functions.covered += totals.functions.covered
      coverage.functions.total += totals.functions.total

      if (!(await hasMutmutConfig(pyRoot))) {
        console.error(MUTMUT_HINT)
        continue
      }
      const parsed = await collectMutation(pyRoot, runner)
      mutation.caught += parsed.caught
      mutation.total += parsed.total
      survived.push(...parsed.survived.map(group => ({ ...group, file: rebaseToCwd(group.file, pyRoot, cwd) })))
    }

    if (coverage.lines.total === 0 && mutation.total === 0) return []
    return [{ area: 'Python', coverage, mutation, survived }]
  },

  /**
   * Делта-вимір per-file line coverage змінених `.py`-файлів (без
   * мутаційного тестування): один pytest-cov-прогін на кожен Python-корінь зі
   * зміненими файлами, фільтрація per-file lcov до запитаних.
   * @param {string} cwd корінь проєкту
   * @param {{files: string[], runner?: typeof defaultRunner}} opts змінені файли (relative до cwd) + інʼєкція
   * @returns {Promise<Array<{file: string, pct: number, linesFound: number, linesCovered: number}>>} рядки гейта
   */
  async collectPerFile(cwd, opts) {
    const runner = opts.runner ?? defaultRunner
    const wanted = opts.files.filter(f => PY_SOURCE_RE.test(f) && !NON_SOURCE_RE.test(f))
    if (wanted.length === 0) return []
    if (!runner.hasUv()) return []

    const roots = await findPythonRoots(cwd)
    const rows = []
    for (const pyRoot of roots) {
      const rootWanted = new Set(
        wanted.filter(f => {
          const rel = relative(pyRoot, join(cwd, f))
          return !rel.startsWith('..') && !isAbsolute(rel)
        })
      )
      if (rootWanted.size === 0) continue

      const { perFile } = await collectLcov(pyRoot, runner)
      for (const row of perFile) {
        const rel = rebaseToCwd(row.file, pyRoot, cwd)
        if (!rootWanted.has(rel)) continue
        rows.push({ ...row, file: rel })
      }
    }
    return rows
  }
}
