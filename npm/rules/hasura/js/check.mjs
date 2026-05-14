/**
 * Перевіряє правило hasura.mdc для проєктів **nitra** і **abie**: значення
 * `HASURA_GRAPHQL_ENDPOINT` у `*.env` має бути **внутрішнім** кластерним URL,
 * а не публічним доменом.
 *
 * Запускається лише якщо в кореневому `package.json` поле `repository`
 * вказує на `https://github.com/nitra/...` або `https://github.com/abinbevefes/...`
 * (інші репозиторії пропускаються без помилок — як у check-abie).
 *
 * Очікуваний формат URL — кластерний DNS-суфікс `<cluster>.internal`:
 *  - GKE / GCP: `http://<service>.<namespace>.svc.<cluster>.internal:<port>`
 *    приклад: `http://contract-h.ua-contract.svc.abie-ua.internal:8080`
 *
 * Сегменти беруться з `hasura/k8s/base/svc-hl.yaml` (`metadata.name` —
 * має закінчуватись на `-h`, headless-сервіс) і `hasura/k8s/base/namespace.yaml`
 * (`metadata.name` — namespace). Якщо ці YAML є в репозиторії, у URL додатково
 * звіряються конкретні `<service>` і `<namespace>` з ними.
 *
 * Скануються всі файли `*.env` (наприклад `dev.env`, `production.env`); файл
 * `.env` без імені — виключення з правила (локальний файл розробника), його
 * не перевіряємо. Пропускаються `node_modules`, `.git`, `dist`, `coverage`,
 * `.turbo`, `.next` (як у `walkDir`).
 */
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { basename, join, relative } from 'node:path'

import { parseAllDocuments } from 'yaml'

import { getRepositoryUrl } from '../../../scripts/auto-rules.mjs'
import { createCheckReporter } from '../../../scripts/utils/check-reporter.mjs'
import { loadCursorIgnorePaths } from '../../../scripts/utils/load-cursor-config.mjs'
import { walkDir } from '../../../scripts/utils/walkDir.mjs'

const NITRA_REPOSITORY_URL_MARKER = 'https://github.com/nitra/'
const ABIE_REPOSITORY_URL_MARKER = 'https://github.com/abinbevefes/'

const HASURA_BASE_DIR = 'hasura/k8s/base'
const HASURA_SVC_HL_FILE = `${HASURA_BASE_DIR}/svc-hl.yaml`
const HASURA_NAMESPACE_FILE = `${HASURA_BASE_DIR}/namespace.yaml`

