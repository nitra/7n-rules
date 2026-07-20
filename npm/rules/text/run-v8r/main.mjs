/**
 * Тихий запуск v8r для усіх типів файлів, які підтримує v8r (json, json5, yaml, yml, toml).
 *
 * Один виклик цього скрипта з `lint-text` замість чотирьох окремих викликів v8r: під капотом для
 * кожного glob окремий `bunx v8r`, бо v8r у одному процесі падає з кодом 98, якщо хоч один із
 * переданих глобів не знаходить файлів — тоді решта розширень не перевіряються.
 *
 * Каталог схем `@7n/rules` (`v8r-catalog.json` у каталозі `schemas` пакета) вказує локальні
 * (не-http) схеми як шляхи ВІДНОСНО `npm/schemas/` (наприклад `"n-rules.json"`,
 * `"vendor/tsconfig.json"`) — так каталог лишається портативним у репозиторії. Ці схеми вендорені
 * в `npm/schemas/` (власні) і `npm/schemas/vendor/` (сторонні: package.json, tsconfig, oxlintrc,
 * cspell тощо) — v8r ніколи не фетчить їх по мережі. Вендоровані схеми мають бути self-contained:
 * усі `$ref` — внутрішні (`#…`), бо зовнішні v8r резолвить через `got` (лише http/https) відносно
 * `$id` схеми, тобто мережею на кожен прогін; зовнішні залежності інлайняться при вендорингу
 * (наприклад, у `vendor/package.json` вкладено eslintrc/prettierrc/ava/… як
 * `definitions.vendored-<name>`). Інваріант — під guard-тестом у
 * `npm/rules/text/tests/run-v8r-catalog.test.mjs`.
 *
 * Передаємо каталог у v8r НЕ через `-c` (файловий шлях), а через `customCatalog` у тимчасовому
 * v8r-конфіг-файлі (`V8R_CONFIG_FILE`): `-c` змушує v8r на кожен файл валідувати сам каталог проти
 * schema-catalog.json мета-схеми, яка вимагає `format: "uri"` для `url` — абсолютний локальний шлях
 * (потрібен, бо v8r резолвить `url` відносно CWD процесу, не каталогу) цій вимозі не відповідає,
 * а `file://`-URI задовольнив би формат, але v8r фетчить `url` через `got` (лише http/https, без
 * підтримки `file:`) — глухий кут. `customCatalog` (ключ `location`, не `url`) не має format:uri
 * обмеження і геть пропускає цю мета-валідацію (v8r код: `if (!rec.catalog) {...validate...}` —
 * для `customCatalog` `rec.catalog` завжди truthy).
 *
 * Опційно можна передати власні glob-и як аргументи; якщо їх немає — типові для `.json`, `.json5`,
 * `.yml`, `.yaml`, `.toml` у дереві проєкту.
 *
 * Якщо код виходу 0 або 98 (успіх або порожній glob), вивід v8r не показується; інакше без
 * `--verbose` друкуються лише рядки `✖ …` (конкретні помилки валідації), а `ℹ`-шум v8r
 * (Pre-warming the cache, Processing <file>, Found schema in …, Validating … / ✔ … is valid)
 * гейтується за `--verbose` — той самий підхід, що й для інших зовнішніх тулів лінт-конвеєра
 * (zizmor/cspell/knip/kubeconform тощо, fix(lint) #42). Процес завершується з тим самим кодом,
 * що й перший невдалий v8r.
 *
 * v8r завжди дописує `https://www.schemastore.org/api/json/catalog.json` останнім fallback-
 * каталогом (безумовно, без опції вимкнути) — якщо файл не збігається з нашим `customCatalog`, v8r
 * піде по мережу за ним. Мережа — передумова коректної роботи (офлайн-захисту нема), але щоб не
 * фетчити те саме на кожен прогін, конфіг задає `cacheTtl` доба замість дефолтних 600 с (v8r кешує
 * HTTP-відповіді у flat-cache в tmpdir). Fallback НЕ блокується: файл валідується, а `main.mjs`
 * парсить stderr v8r (рядки `ℹ Found schema in <url>` — цей `info`-рівень v8r друкує завжди,
 * незалежно від verbosity) і виводить у stdout окреме попередження на кожен такий файл із порадою
 * додати схему в `npm/schemas/v8r-catalog.json`.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, delimiter, dirname, isAbsolute, join } from 'node:path'
import { env } from 'node:process'
import { fileURLToPath } from 'node:url'

import { isRunAsCli } from '../../../scripts/cli-entry.mjs'
import { resolveCmd } from '../../../scripts/utils/resolve-cmd.mjs'
import { spawnAsync } from '../../../scripts/utils/spawn-async.mjs'
import { createViolationReporter } from '../../../scripts/lib/lint-surface/violation-reporter.mjs'

/** Розширення, які валідує v8r — фільтр delta-списку файлів у `lint(ctx)`. */
const V8R_EXT_RE = /\.(?:json|json5|ya?ml|toml)$/iu

