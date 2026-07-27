/**
 * CoverageProvider PHP-екосистеми (порт `coverage` plugin-api, spec
 * 2026-07-22 absorb-7n-test): line/function coverage через PHPUnit/Pest
 * (`--coverage-clover`, clover.xml) і мутаційне тестування через
 * `infection/infection` (`--logger-json`). Методи викликає концерн
 * `coverage` правила `test` ядра — CLI-оркестрації тут немає. Відсутній
 * тулчейн (`vendor/bin/phpunit`/`vendor/bin/pest`) — чесний skip з
 * одноразовим hint, не помилка (та сама семантика, що rust-провайдер).
 * Fix-hooks (LLM-генерація тестів) для PHP поки не реалізовані.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isAbsolute, join, relative, resolve } from 'node:path'

import { parseCloverPerFile, parseCloverTotals } from './clover.mjs'
import { parseInfectionReport } from './infection.mjs'

/** PHP-джерела делта-гейта. */
const PHP_SOURCE_RE = /\.php$/
/** Не-джерела для гейта: тестові теки/файли (конвенція PHPUnit/Pest). */
const NON_SOURCE_RE = /(?:(^|[/\\])tests?[/\\])|(?:Test\.php$)/i

const TOOL_HINT =
  'php coverage: vendor/bin/phpunit або vendor/bin/pest не знайдено ' +
  '(composer require --dev phpunit/phpunit або pestphp/pest) — вимір пропущено'

/**
 * Дефолтний spawn-runner провайдера (composer/vendor-виклики; інжектовний у тестах).
 */
export const defaultRunner = {
  /**
   * Чи є бінарник у `vendor/bin/<name>` кореня проєкту.
   * @param {string} cwd корінь проєкту
   * @param {string} name ім'я бінарника (`phpunit`/`pest`/`infection`)
   * @returns {boolean} true — присутній
   */
  hasVendorBin(cwd, name) {
    return existsSync(join(cwd, 'vendor', 'bin', name))
  },
  /**
   * Прогін PHPUnit/Pest із clover-виводом у файл.
   * @param {{cwd: string, binPath: string, cloverPath: string}} opts корінь, шлях бінарника, шлях clover.xml
   * @returns {number} exit-код
   */
  runCoverage({ cwd, binPath, cloverPath }) {
    const r = spawnSync(binPath, ['--coverage-clover', cloverPath], { cwd, stdio: 'inherit', env: process.env })
    return r.status ?? 1
  },
  /**
   * Прогін `infection` із JSON-логером у файл. Ненульовий exit сам по собі не
   * помилка: infection повертає його і при MSI нижче внутрішнього порогу
   * (`--min-msi`, якщо задано в конфізі проєкту) — істина у JSON-звіті.
   * @param {{cwd: string, jsonPath: string}} opts корінь проєкту, шлях звіту
   * @returns {number} exit-код
   */
  runInfection({ cwd, jsonPath }) {
    const r = spawnSync(join(cwd, 'vendor', 'bin', 'infection'), [`--logger-json=${jsonPath}`, '--no-interaction'], {
      cwd,
      stdio: 'inherit',
      env: process.env
    })
    return r.status ?? 1
  }
}

/**
 * Читає й парсить `composer.json` кореня; будь-яка проблема (відсутній
 * файл, невалідний JSON) — `null`, не помилка.
 * @param {string} cwd корінь проєкту
 * @returns {object|null} розпарсений `composer.json` або null
 */
function readComposerJson(cwd) {
  const p = join(cwd, 'composer.json')
  if (!existsSync(p)) return null
  try {
    return JSON.parse(readFileSync(p, 'utf8'))
  } catch {
    return null
  }
}

/**
 * Чи проєкт залежить від Pest (`pestphp/pest` у `require`/`require-dev`) —
 * альтернативний тестовий сигнал detect (поряд з `phpunit.xml[.dist]`).
 * @param {string} cwd корінь проєкту
 * @returns {boolean} true — Pest у залежностях
 */
function hasPestDependency(cwd) {
  const composer = readComposerJson(cwd)
  if (!composer) return false
  return Boolean(composer['require-dev']?.['pestphp/pest'] ?? composer.require?.['pestphp/pest'])
}

/**
 * Обирає тестовий бінарник для виміру покриття: Pest (якщо встановлений у
 * vendor/bin — сумісний з PHPUnit CLI-прапорами, включно з `--coverage-clover`)
 * інакше PHPUnit; жоден не встановлений → null.
 * @param {string} cwd корінь проєкту
 * @param {typeof defaultRunner} runner spawn-інʼєкція
 * @returns {{name: string, path: string}|null} обраний бінарник або null
 */
function resolveRunnerBinary(cwd, runner) {
  if (runner.hasVendorBin(cwd, 'pest')) return { name: 'pest', path: join(cwd, 'vendor', 'bin', 'pest') }
  if (runner.hasVendorBin(cwd, 'phpunit')) return { name: 'phpunit', path: join(cwd, 'vendor', 'bin', 'phpunit') }
  return null
}

/**
 * Рібейзить шлях із clover (як у `name`-атрибуті, зазвичай абсолютний) у
 * relative-до-cwd.
 * @param {string} file шлях із clover
 * @param {string} cwd корінь проєкту
 * @returns {string} шлях relative до cwd
 */
function rebaseCloverPath(file, cwd) {
  const abs = isAbsolute(file) ? file : resolve(cwd, file)
  return relative(cwd, abs)
}

