/**
 * Реальний runner v8r проти каталогу схем `@7n/rules` — використовується ЛИШЕ
 * guard-тестами каталогу (`run-v8r-catalog.test.mjs`, `run-v8r-layers-config.test.mjs`),
 * НЕ detector-ом `text/run-v8r` (той портовано в native, `crates/rules-core/src/concerns/
 * text_run_v8r.rs` — читай доккомент модуля там: чому `lint(ctx)` більше не в JS, і чому
 * саме ЦІ функції лишились тут).
 *
 * Це майже дослівна копія колишнього `npm/rules/text/run-v8r/main.mjs` МІНУС `lint(ctx)`
 * і CLI-entrypoint (`isRunAsCli`-блок) — уся інша логіка (резолв каталогу схем, генерація
 * тимчасового v8r-конфігу, класифікація виводу) лишається живою, бо два guard-тести
 * реально спавнять `bunx v8r` проти `npm/schemas/v8r-catalog.json`, щоб перевірити
 * цілісність самого каталогу (внутрішні $ref, валідні локальні шляхи, коректну
 * поведінку на реальних фікстурах) — це не покриття detector-а, а покриття ДАНИХ
 * (схем), тож дублювання цієї логіки в Rust заради двох JS-тестів не виправдане.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, delimiter, dirname, isAbsolute, join } from 'node:path'
import { env } from 'node:process'
import { fileURLToPath } from 'node:url'

import { resolveCmd } from '../../../scripts/utils/resolve-cmd.mjs'
import { spawnAsync } from '../../../scripts/utils/spawn-async.mjs'

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
 * Рядок ajv-помилки компіляції самої схеми (не документа) — див. пояснення в git-історії
 * колишнього `run-v8r/main.mjs` (ajv `unicodeRegExp` проти legacy over-escaped regex у
 * реальних опублікованих схемах, напр. `azure-pipelines-vscode/service-schema.json`).
 */
const AJV_SCHEMA_COMPILE_ERROR_RE = /^(?:✖ )?Invalid regular expression:.*$/mu

/** Рядок успіху v8r — `✔ <file> is valid`. */
const AJV_SUCCESS_LINE_RE = /^✔ .+ is valid$/u

/**
 * Чи складається `detail` ВИКЛЮЧНО з рядків ajv-помилки компіляції схеми (без жодної genuine
 * validation-помилки), ігноруючи `✔`-рядки успіху інших файлів того ж batch-виклику.
 * @param {string} detail рядки `✖ …` / `✔ …` з `extractFailureLines`
 * @returns {boolean} true — усі непорожні не-`✔` рядки `detail` є ajv schema-compile-помилками
 */
function isOnlyAjvSchemaCompileErrors(detail) {
  const lines = detail
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0 && !AJV_SUCCESS_LINE_RE.test(line))
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
    if (trimmed.length === 0 || AJV_SUCCESS_LINE_RE.test(trimmed)) continue
    process.stdout.write(
      `⚠ run-v8r: зовнішня схема не компілюється в ajv (не файл) — ${trimmed} Ймовірно, ajv unicodeRegExp-несумісність зі старим стилем escape у чужій схемі; помилка не рахується як порушення.\n`
    )
  }
}

/**
 * Прибирає v8r/bunx noise-рядки з об'єднаного stdout+stderr одного запуску — лишає предметну
 * деталь (`✖ …`-заголовки й ajv-причини).
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
 * Парсить stderr v8r (рядки `ℹ Processing <file>` / `ℹ Found schema in <url>`) і для кожного
 * файлу, чию схему знайдено через мережевий fallback (schemastore.org, а не наш `customCatalog`),
 * пише в stdout попередження.
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
 * @param {string[]} targets glob-и або конкретні шляхи файлів
 * @param {string} configPath шлях до `V8R_CONFIG_FILE`
 * @param {boolean} [verbose] друкувати повний raw stdout/stderr v8r при помилці; інакше — лише
 *   рядки `✖ …` без `ℹ`-шуму (Pre-warming the cache, Processing <file>, Found schema in …)
 * @returns {Promise<{ exitError: true } | { exitError: false, code: number, detail: string }>}
 *   помилка spawn або код v8r (0/98 — трактує викликач) + деталь `✖ …`-рядків.
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
