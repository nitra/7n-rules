/**
 * Тихий запуск v8r для усіх типів файлів, які підтримує v8r (json, json5, yaml, yml, toml).
 *
 * Один виклик цього скрипта з `lint-text` замість чотирьох окремих викликів v8r: під капотом для
 * кожного glob окремий `bunx v8r`, бо v8r у одному процесі падає з кодом 98, якщо хоч один із
 * переданих глобів не знаходить файлів — тоді решта розширень не перевіряються.
 *
 * Каталог схем `@nitra/cursor` (`v8r-catalog.json` у каталозі `schemas` пакета) вказує локальні
 * (не-http) схеми як шляхи ВІДНОСНО `npm/schemas/` (наприклад `"n-cursor.json"`,
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
 * Якщо код виходу 0 або 98 (успіх або порожній glob), вивід v8r не показується; інакше
 * вивід друкується, процес завершується з тим самим кодом, що й перший невдалий v8r.
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
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { isRunAsCli } from '../../../scripts/cli-entry.mjs'
import { resolveCmd } from '../../../scripts/utils/resolve-cmd.mjs'
import { createViolationReporter } from '../../../scripts/lib/lint-surface/violation-reporter.mjs'

/** Розширення, які валідує v8r — фільтр delta-списку файлів у `lint(ctx)`. */
const V8R_EXT_RE = /\.(?:json|json5|ya?ml|toml)$/iu

/** Типові glob-и для форматів, які обробляє v8r (див. опис CLI v8r). */
export const DEFAULT_V8R_GLOBS = ['**/*.json', '**/*.json5', '**/*.yml', '**/*.yaml', '**/*.toml']

/** Абсолютний шлях до `schemas/v8r-catalog.json` у корені пакета `@nitra/cursor` (`npm/schemas/`). */
export const V8R_CATALOG_PATH = join(dirname(fileURLToPath(import.meta.url)), '../../../schemas/v8r-catalog.json')

/** Шлях до тимчасового v8r-конфіг-файлу з `customCatalog` — генерується щоразу перед запуском. */
export const RESOLVED_V8R_CONFIG_PATH = join(tmpdir(), 'n-cursor-v8r-config.resolved.json')

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
 * процесу й від того, чи це repo-dev копія, чи встановлена в `node_modules/@nitra/cursor`).
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
        `⚠ run-v8r: ${currentFile} — схему знайдено через мережевий fallback (${remoteMatch[1]}), а не в локальному каталозі @nitra/cursor. Додай схему в npm/schemas/v8r-catalog.json (+ npm/schemas/vendor/ за потреби), щоб прогін лишався офлайн.\n`
      )
    }
  }
}

/**
 * Один виклик `bun x v8r <targets...>` з підготовленим `customCatalog`-конфігом.
 * @param {string[]} targets glob-и або конкретні шляхи файлів
 * @param {string} configPath шлях до `V8R_CONFIG_FILE`
 * @returns {{ exitError: true } | { exitError: false, code: number }} помилка spawn або код v8r (0/98 — трактує викликач)
 */
function runOneV8rInvocation(targets, configPath) {
  const bunPath = resolveCmd('bun') ?? process.execPath
  const result = spawnSync(bunPath, ['x', 'v8r', ...targets], {
    encoding: 'utf8',
    maxBuffer: 50 * 1024 * 1024,
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, V8R_CONFIG_FILE: configPath }
  })

  if (result.error) {
    process.stderr.write(`${result.error.message}\n`)
    return { exitError: true }
  }

  warnAboutRemoteSchemaFallback(result.stderr ?? '')

  const exitCode = result.status ?? 1
  if (exitCode !== 0 && exitCode !== 98) {
    if (result.stdout?.length) process.stdout.write(result.stdout)
    if (result.stderr?.length) process.stderr.write(result.stderr)
  }
  return { exitError: false, code: exitCode }
}

/**
 * Запускає послідовні виклики v8r по glob-ам (full-режим); не змінює process.exitCode.
 * Один виклик на glob навмисно (не batch) — v8r падає з кодом 98, якщо хоч один переданий
 * glob не знаходить файлів, і тоді решта розширень не перевіряються в тому ж виклику.
 * @param {string[]} [globs] патерни; за замовчуванням DEFAULT_V8R_GLOBS
 * @returns {number} 0 — OK, 1 — помилка spawn, 2 — немає каталогу схем, інше — код v8r
 */
export function runV8rWithGlobs(globs = DEFAULT_V8R_GLOBS) {
  if (!existsSync(V8R_CATALOG_PATH)) {
    process.stderr.write(
      `run-v8r: не знайдено каталог схем за шляхом ${V8R_CATALOG_PATH} (очікується npm/schemas/v8r-catalog.json у пакеті)\n`
    )
    return 2
  }

  const configPath = writeResolvedV8rConfig()

  for (const pattern of globs) {
    const r = runOneV8rInvocation([pattern], configPath)
    if (r.exitError) return 1
    if (r.code !== 0 && r.code !== 98) return r.code
  }
  return 0
}

/**
 * Запускає v8r по конкретному списку файлів (delta-режим) — один виклик, не по одному glob-у,
 * бо кожен переданий шлях уже існує (не glob), тож код 98 "порожній glob" тут не виникає.
 * @param {string[]} files абсолютні або відносні до cwd v8r-процесу шляхи файлів
 * @returns {number} 0 — OK, 1 — помилка spawn, 2 — немає каталогу схем, інше — код v8r
 */
export function runV8rWithFiles(files) {
  if (files.length === 0) return 0
  if (!existsSync(V8R_CATALOG_PATH)) {
    process.stderr.write(
      `run-v8r: не знайдено каталог схем за шляхом ${V8R_CATALOG_PATH} (очікується npm/schemas/v8r-catalog.json у пакеті)\n`
    )
    return 2
  }

  const configPath = writeResolvedV8rConfig()
  const r = runOneV8rInvocation(files, configPath)
  if (r.exitError) return 1
  return r.code === 98 ? 0 : r.code
}

/**
 * Detector text/run-v8r: read-only v8r по `ctx.files` (delta) або за дефолтними glob-ами (full).
 * @param {import('../../../scripts/lib/lint-surface/types.mjs').LintContext} ctx контекст lint-прогону
 * @returns {import('../../../scripts/lib/lint-surface/types.mjs').LintResult} результат detector-а
 */
export function lint(ctx) {
  const reporter = createViolationReporter(ctx)
  const { fail } = reporter

  if (ctx.files === undefined) {
    const code = runV8rWithGlobs()
    if (code !== 0) fail('v8r schema-валідація json/yaml/toml не пройшла (text.mdc)', 'v8r')
    return reporter.result()
  }

  const files = ctx.files.filter(f => V8R_EXT_RE.test(f))
  if (files.length === 0) return reporter.result()
  const code = runV8rWithFiles(files)
  if (code !== 0) fail('v8r schema-валідація json/yaml/toml не пройшла (text.mdc)', 'v8r')
  return reporter.result()
}

if (isRunAsCli(import.meta.url)) {
  const globs = process.argv.length > 2 ? process.argv.slice(2) : DEFAULT_V8R_GLOBS
  process.exitCode = runV8rWithGlobs(globs)
}