/** Типові glob-и для форматів, які обробляє v8r (див. опис CLI v8r). */
export const DEFAULT_V8R_GLOBS = ['**/*.json', '**/*.json5', '**/*.yml', '**/*.yaml', '**/*.toml']

/** Абсолютний шлях до `schemas/v8r-catalog.json` у корені пакета `@7n/rules` (`npm/schemas/`). */
export const V8R_CATALOG_PATH = join(dirname(fileURLToPath(import.meta.url)), '../../../schemas/v8r-catalog.json')

/** Шлях до тимчасового v8r-конфіг-файлу з `customCatalog` — генерується щоразу перед запуском. */
export const RESOLVED_V8R_CONFIG_PATH = join(tmpdir(), 'n-rules-v8r-config.resolved.json')

const REMOTE_URL_RE = /^https?:\/\//u

/**
 * Чи є значення локальним шляхом (не http/https-адресою).
 * @param {string} url значення поля `url` у записі джерельного каталогу
 * @returns {boolean} true — локальний шлях, false — http(s)-адреса
 */
function isLocalSchemaPath(url) {
  return !REMOTE_URL_RE.test(url)
}

/**
 * Читає джерельний каталог (`V8R_CATALOG_PATH`, ключ `url`, локальні шляхи відносні до
 * `npm/schemas/`) і повертає масив схем у форматі v8r `customCatalog.schemas` (ключ `location`,
 * локальні шляхи — абсолютні, обчислені через `import.meta.url`, тож коректні незалежно від CWD
 * процесу й від того, чи це repo-dev копія, чи встановлена в `node_modules/@7n/rules`).
 * @returns {Array<{name: string, description?: string, location: string, fileMatch: string[]}>} схеми customCatalog
 */
export function resolveCustomCatalogSchemas() {
  const raw = readFileSync(V8R_CATALOG_PATH, 'utf8')
  const catalog = JSON.parse(raw)
  const schemasDir = dirname(V8R_CATALOG_PATH)
  return catalog.schemas.map(({ url, ...rest }) => ({
    ...rest,
    location: isLocalSchemaPath(url) && !isAbsolute(url) ? join(schemasDir, url) : url
  }))
}

/**
 * TTL HTTP-кешу v8r (секунди): доба замість дефолтних 600 с — fallback-фетчі schemastore-каталогу
 * для незматчених файлів і remote-схеми не тягнуться мережею на кожен прогін (flat-cache у tmpdir).
 */
export const V8R_CACHE_TTL_SECONDS = 86_400

/**
 * Матеріалізує тимчасовий v8r-конфіг (`{ cacheTtl, customCatalog: { schemas } }`) у
 * `RESOLVED_V8R_CONFIG_PATH`.
 * @returns {string} шлях до записаного файлу
 */
