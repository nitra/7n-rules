/** @see ./docs/fix-internal_urls.md */

/**
 * T0-autofix для `hasura/internal_urls` — виправляє лише детерміновані розбіжності
 * `service`/`namespace` у вже валідному внутрішньому кластерному URL проти
 * `hasura/k8s/base/{svc-hl,namespace}.yaml` (переписує сегменти, зберігаючи `cluster`/`port`
 * з наявного значення). Структурно невалідний URL (`internal-url-invalid`) — НЕ T0-фікс:
 * `cluster`/`port` нізвідки достовірно вивести, це людське рішення про інфраструктуру.
 *
 * Константи й `parseInternalHasuraEndpoint`/`computeExpectedEndpointSegments` дубльовані
 * з native-порту detector-а (`crates/rules-core/src/concerns/hasura_internal_urls.rs`),
 * не імпортуються з видаленого `main.mjs` — detector портований у Rust (I1 YAML-кластер,
 * фаза 5 батч 4 частина 2), а `main.mjs` видалений. T0-фіксер лишається JS.
 */
import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { parseAllDocuments } from 'yaml'

const HASURA_SVC_HL_FILE = 'hasura/k8s/base/svc-hl.yaml'
const HASURA_NAMESPACE_FILE = 'hasura/k8s/base/namespace.yaml'

/** Знаходить рядок присвоєння `HASURA_GRAPHQL_ENDPOINT` у env-файлі; захоплює значення URL без лапок і коментаря. */
const HASURA_ENDPOINT_LINE_RE = /^[ \t]*(?:export[ \t]+)?HASURA_GRAPHQL_ENDPOINT[ \t]*=[ \t]*['"]?([^'"\r\n#]+)/mu
// Дозволяємо лише DNS-суфікс кластера `<name>.internal` (GKE/GCP).
const INTERNAL_HASURA_URL_RE = /^http:\/\/([^./]+)\.([^./]+)\.svc\.([^./:]+\.internal):(\d+)\/?$/u
const INTERNAL_DNS_SUFFIX = '.internal'

const MISMATCH_REASONS = new Set(['internal-url-service-mismatch', 'internal-url-namespace-mismatch'])

/**
 * Розбір значення `HASURA_GRAPHQL_ENDPOINT` як внутрішнього кластерного URL.
 * @param {string} url значення з `.env` (без огорнутих лапок)
 * @returns {{ ok: true, service: string, namespace: string, cluster: string, port: string } | { ok: false }}
 *   розібрані сегменти або `{ ok: false }`, якщо формат не відповідає внутрішньому кластерному URL
 */
function parseInternalHasuraEndpoint(url) {
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
 * Обчислює очікувані `service`/`namespace` з `hasura/k8s/base/{svc-hl,namespace}.yaml`.
 * @param {string} root корінь репозиторію
 * @returns {Promise<{ service: string | null, namespace: string | null }>} очікувані сегменти URL
 */
async function computeExpectedEndpointSegments(root) {
  return {
    service: await readYamlMetadataName(join(root, HASURA_SVC_HL_FILE), 'Service'),
    namespace: await readYamlMetadataName(join(root, HASURA_NAMESPACE_FILE), 'Namespace')
  }
}

/**
 * Переписує значення `HASURA_GRAPHQL_ENDPOINT` у файлі на очікувані `service`/`namespace`.
 * @param {string} absPath абсолютний шлях `.env`
 * @param {{ service: string | null, namespace: string | null }} expected очікувані сегменти
 * @returns {Promise<boolean>} true — якщо файл змінено
 */
async function rewriteEndpoint(absPath, expected) {
  const content = await readFile(absPath, 'utf8')
  const m = content.match(HASURA_ENDPOINT_LINE_RE)
  if (!m) return false

  const raw = m[1]
  const parsed = parseInternalHasuraEndpoint(raw.trim())
  if (!parsed.ok) return false

  const service = expected.service ?? parsed.service
  const namespace = expected.namespace ?? parsed.namespace
  const nextValue = `http://${service}.${namespace}.svc.${parsed.cluster}.internal:${parsed.port}`
  if (nextValue === raw.trim()) return false

  const rawStart = m.index + m[0].indexOf(raw)
  const nextContent = content.slice(0, rawStart) + nextValue + content.slice(rawStart + raw.length)
  await writeFile(absPath, nextContent, 'utf8')
  return true
}

/** @type {import('../../../scripts/lib/lint-surface/types.mjs').T0Pattern[]} */
export const patterns = [
  {
    id: 'hasura-internal-url-mismatch',
    test: violations => violations.some(v => MISMATCH_REASONS.has(v.reason)),
    apply: async (violations, ctx) => {
      const expected = await computeExpectedEndpointSegments(ctx.cwd)
      const files = [...new Set(violations.filter(v => MISMATCH_REASONS.has(v.reason) && v.file).map(v => v.file))]

      const touchedFiles = []
      for (const rel of files) {
        const absPath = join(ctx.cwd, rel)
        if (await rewriteEndpoint(absPath, expected)) {
          ctx.recordWrite?.(absPath)
          touchedFiles.push(absPath)
        }
      }

      return touchedFiles.length > 0
        ? { touchedFiles, message: `HASURA_GRAPHQL_ENDPOINT: ${touchedFiles.length} файл(ів)` }
        : { touchedFiles: [] }
    }
  }
]
