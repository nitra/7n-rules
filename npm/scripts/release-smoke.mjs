/**
 * Release-smoke: black-box перевірка ОПУБЛІКОВАНОГО npm-набору `@7n/rules` після кожного
 * релізу — «набір ПРАЦЮЄ з registry для споживача», а не «npm publish відпрацював».
 *
 * Мотивація (двічі вистрелило в проді): (1) `@7n/rules-lang-php` тегнувся в git, але не
 * опублікувався в registry — `npm-publish` job був зелений (`continue-on-error` на publish-кроках,
 * spec npm-publish.yml), споживач отримував 404 при auto-install; (2) `KNOWN_PLUGIN_RANGES`
 * (`resolve-plugins.mjs`) вказували на legacy-лінії плагінів — новий core ставив старий
 * сумісний-за-API, але вже неактуальний minor. Жоден existing CI-крок цього не ловить: `npm
 * publish` перевіряє лише «команда відпрацювала», `bun run test` ганяє проти workspace
 * symlinks (той самий інсталяційний код завжди бачить локальні пакети, а не registry).
 *
 * Дві фікстури — чисті tmp-проєкти з РЕАЛЬНИМ bun add -d `@7n/rules@latest` (реєстрова
 * інсталяція, без workspace:/file: посилань):
 *   - Фікстура A (JS + PHP + GitHub): composer.json присутній → auto-install
 *     `@7n/rules-lang-php`/`@7n/rules-lang-js`/`@7n/rules-ci-github`, `.n-rules.json` містить
 *     `php`+`ci_artifact`, `lint ci_artifact` матеріалізує `.github/workflows/lint-php.yml`
 *     байт-ідентичним canonical template з `node_modules/@7n/rules-lang-php`, `lint php --no-fix`
 *     не падає непередбачено.
 *   - Фікстура B (без composer.json): PHP-плагін і будь-які php-згадки відсутні.
 *
 * Плюс версійна звірка реєстру: для кожного пакета з `KNOWN_PLUGIN_RANGES` встановленого core
 * (читаємо з `node_modules/@7n/rules` фікстури, НЕ з робочого дерева монорепо — застарілий
 * checkout не має бачити свіжий registry як зелений) published `dist-tags.latest` має
 * задовольняти range; сам core (`@7n/rules`) має мати доступний `dist-tags.latest`.
 *
 * Запуск (CI, після `npm-publish`, або вручну): `node npm/scripts/release-smoke.mjs`. Мережевий
 * прогін проти живого registry — навмисно НЕ частина `bun run test` (те саме розділення, що
 * `smoke-check-imports.mjs`), лише окремий workflow `release-smoke.yml` і ручний e2e-прогін
 * `npm/scripts/tests/release-smoke.test.mjs` (`N_RELEASE_SMOKE_E2E=1`).
 */
