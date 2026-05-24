/**
 * Перевірка кластерного DNS у abie env-файлах (`*.dev.env`, `*.ua.env`).
 *
 * abie живе у двох GKE-кластерах (`abie-dev.internal`, `abie-ua.internal`); внутрішньокластерні
 * URL у env-файлі мусять відповідати кластеру за іменем файла. `validateAbieEnvInternalUrls`
 * сканує всі URL виду `http://<svc>.<ns>.svc.<dns>` і вимагає коректний `<dns>` + namespace-префікс.
 * Файл `.env` без імені (локальний для розробника) виключено.
 */
import { basename } from 'node:path'

import { walkDir } from '../../../scripts/utils/walkDir.mjs'

const ABIE_ENV_FILE_BASENAME_RE = /^\.?(dev|ua)\.env$/u

const ABIE_INTERNAL_URL_GLOBAL_RE =
  /\bhttp:\/\/([a-z0-9][a-z0-9-]*)\.([a-z0-9][a-z0-9-]*)\.svc\.([a-z0-9][a-z0-9-]*\.internal)(?::\d+)?(?:\/[^\s"'`]*)?/giu

const ABIE_ENV_CLUSTER_DNS_MAP = Object.freeze({
  dev: Object.freeze({ clusterDns: 'abie-dev.internal', namespacePrefix: 'dev-' }),
  ua: Object.freeze({ clusterDns: 'abie-ua.internal', namespacePrefix: 'ua-' })
})

/**
 * Дістає `dev` / `ua` з basename env-файлу abie.
 * Не-abie env-файли (`production.env`, `.env` без імені) → null.
 * @param {string} basenameOfEnvFile опис.
 * @returns {('dev' | 'ua') | null} результат
 */
export function abieEnvNameFromBasename(basenameOfEnvFile) {
  const m = basenameOfEnvFile.match(ABIE_ENV_FILE_BASENAME_RE)
  return m ? /** @type {'dev' | 'ua'} */ (m[1]) : null
}

/**
 * Сканує вміст env-файла, повертає помилки невідповідності кластерного DNS / namespace
 * для кожного internal URL (один URL у двох змінних = дві окремі помилки).
 * @param {string} content вміст env-файла (UTF-8)
 * @param {'dev' | 'ua'} envName опис.
 * @returns {string[]} порожній масив, якщо все OK
 */
export function validateAbieEnvInternalUrls(content, envName) {
  const expected = ABIE_ENV_CLUSTER_DNS_MAP[envName]
  if (!expected) return []
  /** @type {string[]} */
  const errors = []
  for (const match of content.matchAll(ABIE_INTERNAL_URL_GLOBAL_RE)) {
    const [fullUrl, , namespace, clusterDns] = match
    if (clusterDns !== expected.clusterDns) {
      errors.push(
        `${fullUrl}: кластерний DNS "${clusterDns}" не відповідає env "${envName}" (очікується "${expected.clusterDns}")`
      )
    }
    if (!namespace.startsWith(expected.namespacePrefix)) {
      errors.push(
        `${fullUrl}: namespace "${namespace}" не починається з "${expected.namespacePrefix}" (env "${envName}")`
      )
    }
  }
  return errors
}

/**
 * Збирає `*.env` файли, які є abie env (`dev.env`/`ua.env`, опц. з провідною крапкою).
 * @param {string} root корінь репозиторію
 * @param {string[]} ignorePaths абсолютні шляхи каталогів-виключень
 * @returns {Promise<string[]>} результат
 */
export async function collectAbieEnvFiles(root, ignorePaths) {
  /** @type {string[]} */
  const out = []
  await walkDir(
    root,
    absPath => {
      if (abieEnvNameFromBasename(basename(absPath)) !== null) {
        out.push(absPath)
      }
    },
    ignorePaths
  )
  return out.toSorted((a, b) => a.localeCompare(b))
}