export function writeResolvedV8rConfig() {
  const config = { cacheTtl: V8R_CACHE_TTL_SECONDS, customCatalog: { schemas: resolveCustomCatalogSchemas() } }
  writeFileSync(RESOLVED_V8R_CONFIG_PATH, JSON.stringify(config), 'utf8')
  return RESOLVED_V8R_CONFIG_PATH
}

const PROCESSING_LINE_RE = /^ℹ Processing (.+)$/u
const FOUND_REMOTE_SCHEMA_RE = /^ℹ Found schema in (https?:\/\/\S+)/u
const NOISE_LINE_RE = /^(?:ℹ .*|Resolving dependencies|Resolved, downloaded and extracted.*|Saved lockfile)$/u

/**
 * Рядок ajv-помилки компіляції самої схеми (не документа). v8r ловить це в `try/catch` навколо
 * `ajv.compileAsync(schema)` (`validateDocument` у v8r/src/cli.js) і друкує голий
 * `SyntaxError.message` без файлового контексту чи "is invalid"-заголовка — на відміну від
 * genuine validation-помилки, де ajv повертає `errors[]` з прив'язкою до документа. Найчастіша
 * причина: ajv за замовчуванням компілює `pattern` з прапорцем `/u` (`unicodeRegExp: true`), а
 * реальні опубліковані схеми (напр. офіційна `azure-pipelines-vscode/service-schema.json`) містять
 * legacy over-escaped regex, валідний поза Unicode-режимом, але `SyntaxError` у ньому. Це несправна
 * схема, а не невалідний файл користувача — v8r не дає способу це відрізнити нативно (немає опції
 * `unicodeRegExp` у config-schema.json), тому розрізняємо тут за форматом самого повідомлення.
 * `logger.error` у v8r (src/logger.js) додає префікс `✖ ` перед `e.message` — опційний у regex,
 * бо `extractFailureLines` не чіпає цей префікс (лише прибирає `ℹ`-шум).
 */
const AJV_SCHEMA_COMPILE_ERROR_RE = /^(?:✖ )?Invalid regular expression:.*$/mu

/**
 * Чи складається `detail` ВИКЛЮЧНО з рядків ajv-помилки компіляції схеми (без жодної genuine
 * validation-помилки). Навмисно консервативно: якщо серед рядків `detail` є хоч один, що НЕ
 * збігається з `AJV_SCHEMA_COMPILE_ERROR_RE` (напр. "file.yml is invalid" чи ajv `errors[]`-деталь
 * genuine порушення в тому ж batch-виклику v8r по glob-у) — не втручаємось, викликач лишає
 * оригінальний `code`/`detail` без змін, щоб не замаскувати реальну проблему.
 * @param {string} detail рядки `✖ …` з `extractFailureLines`
 * @returns {boolean} true — усі непорожні рядки `detail` є ajv schema-compile-помилками
 */
function isOnlyAjvSchemaCompileErrors(detail) {
  const lines = detail
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0)
  if (lines.length === 0) return false
  return lines.every(line => AJV_SCHEMA_COMPILE_ERROR_RE.test(line))
}

/**
 * Друкує інформаційне попередження (не violation) для кожного `detail`-рядка ajv schema-compile-
 * помилки — пояснює, що причина у несправній зовнішній схемі, не в нашому файлі.
 * @param {string} detail рядки `✖ …`, для яких `isOnlyAjvSchemaCompileErrors` вже повернув true
 * @returns {void}
 */
function reportAjvSchemaCompileFailures(detail) {
  for (const line of detail.split('\n')) {
    const trimmed = line.trim()
    if (trimmed.length === 0) continue
    process.stdout.write(
      `⚠ run-v8r: зовнішня схема не компілюється в ajv (не файл) — ${trimmed} Ймовірно, ajv unicodeRegExp-несумісність зі старим стилем escape у чужій схемі; помилка не рахується як порушення.\n`
    )
  }
}