const ENV_FILE_RE = /\.env$/u
const HASURA_ENDPOINT_LINE_RE = /^[ \t]*(?:export[ \t]+)?HASURA_GRAPHQL_ENDPOINT[ \t]*=[ \t]*['"]?([^'"\r\n#]+)/mu
// Дозволяємо лише DNS-суфікс кластера `<name>.internal` (GKE/GCP).
const INTERNAL_HASURA_URL_RE = /^http:\/\/([^./]+)\.([^./]+)\.svc\.([^./:]+\.internal):(\d+)\/?$/u
const INTERNAL_DNS_SUFFIX = '.internal'

/**
 * Розбір значення `HASURA_GRAPHQL_ENDPOINT` як внутрішнього кластерного URL.
 * Дозволяє лише `http://` (TLS усередині кластера зайвий) та DNS-суфікс
 * `<cluster>.internal` (GKE/GCP). Поле `cluster` містить ім'я кластера без
 * `.internal` (наприклад `abie-ua`).
 * @param {string} url значення з `.env` (без огорнутих лапок)
 * @returns {{ ok: true, service: string, namespace: string, cluster: string, port: string } | { ok: false }}
 *   розібрані сегменти або `{ ok: false }`, якщо формат не відповідає внутрішньому кластерному URL
 */
export function parseInternalHasuraEndpoint(url) {
  const m = url.trim().match(INTERNAL_HASURA_URL_RE)
  if (!m) {
    return { ok: false }
  }
  const suffix = m[3]
  const cluster = suffix.slice(0, -INTERNAL_DNS_SUFFIX.length)
  return { ok: true, service: m[1], namespace: m[2], cluster, port: m[4] }
}

/**
 * Зчитує `metadata.name` з першого документа YAML, який має заданий `kind`.
 * @param {string} absPath абсолютний шлях до YAML
 * @param {string} kind очікуваний `kind` (наприклад `Service`, `Namespace`)
 * @returns {Promise<string | null>} ім'я ресурсу або null, якщо файл/документ відсутній
 */
async function readYamlMetadataName(absPath, kind) {
  if (!existsSync(absPath)) {
    return null
  }
  let docs
  try {
    docs = parseAllDocuments(await readFile(absPath, 'utf8'))
  } catch {
    return null
  }
  for (const doc of docs) {
    const obj = doc.toJS()
    if (obj && typeof obj === 'object' && obj.kind === kind && obj.metadata?.name) {
      return String(obj.metadata.name)
    }
  }
  return null
}

/**
 * Чи відносний шлях вказує на `*.env`, який треба перевіряти hasura.mdc.
 * Файл рівно `.env` (без імені) — виключення з правила (локальний файл
 * розробника, hasura.mdc його не зачіпає), тому повертає false.
 * @param {string} relPath posix-шлях відносно кореня
 * @returns {boolean} true для `dev.env`, `nitra.env`; false для `.env`
 */
export function isEnvFile(relPath) {
  if (!ENV_FILE_RE.test(relPath)) {
    return false
  }
  return basename(relPath) !== '.env'
}

/**
 * Збирає всі `*.env` файли в дереві, окрім службових каталогів.
 * @param {string} root абсолютний шлях кореня
 * @param {string[]} ignorePaths абсолютні шляхи каталогів, повністю виключених з обходу
 * @returns {Promise<string[]>} відсортовані posix-шляхи відносно кореня
 */
async function collectEnvFiles(root, ignorePaths) {
  /** @type {string[]} */
  const out = []
  await walkDir(
    root,
    absPath => {
      const rel = relative(root, absPath).split('\\').join('/')
      if (isEnvFile(rel)) {
        out.push(rel)
      }
    },
    ignorePaths
  )
  return out.toSorted((a, b) => a.localeCompare(b))
}

/**
 * Перевіряє один `.env` файл на коректність `HASURA_GRAPHQL_ENDPOINT`.
 * Якщо в файлі немає змінної — вважаємо OK.
 * @param {string} relPath відносний шлях файла
 * @param {{ service: string | null, namespace: string | null }} expected очікувані сегменти з YAML
 * @param {{ pass: (msg: string) => void, fail: (msg: string) => void }} reporter репортер
 * @returns {Promise<void>}
 */
async function checkEnvFile(relPath, expected, reporter) {
  const { pass, fail } = reporter
  const content = await readFile(relPath, 'utf8')
  const m = content.match(HASURA_ENDPOINT_LINE_RE)
  if (!m) {
    return
  }
  const value = m[1].trim()
  const parsed = parseInternalHasuraEndpoint(value)
  if (!parsed.ok) {
    const example = "https://<service>.<namespace>.svc.<cluster>.internal:<port>"
    fail(
      `${relPath}: HASURA_GRAPHQL_ENDPOINT="${value}" — потрібен внутрішній кластерний URL виду ${example} (hasura.mdc)`
    )
    return
  }
  if (expected.service && parsed.service !== expected.service) {
    fail(
      `${relPath}: HASURA_GRAPHQL_ENDPOINT — сервіс "${parsed.service}" не збігається з ` +
        `metadata.name "${expected.service}" із ${HASURA_SVC_HL_FILE} (hasura.mdc)`
    )
    return
  }
  if (expected.namespace && parsed.namespace !== expected.namespace) {
    fail(
      `${relPath}: HASURA_GRAPHQL_ENDPOINT — namespace "${parsed.namespace}" не збігається з ` +
        `metadata.name "${expected.namespace}" із ${HASURA_NAMESPACE_FILE} (hasura.mdc)`
    )
    return
  }
  pass(`${relPath}: HASURA_GRAPHQL_ENDPOINT — внутрішній кластерний URL`)
}

/**
 * Зчитує URL репозиторію з кореневого `package.json` (або null, якщо файла немає / не валідний).
 * @returns {Promise<string | null>} URL з поля `repository`
 */
async function readRootRepositoryUrl() {
  if (!existsSync('package.json')) {
    return null
  }
  try {
    const pkg = JSON.parse(await readFile('package.json', 'utf8'))
    return getRepositoryUrl(pkg?.repository)
  } catch {
    return null
  }
}

/**
 * Чи URL репозиторію вказує на nitra або abie (за маркерами hasura.mdc).
 * @param {string | null} url значення з `package.json` `repository`
 * @returns {boolean} true для nitra/abie проєктів
 */
export function isNitraOrAbieRepository(url) {
  if (typeof url !== 'string') {
    return false
  }
  const lc = url.toLowerCase()
  return lc.includes(NITRA_REPOSITORY_URL_MARKER) || lc.includes(ABIE_REPOSITORY_URL_MARKER)
}

/**
 * Перевіряє hasura.mdc для поточного робочого каталогу.
 * @returns {Promise<number>} 0 — OK / правило не застосовується, 1 — порушення
 */
export async function check() {
  const reporter = createCheckReporter()
  const { pass } = reporter

  const repositoryUrl = await readRootRepositoryUrl()
  if (!isNitraOrAbieRepository(repositoryUrl)) {
    pass('Пропущено: репозиторій не nitra і не abie (hasura.mdc застосовується лише до них)')
    return reporter.getExitCode()
  }

  const root = process.cwd()
  const expected = {
    service: await readYamlMetadataName(join(root, HASURA_SVC_HL_FILE), 'Service'),
    namespace: await readYamlMetadataName(join(root, HASURA_NAMESPACE_FILE), 'Namespace')
  }

  const ignorePaths = await loadCursorIgnorePaths(root)
  const envFiles = await collectEnvFiles(root, ignorePaths)
  if (envFiles.length === 0) {
    pass('Не знайдено жодного *.env файла — нічого перевіряти')
    return reporter.getExitCode()
  }

  for (const rel of envFiles) {
    await checkEnvFile(rel, expected, reporter)
  }

  // Якщо у файлах не було жодної згадки HASURA_GRAPHQL_ENDPOINT — повідом про це.
  const exit = reporter.getExitCode()
  if (exit === 0) {
    const names = envFiles.map(p => basename(p)).join(', ')
    pass(`Перевірено ${envFiles.length} *.env файл(ів): ${names}`)
  }
  return exit
}