/**
 * Line/function coverage через PHPUnit/Pest у тимчасовий clover.xml.
 * @param {string} cwd корінь проєкту
 * @param {{name: string, path: string}} bin обраний тестовий бінарник
 * @param {typeof defaultRunner} runner spawn-інʼєкція
 * @returns {Promise<{totals: object, perFile: Array<object>}>} totals + per-file (шляхи як у clover)
 * @throws {Error} коли бінарник завершився з помилкою
 */
async function collectClover(cwd, bin, runner) {
  const dir = await mkdtemp(join(tmpdir(), 'php-cov-'))
  const cloverPath = join(dir, 'clover.xml')
  try {
    const code = await runner.runCoverage({ cwd, binPath: bin.path, cloverPath })
    if (code !== 0) throw new Error(`php coverage: ${bin.name} exit ${code}`)
    const text = existsSync(cloverPath) ? await readFile(cloverPath, 'utf8') : ''
    return { totals: parseCloverTotals(text), perFile: parseCloverPerFile(text) }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

/**
 * Чи файл — кандидат делта-гейта PHP.
 * @param {string} rel відносний шлях
 * @returns {boolean} true — гейтиться
 */
function isGateCandidate(rel) {
  return PHP_SOURCE_RE.test(rel) && !NON_SOURCE_RE.test(rel)
}

/** CoverageProvider PHP: detect/collect/collectPerFile через PHPUnit/Pest clover + infection. */
export default {
  id: 'php',
  title: 'PHP (PHPUnit/Pest coverage + Infection mutation)',

  /**
   * Чи застосовний вимір: `composer.json` + тестовий сигнал (`phpunit.xml[.dist]`
   * або Pest у залежностях) + встановлений тестовий бінарник. Відсутній
   * бінарник — одноразовий hint у stderr і false (тихий skip виміру).
   * @param {string} cwd корінь проєкту
   * @returns {Promise<boolean>} true — провайдер активний
   */
  detect(cwd) {
    if (!existsSync(join(cwd, 'composer.json'))) return false
    const hasTestSignal =
      existsSync(join(cwd, 'phpunit.xml')) || existsSync(join(cwd, 'phpunit.xml.dist')) || hasPestDependency(cwd)
    if (!hasTestSignal) return false
    if (!resolveRunnerBinary(cwd, defaultRunner)) {
      if (!this._hinted) {
        console.error(TOOL_HINT)
        this._hinted = true
      }
      return false
    }
    return true
  },

  /**
   * Повний вимір: PHPUnit/Pest (рядки/функції) + infection (score, survived),
   * один рядок області `PHP`. Мутаційне тестування пропускається з
   * попередженням, якщо infection не встановлено (лише line coverage — та
   * сама семантика, що cargo-mutants у Rust-провайдері). Відсутність
   * тестового бінарника у vendor → graceful порожній результат (не помилка).
   * @param {string} cwd корінь проєкту
   * @param {{runner?: typeof defaultRunner}} [opts] spawn-інʼєкція
   * @returns {Promise<Array<{area: string, coverage: object, mutation: {caught: number, total: number}, survived: Array<object>}>>} рядок `PHP` або []
   */
  async collect(cwd, opts = {}) {
    if (!existsSync(join(cwd, 'composer.json'))) return []
    const runner = opts.runner ?? defaultRunner
    const bin = resolveRunnerBinary(cwd, runner)
    if (!bin) return []

    const { totals: coverage } = await collectClover(cwd, bin, runner)

    const hasInfection = runner.hasVendorBin(cwd, 'infection')
    let mutation = { caught: 0, total: 0 }
    let survived = []
    if (hasInfection) {
      const dir = await mkdtemp(join(tmpdir(), 'php-mut-'))
      const jsonPath = join(dir, 'infection.json')
      try {
        const code = await runner.runInfection({ cwd, jsonPath })
        if (!existsSync(jsonPath)) {
          throw new Error(`php coverage: infection не лишив JSON-звіт ${jsonPath} — перевір прогін (exit ${code})`)
        }
        const parsed = parseInfectionReport(JSON.parse(await readFile(jsonPath, 'utf8')))
        mutation = { caught: parsed.caught, total: parsed.total }
        survived = parsed.survived.map(group => ({ ...group, file: rebaseCloverPath(group.file, cwd) }))
      } finally {
        await rm(dir, { recursive: true, force: true })
      }
    } else {
      console.error('⚠ php coverage: infection не встановлено — лише line coverage')
    }

    if (coverage.lines.total === 0 && mutation.total === 0) return []
    return [{ area: 'PHP', coverage, mutation, survived }]
  },

  /**
   * Делта-вимір per-file line coverage змінених `.php`-файлів (без
   * мутаційного тестування): один прогін PHPUnit/Pest на весь запит,
   * фільтрація per-file clover до запитаних файлів (тестові файли й не-`.php`
   * поза гейтом).
   * @param {string} cwd корінь проєкту
   * @param {{files: string[], runner?: typeof defaultRunner}} opts змінені файли (relative до cwd) + інʼєкції
   * @returns {Promise<Array<{file: string, pct: number, linesFound: number, linesCovered: number}>>} рядки гейта
   */
  async collectPerFile(cwd, opts) {
    const wanted = new Set((opts.files ?? []).filter(f => isGateCandidate(f)))
    if (wanted.size === 0) return []
    if (!existsSync(join(cwd, 'composer.json'))) return []
    const runner = opts.runner ?? defaultRunner
    const bin = resolveRunnerBinary(cwd, runner)
    if (!bin) return []

    const { perFile } = await collectClover(cwd, bin, runner)
    const rows = []
    for (const row of perFile) {
      const rel = rebaseCloverPath(row.file, cwd)
      if (!wanted.has(rel)) continue
      rows.push({ ...row, file: rel })
    }
    return rows
  }
}