/**
 * Прибирає v8r/bunx noise-рядки (весь `ℹ`-статус: Loaded config file, Patterns and relative
 * paths, Pre-warming the cache, Processing <file>, Found schema in …, Validating …; і службовий
 * вивід bunx-встановлення Resolving/Resolved/Saved lockfile) з об'єднаного stdout+stderr одного
 * запуску —
 * лишає предметну деталь (`✖ …`-заголовки й ajv-причини на кшталт "must NOT have additional
 * properties…"). Обидва потоки об'єднуються НАВМИСНО: v8r непослідовно розкидає ці рядки між
 * stdout/stderr залежно від типу помилки — при порушенні схеми ajv-причина йде у stdout, а
 * `✖ … is invalid`-заголовок у stderr; при "не знайдено схему" все йде у stderr, stdout
 * порожній. Фільтр лише за stdout (як раніше) на другому випадку повертав би зовсім порожню
 * деталь — і LLM fix-worker (як і non-verbose CLI-підсумок) не бачив би жодної причини провалу.
 * @param {string} combinedText stdout + '\n' + stderr одного запуску v8r
 * @returns {string} відфільтровані непорожні рядки, join('\n') (порожній рядок, якщо деталі нема)
 */
export function extractFailureLines(combinedText) {
  return combinedText
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0 && !NOISE_LINE_RE.test(line))
    .join('\n')
}

/**
 * Парсить stderr v8r (рядки `ℹ Processing <file>` / `ℹ Found schema in <url>`, які v8r друкує
 * завжди на info-рівні незалежно від verbosity) і для кожного файлу, чию схему знайдено через
 * мережевий fallback (schemastore.org, а не наш `customCatalog`), пише в stdout попередження.
 * @param {string} stderrText захоплений stderr одного запуску v8r
 * @returns {void}
 */
export function warnAboutRemoteSchemaFallback(stderrText) {
  let currentFile = null
  for (const line of stderrText.split('\n')) {
    const processingMatch = PROCESSING_LINE_RE.exec(line)
    if (processingMatch) {
      currentFile = processingMatch[1]
      continue
    }
    const remoteMatch = FOUND_REMOTE_SCHEMA_RE.exec(line)
    if (remoteMatch && currentFile) {
      process.stdout.write(
        `⚠ run-v8r: ${currentFile} — схему знайдено через мережевий fallback (${remoteMatch[1]}), а не в локальному каталозі @7n/rules. Додай схему в npm/schemas/v8r-catalog.json (+ npm/schemas/vendor/ за потреби), щоб прогін лишався офлайн.\n`
      )
    }
  }
}

/**
 * Прибирає з PATH shim-теки `bun-node-*`: їх додає `bun run --bun`, підміняючи `node` через
 * symlink на bun. `bun x v8r` поважає node-shebang і бере `node` з PATH — під shim v8r виконується bun-ом
 * і падає на непідтримуваному `node:sea`, тому дочірній v8r має бачити справжній node.
 * @param {string | undefined} pathValue значення PATH батьківського процесу
 * @returns {string | undefined} PATH без shim-тек (undefined — якщо PATH не задано)
 */
export function stripBunNodeShimDirs(pathValue) {
  if (!pathValue) return pathValue
  return pathValue
    .split(delimiter)
    .filter(entry => !basename(entry).startsWith('bun-node-'))
    .join(delimiter)
}

