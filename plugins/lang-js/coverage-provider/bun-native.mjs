/**
 * Детекція bun-native workspace-ів: prod-код імпортує `'bun'` (або `'bun:sqlite'`,
 * `'bun:ffi'` тощо — усе крім `'bun:test'`, який конвертує lint-правило
 * `test/no-bun-test-import`). vitest структурно не виконує такий код: модуль `bun`
 * існує лише всередині Bun runtime (Node ESM/vitest module-runner його не резолвить),
 * тож coverage для таких workspace-ів збирається через `bun test --coverage`
 * (Bun автоматично ремапить `import ... from 'vitest'` у тест-файлах на `bun:test`).
 */
import { readFile } from 'node:fs/promises'

import { walk } from './fs-walk.mjs'

/** import/require/dynamic-import специфікатора `bun` або `bun:*` (крім `bun:test`). */
const BUN_NATIVE_IMPORT_RE = /(?:from|import\s*\(|require\s*\()\s*(['"])bun(?::(?!test)[\w.-]+)?\1/u

/** JS/TS prod-розширення, які скануємо на bun-native імпорти. */
const JS_SOURCE_RE = /\.(c|m)?[jt]sx?$/
/** Тест-файли — не prod-код: `bun:test`/vitest-імпорти там не сигнал bun-native. */
const TEST_FILE_RE = /\.(test|spec)\.[^.]+$/
/** Тест-файли, які запускає `bun test` (для пре-скану «чи є що ганяти»). */
const RUNNABLE_TEST_RE = /\.test\.(m?js|ts)$/

/**
 * Чи workspace bun-native: хоч один prod JS/TS-файл імпортує `bun`/`bun:*` (крім `bun:test`).
 * @param {string} jsRoot абсолютний шлях workspace-кореня
 * @returns {Promise<boolean>} true для bun-native workspace
 */
export async function isBunNativeRoot(jsRoot) {
  /** @type {string[]} */
  const prodFiles = []
  await walk(jsRoot, abs => {
    if (JS_SOURCE_RE.test(abs) && !TEST_FILE_RE.test(abs)) prodFiles.push(abs)
  })
  for (const abs of prodFiles) {
    let body
    try {
      body = await readFile(abs, 'utf8')
    } catch {
      continue
    }
    if (BUN_NATIVE_IMPORT_RE.test(body)) return true
  }
  return false
}

/**
 * Чи workspace має тест-файли, які запустить `bun test` (`*.test.{js,mjs,ts}`).
 * Пре-скан перед запуском: `bun test` без тестів завершується помилкою, а нам
 * потрібен той самий graceful skip, що дає vitest `--passWithNoTests`.
 * @param {string} jsRoot абсолютний шлях workspace-кореня
 * @returns {Promise<boolean>} true, якщо є хоча б один тест-файл
 */
export async function hasRunnableTests(jsRoot) {
  let found = false
  await walk(jsRoot, abs => {
    if (RUNNABLE_TEST_RE.test(abs)) found = true
  })
  return found
}