import { execFile, spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { promisify } from 'node:util'
import { pathToFileURL } from 'node:url'

import { isRunAsCli } from './cli-entry.mjs'

const execFileAsync = promisify(execFile)

/** Таймаут одного мережевого/CLI кроку (мс). */
export const STEP_TIMEOUT_MS = 180_000
/** Кількість повторів bun add -d `@7n/rules@latest` (registry-пропагація щойно опублікованого пакета). */
export const BUN_ADD_RETRIES = 2
/** Пауза між повторами `bun add` (мс). */
export const BUN_ADD_RETRY_DELAY_MS = 5000

/**
 * Створює тимчасову директорію, передає її абсолютний шлях у `fn`, потім видаляє (з ретраями —
 * `bun add`/`npx n-rules` можуть лишити короткочасно відкриті файли). Локальна копія
 * `withTmpDir` (`utils/test-helpers.mjs`): той модуль виключено з `files` пакету
 * (`!**​/test-helpers.mjs`), а цей скрипт публікується разом зі `scripts/**`.
 * @param {(dir: string) => void | Promise<void>} fn викликається з абсолютним шляхом до тимчасової директорії
 * @returns {Promise<void>}
 */
async function withTmpDir(fn) {
  const dir = await mkdtemp(join(tmpdir(), 'n-rules-release-smoke-'))
  try {
    await fn(dir)
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  }
}

/** @typedef {(cmd: string, args: string[], opts?: object) => { status: number|null, stdout: string, stderr: string, error?: Error }} SpawnFn */

/**
 * `spawnSync`-обгортка з дефолтним таймаутом/кодуванням (інжектовний `spawnFn` у тестах).
 * @type {SpawnFn}
 */
function defaultSpawn(cmd, args, opts = {}) {
  return spawnSync(cmd, args, { encoding: 'utf8', shell: false, timeout: STEP_TIMEOUT_MS, ...opts })
}

/**
 * `npm view <pkg> dist-tags.latest` — опублікована latest-версія пакета.
 * @param {string} pkg npm-ім'я пакета
 * @returns {Promise<string | null>} версія або `null`, якщо пакет не резолвиться (404, мережа)
 */
export async function defaultNpmViewLatest(pkg) {
  try {
    const { stdout } = await execFileAsync('npm', ['view', pkg, 'dist-tags.latest'], { timeout: STEP_TIMEOUT_MS })
    const v = stdout.trim()
    return v.length > 0 ? v : null
  } catch {
    return null
  }
}

const CARET_RANGE_RE = /^\^(\d+)(?:\.(\d+))?$/u
const SEMVER_CORE_RE = /^(\d+)\.(\d+)\.(\d+)/u

/**
 * Чи задовольняє опублікована версія caret-range з `KNOWN_PLUGIN_RANGES` (`^N` — весь major
 * `N`; `^0.N` — увесь `0.N.x`, npm-семантика caret для `0.x`-ліній). Формат ranges у таблиці
 * навмисно обмежений цими двома формами (див. коментар `resolve-plugins.mjs`), тож повний
 * semver-range-парсер тут не потрібен.
 * @param {string} version опублікована версія (напр. `0.25.1`)
 * @param {string} range caret-range (напр. `^0.23`)
 * @returns {boolean} true — версія в межах range
 */
export function satisfiesKnownRange(version, range) {
  const rangeMatch = CARET_RANGE_RE.exec(range)
  const versionMatch = SEMVER_CORE_RE.exec(version)
  if (!rangeMatch || !versionMatch) return false
  const [, rMajor, rMinor] = rangeMatch
  const [, vMajor, vMinor] = versionMatch
  if (rMinor === undefined) return Number(vMajor) === Number(rMajor)
  return Number(vMajor) === Number(rMajor) && Number(vMinor) === Number(rMinor)
}

/**
 * `bun add -d <spec>` з ретраями (registry ще не встиг реплікувати щойно опублікований пакет).
 * @param {string} cwd робоча директорія (tmp-фікстура)
 * @param {string} spec npm-specifier (`@7n/rules\@latest`)
 * @param {{ spawnFn?: SpawnFn, retries?: number, delayMs?: number }} [options] інжекція для тестів
 * @returns {Promise<{ ok: boolean, detail?: string }>} результат установки
 */
export async function bunAddWithRetry(cwd, spec, options = {}) {
  const { spawnFn = defaultSpawn, retries = BUN_ADD_RETRIES, delayMs = BUN_ADD_RETRY_DELAY_MS } = options
  let lastDetail = ''
  for (let attempt = 0; attempt <= retries; attempt++) {
    const r = spawnFn('bun', ['add', '-d', spec], { cwd })
    if (!r.error && r.status === 0) return { ok: true }
    lastDetail = r.error
      ? r.error.message
      : `exit ${r.status}: ${(r.stderr || r.stdout || '').trim().split('\n', 1)[0]}`
    if (attempt < retries) await sleep(delayMs)
  }
  return { ok: false, detail: `bun add -d ${spec} — ${lastDetail}` }
}

/**
 * Мінімальний валідний GitHub Actions workflow — файловий сигнал `ci:github` для автодетекту
 * (`detectPluginsFromRepo` у встановленому core), без претензії на проходження `lint ga`.
 */
const MINIMAL_CI_YML = `name: CI

on:
  push:
    branches:
      - main

jobs:
  noop:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
`

/**
 * Будує фікстуру A (JS + PHP + GitHub-сигнали) у `dir`: `package.json` (private,
 * `repository.url` на github.com), `composer.json` (`require.php`), мінімальний
 * `.github/workflows/ci.yml`.
 * @param {string} dir абсолютний шлях tmp-директорії
 * @returns {Promise<void>}
 */
export async function writeFixtureAFiles(dir) {
  await mkdir(join(dir, '.github', 'workflows'), { recursive: true })
  await writeFile(
    join(dir, 'package.json'),
    `${JSON.stringify(
      {
        name: 'release-smoke-fixture-a',
        version: '0.0.0',
        private: true,
        repository: { type: 'git', url: 'https://github.com/nitra/release-smoke-fixture-a' }
      },
      null,
      2
    )}\n`,
    'utf8'
  )
  await writeFile(
    join(dir, 'composer.json'),
    `${JSON.stringify({ name: 'nitra/release-smoke-fixture-a', require: { php: '>=8.1' } }, null, 2)}\n`,
    'utf8'
  )
  await writeFile(join(dir, '.github', 'workflows', 'ci.yml'), MINIMAL_CI_YML, 'utf8')
}

/**
 * Будує фікстуру B (JS + GitHub, БЕЗ composer.json) у `dir` — контроль негативного шляху:
 * без файлового PHP-сигналу плагін і будь-які php-згадки не мають з'явитись.
 * @param {string} dir абсолютний шлях tmp-директорії
 * @returns {Promise<void>}
 */
export async function writeFixtureBFiles(dir) {
  await mkdir(join(dir, '.github', 'workflows'), { recursive: true })
  await writeFile(
    join(dir, 'package.json'),
    `${JSON.stringify(
      {
        name: 'release-smoke-fixture-b',
        version: '0.0.0',
        private: true,
        repository: { type: 'git', url: 'https://github.com/nitra/release-smoke-fixture-b' }
      },
      null,
      2
    )}\n`,
    'utf8'
  )
  await writeFile(join(dir, '.github', 'workflows', 'ci.yml'), MINIMAL_CI_YML, 'utf8')
}

/**
 * `KNOWN_PLUGIN_RANGES` ВСТАНОВЛЕНОГО у фікстурі core — динамічний import з
 * `node_modules/@7n/rules`, а не з робочого дерева монорепо (яке може бути застарілим щодо
 * щойно опублікованого core).
 * @param {string} fixtureDir корінь фікстури з установленим `@7n/rules`
 * @returns {Promise<Record<string, string>>} мапа npm-ім'я плагіна → caret-range
 */
export async function readInstalledKnownPluginRanges(fixtureDir) {
  const modulePath = join(fixtureDir, 'node_modules', '@7n/rules', 'scripts', 'lib', 'resolve-plugins.mjs')
  // file:// URL з абсолютного шляху tmp-фікстури (не user input) — той самий патерн, що
  // smoke-check-imports.mjs.
  // eslint-disable-next-line no-unsanitized/method
  const mod = await import(pathToFileURL(modulePath).href)
  return mod.KNOWN_PLUGIN_RANGES
}

/**
 * Один запис результату перевірки.
 * @typedef {{ name: string, ok: boolean, detail?: string }} CheckResult
 */

/**
 * Версійна звірка registry: `core` має мати доступний `dist-tags.latest`; кожен пакет із
 * `knownRanges` має published `latest`, що задовольняє свій range у ВСТАНОВЛЕНОМУ core. Ловить
 * і «тегнули, не опублікували» (latest відсутній), і «range вказує на legacy-лінію» (latest є,
 * але не в діапазоні).
 * @param {Record<string, string>} knownRanges `KNOWN_PLUGIN_RANGES` встановленого core
 * @param {{ npmViewLatest?: (pkg: string) => Promise<string | null> }} [options] інжекція для тестів
 * @returns {Promise<CheckResult[]>} результати по кожному пакету набору
 */
export async function checkVersionReconciliation(knownRanges, options = {}) {
  const { npmViewLatest = defaultNpmViewLatest } = options
  /** @type {CheckResult[]} */
  const results = []

  const coreLatest = await npmViewLatest('@7n/rules')
  results.push({
    name: 'registry: @7n/rules dist-tags.latest резолвиться',
    ok: coreLatest !== null,
    detail: coreLatest ?? 'npm view не повернув версію (не опубліковано?)'
  })

  for (const [pkg, range] of Object.entries(knownRanges)) {
    const latest = await npmViewLatest(pkg)
    if (latest === null) {
      results.push({
        name: `registry: ${pkg} опублікований`,
        ok: false,
        detail: 'dist-tags.latest відсутній (не опубліковано?)'
      })
      continue
    }
    const ok = satisfiesKnownRange(latest, range)
    results.push({
      name: `registry: ${pkg}@${latest} у межах KNOWN_PLUGIN_RANGES ${range}`,
      ok,
      detail: ok ? undefined : `latest ${latest} НЕ задовольняє ${range} — ranges розсинхронізовані з registry`
    })
  }
  return results
}

/**
 * `pkg.devDependencies[name]` фікстури.
 * @param {string} fixtureDir корінь фікстури
 * @param {string} name npm-ім'я
 * @returns {string | undefined} специфікатор версії або `undefined`
 */
function readDevDependency(fixtureDir, name) {
  const pkg = JSON.parse(readFileSync(join(fixtureDir, 'package.json'), 'utf8'))
  return pkg?.devDependencies?.[name]
}

/**
 * Перевірки Фікстури A після bun add -d `@7n/rules@latest` + `npx n-rules` (sync).
 * @param {string} dir корінь фікстури
 * @param {{ spawnFn?: SpawnFn, knownRanges?: Record<string, string> }} [options] інжекція для тестів
 * @returns {CheckResult[]} результати
 */
export function checkFixtureADevDependencies(dir, options = {}) {
  const knownRanges = options.knownRanges ?? {}
  /** @type {CheckResult[]} */
  const results = []
  for (const name of ['@7n/rules-lang-php', '@7n/rules-lang-js', '@7n/rules-ci-github']) {
    const spec = readDevDependency(dir, name)
    const present = typeof spec === 'string'
    results.push({ name: `fixture A: devDependencies має ${name}`, ok: present, detail: spec })
    if (present && knownRanges[name]) {
      results.push({
        name: `fixture A: ${name} у межах KNOWN_PLUGIN_RANGES ${knownRanges[name]}`,
        ok: spec === knownRanges[name],
        detail: spec === knownRanges[name] ? undefined : `встановлено ${spec}, очікувано ${knownRanges[name]}`
      })
    }
  }
  return results
}

/**
 * Перевірка `.n-rules.json` Фікстури A: `rules` містить `php` і `ci_artifact`.
 * @param {string} dir корінь фікстури
 * @returns {CheckResult[]} результати
 */
export function checkFixtureAConfig(dir) {
  const configPath = join(dir, '.n-rules.json')
  if (!existsSync(configPath)) {
    return [{ name: 'fixture A: .n-rules.json створено', ok: false, detail: 'файл відсутній' }]
  }
  const config = JSON.parse(readFileSync(configPath, 'utf8'))
  const rules = Array.isArray(config.rules) ? config.rules : []
  return [
    { name: 'fixture A: .n-rules.json rules містить php', ok: rules.includes('php') },
    { name: 'fixture A: .n-rules.json rules містить ci_artifact', ok: rules.includes('ci_artifact') }
  ]
}

/**
 * Перевірка `.github/workflows/lint-php.yml`, згенерованого `lint ci_artifact` — байт-ідентичний
 * canonical template з `node_modules/@7n/rules-lang-php/slots/ci/github/`.
 * @param {string} dir корінь фікстури
 * @returns {CheckResult[]} результати
 */
export function checkFixtureALintPhpYml(dir) {
  const generatedPath = join(dir, '.github', 'workflows', 'lint-php.yml')
  if (!existsSync(generatedPath)) {
    return [{ name: 'fixture A: lint ci_artifact створив lint-php.yml', ok: false, detail: 'файл відсутній' }]
  }
  const templatePath = join(
    dir,
    'node_modules',
    '@7n',
    'rules-lang-php',
    'slots',
    'ci',
    'github',
    'lint-php.yml.snippet.yml'
  )
  if (!existsSync(templatePath)) {
    return [
      { name: 'fixture A: lint ci_artifact створив lint-php.yml', ok: true },
      { name: 'fixture A: canonical template знайдено в node_modules', ok: false, detail: templatePath }
    ]
  }
  const generated = readFileSync(generatedPath, 'utf8')
  const template = readFileSync(templatePath, 'utf8')
  return [
    { name: 'fixture A: lint ci_artifact створив lint-php.yml', ok: true },
    {
      name: 'fixture A: lint-php.yml байт-ідентичний canonical template',
      ok: generated === template,
      detail:
        generated === template
          ? undefined
          : 'diff з node_modules/@7n/rules-lang-php/slots/ci/github/lint-php.yml.snippet.yml'
    }
  ]
}

/**
 * `lint php --no-fix` не має падати непередбачено (без стектрейсу необробленого винятку) — сам
 * exit code (0 при чистому composer.json, non-zero при violations) не фіксується жорстко, бо
 * залежить від composer-тулчейну CI runner-а (spec §10 Фаза 5 — задокументована поведінка, не
 * "не крашить" = "0").
 * @param {string} dir корінь фікстури
 * @param {{ spawnFn?: SpawnFn }} [options] інжекція для тестів
 * @returns {CheckResult[]} результати
 */
export function checkFixtureALintPhp(dir, options = {}) {
  const { spawnFn = defaultSpawn } = options
  const r = spawnFn('npx', ['n-rules', 'lint', 'php', '--no-fix'], { cwd: dir })
  const output = `${r.stdout || ''}${r.stderr || ''}`
  const crashed =
    Boolean(r.error) ||
    r.status === null ||
    output.includes('at file://') ||
    output.includes('UnhandledPromiseRejection')
  let detail = `exit ${r.status}`
  if (crashed) {
    detail = r.error ? r.error.message : `неочікуваний статус ${r.status}`
  }
  return [{ name: 'fixture A: lint php --no-fix завершується без креша', ok: !crashed, detail }]
}

/**
 * Перевірки Фікстури B: без composer.json PHP-плагін і будь-які php-згадки в `.n-rules.json`
 * не мають з'явитись.
 * @param {string} dir корінь фікстури
 * @returns {CheckResult[]} результати
 */
export function checkFixtureB(dir) {
  /** @type {CheckResult[]} */
  const results = []
  const phpDep = readDevDependency(dir, '@7n/rules-lang-php')
  results.push({
    name: 'fixture B: devDependencies НЕ містить @7n/rules-lang-php',
    ok: phpDep === undefined,
    detail: phpDep
  })

  const configPath = join(dir, '.n-rules.json')
  if (!existsSync(configPath)) {
    results.push({ name: 'fixture B: .n-rules.json створено', ok: false, detail: 'файл відсутній' })
    return results
  }
  const configText = readFileSync(configPath, 'utf8')
  results.push({
    name: 'fixture B: .n-rules.json без будь-яких php-згадок',
    ok: !configText.toLowerCase().includes('php'),
    detail: configText.toLowerCase().includes('php') ? configText : undefined
  })
  return results
}

/**
 * Друкує один результат (✅/❌ + деталь при провалі чи наявності).
 * @param {CheckResult} result результат перевірки
 * @returns {void}
 */
function printResult(result) {
  const icon = result.ok ? '✅' : '❌'
  const suffix = result.detail ? ` — ${result.detail}` : ''
  console.log(`${icon} ${result.name}${suffix}`)
}

/**
 * Повний прогін Фікстури A: bun add → sync → devDependencies/config/ci_artifact/php-checks.
 * @param {string} dir tmp-директорія (порожня)
 * @param {{ spawnFn?: SpawnFn, retries?: number, delayMs?: number }} [options] інжекція для тестів
 *   (`retries`/`delayMs` — прокидаються у `bunAddWithRetry`, пришвидшує тести провалу install)
 * @returns {Promise<CheckResult[]>} результати (включно з провалом установки, якщо стався)
 */
export async function runFixtureA(dir, options = {}) {
  const { spawnFn = defaultSpawn } = options
  await writeFixtureAFiles(dir)
  const gitInitResult = spawnFn('git', ['init', '-q'], { cwd: dir })
  const install = await bunAddWithRetry(dir, '@7n/rules@latest', {
    spawnFn,
    retries: options.retries,
    delayMs: options.delayMs
  })
  if (!install.ok) {
    return [{ name: 'fixture A: bun add -d @7n/rules@latest', ok: false, detail: install.detail }]
  }
  const sync = spawnFn('npx', ['n-rules'], { cwd: dir })
  if (sync.status !== 0) {
    return [
      {
        name: 'fixture A: npx n-rules (sync)',
        ok: false,
        detail: `exit ${sync.status}: ${(sync.stderr || sync.stdout || '').trim().split('\n', 1)[0]}`
      }
    ]
  }

  const knownRanges = await readInstalledKnownPluginRanges(dir)
  const results = [...checkFixtureADevDependencies(dir, { spawnFn, knownRanges }), ...checkFixtureAConfig(dir)]
  spawnFn('npx', ['n-rules', 'lint', 'ci_artifact'], { cwd: dir })
  results.push(...checkFixtureALintPhpYml(dir), ...checkFixtureALintPhp(dir, { spawnFn }), {
    name: 'fixture A: git init',
    ok: !gitInitResult.error
  })
  return { results, knownRanges }
}

/**
 * Повний прогін Фікстури B: bun add → sync → негативні перевірки (без PHP).
 * @param {string} dir tmp-директорія (порожня)
 * @param {{ spawnFn?: SpawnFn, retries?: number, delayMs?: number }} [options] інжекція для тестів
 *   (`retries`/`delayMs` — прокидаються у `bunAddWithRetry`, пришвидшує тести провалу install)
 * @returns {Promise<CheckResult[]>} результати
 */
export async function runFixtureB(dir, options = {}) {
  const { spawnFn = defaultSpawn } = options
  await writeFixtureBFiles(dir)
  spawnFn('git', ['init', '-q'], { cwd: dir })
  const install = await bunAddWithRetry(dir, '@7n/rules@latest', {
    spawnFn,
    retries: options.retries,
    delayMs: options.delayMs
  })
  if (!install.ok) {
    return [{ name: 'fixture B: bun add -d @7n/rules@latest', ok: false, detail: install.detail }]
  }
  const sync = spawnFn('npx', ['n-rules'], { cwd: dir })
  if (sync.status !== 0) {
    return [
      {
        name: 'fixture B: npx n-rules (sync)',
        ok: false,
        detail: `exit ${sync.status}: ${(sync.stderr || sync.stdout || '').trim().split('\n', 1)[0]}`
      }
    ]
  }
  return checkFixtureB(dir)
}

/**
 * Оркестрація повного release-smoke: Фікстура A (з версійною звіркою registry на її
 * встановленому core) → Фікстура B. Друкує кожен результат одразу (видимість у CI-логах
 * до завершення прогону).
 * @param {{ spawnFn?: SpawnFn, npmViewLatest?: (pkg: string) => Promise<string | null> }} [options] інжекція для тестів
 * @returns {Promise<boolean>} true — усі перевірки пройшли
 */
export async function main(options = {}) {
  /** @type {CheckResult[]} */
  const allResults = []

  await withTmpDir(async dirA => {
    const outcome = await runFixtureA(dirA, options)
    const results = Array.isArray(outcome) ? outcome : outcome.results
    for (const r of results) printResult(r)
    allResults.push(...results)

    if (!Array.isArray(outcome) && outcome.knownRanges) {
      const versionResults = await checkVersionReconciliation(outcome.knownRanges, options)
      for (const r of versionResults) printResult(r)
      allResults.push(...versionResults)
    }
  })

  await withTmpDir(async dirB => {
    const results = await runFixtureB(dirB, options)
    for (const r of results) printResult(r)
    allResults.push(...results)
  })

  const failed = allResults.filter(r => !r.ok)
  console.log(`\nrelease-smoke: ${allResults.length - failed.length}/${allResults.length} перевірок пройшло`)
  if (failed.length > 0) {
    console.error(`\n❌ ${failed.length} провал(ів) — опублікований набір НЕ узгоджений із registry/ranges`)
  } else {
    console.log('✅ release-smoke: опублікований набір узгоджений з registry')
  }
  return failed.length === 0
}

if (isRunAsCli(import.meta.url)) {
  const ok = await main()
  process.exitCode = ok ? 0 : 1
}