/**
 * Один виклик `bun x v8r <targets...>` з підготовленим `customCatalog`-конфігом.
 * `detail` (рядки `✖ …`) обчислюється завжди, незалежно від `verbose` — потрібен викликачу
 * (`lint()`) для вбудовування у violation-повідомлення, яке бачить LLM fix-worker: без нього
 * fix-ladder отримує лише "щось не пройшло" й не має шансів вгадати, що саме (спостережено —
 * усі 4 rung-и незмінно падають у timeout на v8r-порушеннях).
 * Async (не блокує event loop) — детектор може виконуватись у parallel lane `detectAll()`
 * (ADR 260716-1354).
 * @param {string[]} targets glob-и або конкретні шляхи файлів
 * @param {string} configPath шлях до `V8R_CONFIG_FILE`
 * @param {boolean} [verbose] друкувати повний raw stdout/stderr v8r при помилці; інакше — лише
 *   рядки `✖ …` без `ℹ`-шуму (Pre-warming the cache, Processing <file>, Found schema in …)
 * @returns {Promise<{ exitError: true } | { exitError: false, code: number, detail: string }>}
 *   помилка spawn або код v8r (0/98 — трактує викликач) + деталь `✖ …`-рядків. Якщо ВЕСЬ `detail`
 *   складається лише з ajv schema-compile-помилок (несправна зовнішня схема, не наш файл —
 *   `isOnlyAjvSchemaCompileErrors`) — `code` примусово 0, а причина друкується окремим `⚠`-попередженням
 *   (`reportAjvSchemaCompileFailures`), а не як `✖`-порушення; мішаний випадок (є хоч один
 *   genuine validation-рядок) лишається без змін навмисно, щоб не замаскувати реальну проблему.
 */
async function runOneV8rInvocation(targets, configPath, verbose = false) {
  const bunPath = resolveCmd('bun') ?? process.execPath
  let result
  try {
    result = await spawnAsync(bunPath, ['x', 'v8r', ...targets], {
      env: { ...env, PATH: stripBunNodeShimDirs(env.PATH), V8R_CONFIG_FILE: configPath }
    })
  } catch (error) {
    process.stderr.write(`${error.message}\n`)
    return { exitError: true }
  }

  warnAboutRemoteSchemaFallback(result.stderr ?? '')

  let exitCode = result.exitCode ?? 1
  let detail = ''
  if (exitCode !== 0 && exitCode !== 98) {
    detail = extractFailureLines(`${result.stdout ?? ''}\n${result.stderr ?? ''}`)
    const onlySchemaCompileErrors = isOnlyAjvSchemaCompileErrors(detail)
    if (verbose) {
      if (result.stdout?.length) process.stdout.write(result.stdout)
      if (result.stderr?.length) process.stderr.write(result.stderr)
    } else if (onlySchemaCompileErrors) {
      reportAjvSchemaCompileFailures(detail)
    } else if (detail.length) {
      process.stdout.write(`${detail}\n`)
    }
    if (onlySchemaCompileErrors) {
      if (verbose) reportAjvSchemaCompileFailures(detail)
      exitCode = 0
      detail = ''
    }
  }
  return { exitError: false, code: exitCode, detail }
}

/**
 * Запускає послідовні виклики v8r по glob-ам (full-режим); не змінює process.exitCode.
 * Один виклик на glob навмисно (не batch) — v8r падає з кодом 98, якщо хоч один переданий
 * glob не знаходить файлів, і тоді решта розширень не перевіряються в тому ж виклику.
 * Async (не блокує event loop) — детектор може виконуватись у parallel lane `detectAll()`
 * (ADR 260716-1354). Виклики по glob-ам лишаються строго послідовними (не Promise.all) — той
 * самий один-виклик-на-glob підхід, лише блокуючий spawnSync замінено на await у циклі.
 * @param {string[]} [globs] патерни; за замовчуванням DEFAULT_V8R_GLOBS
 * @param {boolean} [verbose] друкувати повний raw вивід v8r при помилці (див. runOneV8rInvocation)
 * @returns {Promise<{ code: number, detail: string }>} `code`: 0 — OK, 1 — помилка spawn, 2 — немає
 *   каталогу схем, інше — код v8r; `detail` — рядки `✖ …` (порожньо, якщо `code` не про валідацію)
 */
export async function runV8rWithGlobs(globs = DEFAULT_V8R_GLOBS, verbose = false) {
  if (!existsSync(V8R_CATALOG_PATH)) {
    process.stderr.write(
      `run-v8r: не знайдено каталог схем за шляхом ${V8R_CATALOG_PATH} (очікується npm/schemas/v8r-catalog.json у пакеті)\n`
    )
    return { code: 2, detail: '' }
  }

  const configPath = writeResolvedV8rConfig()

  for (const pattern of globs) {
    const r = await runOneV8rInvocation([pattern], configPath, verbose)
    if (r.exitError) return { code: 1, detail: '' }
    if (r.code !== 0 && r.code !== 98) return { code: r.code, detail: r.detail }
  }
  return { code: 0, detail: '' }
}

/**
 * Запускає v8r по конкретному списку файлів (delta-режим) — один виклик, не по одному glob-у,
 * бо кожен переданий шлях уже існує (не glob), тож код 98 "порожній glob" тут не виникає.
 * Async (не блокує event loop) — детектор може виконуватись у parallel lane `detectAll()`
 * (ADR 260716-1354).
 * @param {string[]} files абсолютні або відносні до cwd v8r-процесу шляхи файлів
 * @param {boolean} [verbose] друкувати повний raw вивід v8r при помилці (див. runOneV8rInvocation)
 * @returns {Promise<{ code: number, detail: string }>} `code`: 0 — OK, 1 — помилка spawn, 2 — немає
 *   каталогу схем, інше — код v8r; `detail` — рядки `✖ …` (порожньо, якщо `code` не про валідацію)
 */
export async function runV8rWithFiles(files, verbose = false) {
  if (files.length === 0) return { code: 0, detail: '' }
  if (!existsSync(V8R_CATALOG_PATH)) {
    process.stderr.write(
      `run-v8r: не знайдено каталог схем за шляхом ${V8R_CATALOG_PATH} (очікується npm/schemas/v8r-catalog.json у пакеті)\n`
    )
    return { code: 2, detail: '' }
  }

  const configPath = writeResolvedV8rConfig()
  const r = await runOneV8rInvocation(files, configPath, verbose)
  if (r.exitError) return { code: 1, detail: '' }
  return { code: r.code === 98 ? 0 : r.code, detail: r.detail }
}

/**
 * Будує violation-повідомлення з опційною деталлю `✖ …`-рядків v8r — без неї LLM fix-worker
 * бачить лише "щось не пройшло" й не має інформації, який файл/поле саме порушує схему.
 * @param {string} detail рядки `✖ …` з `runV8rWithGlobs`/`runV8rWithFiles` (може бути порожнім)
 * @returns {string} повне повідомлення для `fail()`
 */
function v8rFailMessage(detail) {
  const base = 'v8r schema-валідація json/yaml/toml не пройшла (text.mdc)'
  return detail ? `${base}:\n${detail}` : base
}

/**
 * Detector text/run-v8r: read-only v8r по `ctx.files` (delta) або за дефолтними glob-ами (full).
 * @param {import('../../../scripts/lib/lint-surface/types.mjs').LintContext} ctx контекст lint-прогону
 * @returns {Promise<import('../../../scripts/lib/lint-surface/types.mjs').LintResult>} результат detector-а
 */
export async function lint(ctx) {
  const reporter = createViolationReporter(ctx)
  const { fail } = reporter

  const verbose = ctx.verbose === true

  if (ctx.files === undefined) {
    const { code, detail } = await runV8rWithGlobs(DEFAULT_V8R_GLOBS, verbose)
    if (code !== 0) fail(v8rFailMessage(detail), 'v8r')
    return reporter.result()
  }

  const files = ctx.files.filter(f => V8R_EXT_RE.test(f))
  if (files.length === 0) return reporter.result()
  const { code, detail } = await runV8rWithFiles(files, verbose)
  if (code !== 0) fail(v8rFailMessage(detail), 'v8r')
  return reporter.result()
}

if (isRunAsCli(import.meta.url)) {
  const globs = process.argv.length > 2 ? process.argv.slice(2) : DEFAULT_V8R_GLOBS
  const { code } = await runV8rWithGlobs(globs)
  process.exitCode = code
}
