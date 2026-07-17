/** @see ./docs/fix-manifests.md */

/**
 * T0-autofix для `k8s/manifests` — детерміновані правки без LLM, керовані structured
 * `data` детектора (#3 fix-hints). Покриває механічні родини порушень k8s.mdc:
 *   - `gateway-httproute-v1beta1` — apiVersion v1beta1 → v1 (+ $schema-modeline);
 *   - `batch-v1beta1-apiversion` — apiVersion batch/v1beta1 → batch/v1 (CronJob/Job);
 *   - `schema-modeline-first` — перемістити `# yaml-language-server: $schema=…` у перший рядок;
 *   - `kustomization-patches-sort` — впорядкувати `patches[]` (реюз детекторних sort-ключів);
 *   - `deployment-strategy` — проставити канонічний `spec.strategy` RollingUpdate;
 *   - `hasura-configmap-env` — проставити обов'язкові `HASURA_GRAPHQL_*` env у Hasura ConfigMap;
 *   - `hasura-httproute-rule1-filters` — проставити канонічний RequestRedirect у правило 1
 *     Hasura-канона HTTPRoute (лише overwrite існуючого правила, без синтезу нових);
 *   - `svc-clusterip-type` — проставити `spec.type: ClusterIP` у `svc.yaml`;
 *   - `svc-hl-cluster-ip` — проставити `spec.clusterIP: None` у `svc-hl.yaml`
 *     (без перейменування `metadata.name`, суфікс `-hl` — не T0).
 *
 * Правки роблять через `yaml` Document/Documents (зберігають коментарі), окрім modeline
 * (чистий текст). Семантичну коректність гарантує canonical re-detect (rego) — T0
 * permanent, поза rollback; будь-яка невпевненість → no-op (повертаємо null/skip).
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { parseAllDocuments, parseDocument } from 'yaml'

import {
  compareStringTuplesEn,
  findHasuraCanonStart,
  HASURA_REQUIRED_ENV_VALUES,
  hasuraRuleHasExactRedirect,
  kustomizationPatchSortKey,
  loadSnippetSpec,
  replaceBatchV1beta1ApiVersionInYamlText,
  replaceGatewayHttpRouteV1beta1ApiVersionInYamlText,
  snippetNameForKind
} from './main.mjs'

const SCHEMA_MODELINE_RE = /^\s*#\s*yaml-language-server:\s*\$schema=\S+/u
const LEADING_WHITESPACE_RE = /^\s+/u
const LEADING_DOC_SEPARATOR_RE = /^---\n/u

/**
 * Переміщує рядок `# yaml-language-server: $schema=…` у перший рядок файла (без префіксів).
 * @param {string} content вміст файла
 * @returns {string|null} новий вміст або null, якщо modeline відсутній чи вже перший
 */
export function moveSchemaModelineFirst(content) {
  const lines = content.split('\n')
  const idx = lines.findIndex(l => SCHEMA_MODELINE_RE.test(l))
  if (idx <= 0) return null
  const modeline = lines.splice(idx, 1)[0].replace(LEADING_WHITESPACE_RE, '')
  lines.unshift(modeline)
  return lines.join('\n')
}

/**
 * Впорядковує `patches[]` Kustomization за детекторним ключем (target.kind → name →
 * namespace → path). Реюз `kustomizationPatchSortKey`/`compareStringTuplesEn`, тож порядок
 * точно збігається з очікуванням re-detect.
 * @param {string} content вміст kustomization.yaml
 * @returns {string|null} новий вміст або null, якщо вже відсортовано / не застосовно
 */
export function sortKustomizationPatches(content) {
  let doc
  try {
    doc = parseDocument(content)
  } catch {
    return null
  }
  if (doc.errors?.length) return null
  const patches = doc.get('patches')
  if (!patches || !Array.isArray(patches.items) || patches.items.length < 2) return null
  const decorated = patches.items.map((node, i) => ({ node, i, key: kustomizationPatchSortKey(node.toJSON()) }))
  const sorted = decorated.toSorted((a, b) => compareStringTuplesEn(a.key, b.key) || a.i - b.i)
  if (sorted.every((d, i) => d.i === i)) return null // вже відсортовано
  patches.items = sorted.map(d => d.node)
  return doc.toString()
}

/**
 * Проставляє канонічний `spec.strategy` (RollingUpdate, maxUnavailable=0, maxSurge=1) у
 * кожен документ `kind: Deployment`. Multi-doc стрім нормалізується через `---`.
 * @param {string} content вміст файла (може бути multi-doc)
 * @returns {string|null} новий вміст або null, якщо змін немає / парс невпевнений
 */
export function ensureDeploymentStrategy(content) {
  let docs
  try {
    docs = parseAllDocuments(content)
  } catch {
    return null
  }
  if (docs.some(d => d.errors?.length)) return null // не чіпаємо файли, які парсяться з помилками
  const desired = { type: 'RollingUpdate', rollingUpdate: { maxUnavailable: 0, maxSurge: 1 } }
  let changed = false
  for (const doc of docs) {
    if (doc.get('kind') !== 'Deployment' || !doc.has('spec')) continue
    if (JSON.stringify(doc.toJSON()?.spec?.strategy) === JSON.stringify(desired)) continue // ідемпотентність
    doc.setIn(['spec', 'strategy', 'type'], 'RollingUpdate')
    doc.setIn(['spec', 'strategy', 'rollingUpdate', 'maxUnavailable'], 0)
    doc.setIn(['spec', 'strategy', 'rollingUpdate', 'maxSurge'], 1)
    changed = true
  }
  if (!changed) return null
  return docs.map(d => d.toString().replace(LEADING_DOC_SEPARATOR_RE, '').trimEnd()).join('\n---\n') + '\n'
}

/**
 * Проставляє канонічний `spec.egress` (із того ж snippet, яким rego темплейтить перевірку)
 * у кожен документ `kind: NetworkPolicy`. Kind workload-а — з анотації
 * `nitra.dev/workload-kind` (default Deployment). Збіг з очікуванням re-detect гарантований,
 * бо джерело egress — той самий `loadSnippetSpec`.
 * @param {string} content вміст networkpolicy.yaml (може бути multi-doc)
 * @returns {string|null} новий вміст або null, якщо змін немає / парс невпевнений
 */
export function ensureNetworkPolicyEgress(content) {
  let docs
  try {
    docs = parseAllDocuments(content)
  } catch {
    return null
  }
  if (docs.some(d => d.errors?.length)) return null
  let changed = false
  for (const doc of docs) {
    if (doc.get('kind') !== 'NetworkPolicy' || !doc.has('spec')) continue
    const wlKind = doc.getIn(['metadata', 'annotations', 'nitra.dev/workload-kind']) ?? 'Deployment'
    const snippet = loadSnippetSpec(snippetNameForKind(String(wlKind)))
    if (!snippet || !Array.isArray(snippet.egress)) continue
    if (JSON.stringify(doc.toJSON()?.spec?.egress) === JSON.stringify(snippet.egress)) continue // ідемпотентність
    doc.setIn(['spec', 'egress'], doc.createNode(snippet.egress))
    changed = true
  }
  if (!changed) return null
  return docs.map(d => d.toString().replace(LEADING_DOC_SEPARATOR_RE, '').trimEnd()).join('\n---\n') + '\n'
}

/**
 * Чи значення читається як логічне `true` (boolean або рядок, case-insensitive) —
 * дзеркалить `is_value_true` з `k8s.hasura_configmap.rego`.
 * @param {unknown} v значення з `data`
 * @returns {boolean} true, якщо значення означає true
 */
function isTruthyBool(v) {
  if (v === true) return true
  return typeof v === 'string' && v.trim().toLowerCase() === 'true'
}

/**
 * Чи значення читається як логічне `false` — дзеркалить `is_value_false`.
 * @param {unknown} v значення з `data`
 * @returns {boolean} true, якщо значення означає false
 */
function isFalsyBool(v) {
  if (v === false) return true
  return typeof v === 'string' && v.trim().toLowerCase() === 'false'
}

/**
 * Проставляє обов'язкові `HASURA_GRAPHQL_*` env-ключі (`HASURA_REQUIRED_ENV_VALUES`,
 * дзеркалить `k8s.hasura_configmap.rego`) у `data` документа `kind: ConfigMap`. Ключ з
 * очікуванням `null` (наприклад `HASURA_GRAPHQL_DISABLE_EVENTING`) — довільне значення,
 * T0 проставляє лише якщо ключ відсутній (дефолт `'true'`).
 * @param {string} content вміст configmap.yaml
 * @returns {string|null} новий вміст або null, якщо змін немає / парс невпевнений
 */
export function ensureHasuraConfigMapRequiredEnv(content) {
  let doc
  try {
    doc = parseDocument(content)
  } catch {
    return null
  }
  if (doc.errors?.length) return null
  if (doc.get('kind') !== 'ConfigMap') return null

  let changed = false
  for (const [key, expected] of Object.entries(HASURA_REQUIRED_ENV_VALUES)) {
    const current = doc.getIn(['data', key])
    if (expected === null) {
      if (current === undefined) {
        doc.setIn(['data', key], 'true')
        changed = true
      }
      continue
    }
    if (expected === 'true') {
      if (!isTruthyBool(current)) {
        doc.setIn(['data', key], 'true')
        changed = true
      }
      continue
    }
    if (expected === 'false') {
      if (!isFalsyBool(current)) {
        doc.setIn(['data', key], 'false')
        changed = true
      }
      continue
    }
    if (current !== expected) {
      doc.setIn(['data', key], expected)
      changed = true
    }
  }
  if (!changed) return null
  return doc.toString()
}

/**
 * Проставляє канонічний RequestRedirect (правило 1 Hasura-канона, `k8s.hasura_httproute.rego`)
 * у вже знайдене правило `Exact "<prefix>/ql"`. Фіксує лише **існуюче** правило (overwrite
 * `filters`) — правила 2-4 (rule2/3/4_missing) потребують синтезу нового правила з
 * `backendRef`, якого нізвідки достовірно вивести, тож НЕ T0 (за тим самим принципом, що й
 * `internal-url-invalid` у `hasura/internal_urls`: людське рішення про інфраструктуру).
 * @param {string} content вміст hr.yaml (HTTPRoute, може бути multi-doc)
 * @returns {string|null} новий вміст або null, якщо змін немає / не застосовно / парс невпевнений
 */
export function ensureHasuraHttpRouteRule1Filters(content) {
  let docs
  try {
    docs = parseAllDocuments(content)
  } catch {
    return null
  }
  if (docs.some(d => d.errors?.length)) return null
  let changed = false
  for (const doc of docs) {
    if (doc.get('kind') !== 'HTTPRoute') continue
    const plainRules = doc.toJSON()?.spec?.rules
    if (!Array.isArray(plainRules) || plainRules.length === 0) continue
    const start = findHasuraCanonStart(plainRules)
    if (start === null) continue
    const consolePath = `${start.prefix}/ql/console`
    if (hasuraRuleHasExactRedirect(plainRules[start.startIndex], consolePath)) continue // вже канонічно
    const canonicalFilters = [
      {
        type: 'RequestRedirect',
        requestRedirect: { statusCode: 302, path: { type: 'ReplaceFullPath', replaceFullPath: consolePath } }
      }
    ]
    doc.setIn(['spec', 'rules', start.startIndex, 'filters'], doc.createNode(canonicalFilters))
    changed = true
  }
  if (!changed) return null
  return docs.map(d => d.toString().replace(LEADING_DOC_SEPARATOR_RE, '').trimEnd()).join('\n---\n') + '\n'
}

/**
 * Проставляє `spec.type: ClusterIP` у документ `kind: Service` (`svc.yaml`, `k8s.svc_yaml.rego`).
 * @param {string} content вміст svc.yaml (може бути multi-doc)
 * @returns {string|null} новий вміст або null, якщо змін немає / не застосовно / парс невпевнений
 */
export function ensureSvcClusterIpType(content) {
  let docs
  try {
    docs = parseAllDocuments(content)
  } catch {
    return null
  }
  if (docs.some(d => d.errors?.length)) return null
  let changed = false
  for (const doc of docs) {
    if (doc.get('kind') !== 'Service') continue
    if (doc.getIn(['spec', 'type']) === 'ClusterIP') continue
    doc.setIn(['spec', 'type'], 'ClusterIP')
    changed = true
  }
  if (!changed) return null
  return docs.map(d => d.toString().replace(LEADING_DOC_SEPARATOR_RE, '').trimEnd()).join('\n---\n') + '\n'
}

/**
 * Проставляє `spec.clusterIP: None` у документ `kind: Service` (`svc-hl.yaml`, `k8s.svc_hl_yaml.rego`).
 * Не чіпає `metadata.name` (суфікс `-hl`) — перейменування ресурсу впливає на посилання з
 * інших файлів (ConfigMap/Deployment/HTTPRoute), тож НЕ T0.
 * @param {string} content вміст svc-hl.yaml (може бути multi-doc)
 * @returns {string|null} новий вміст або null, якщо змін немає / не застосовно / парс невпевнений
 */
export function ensureSvcHlClusterIp(content) {
  let docs
  try {
    docs = parseAllDocuments(content)
  } catch {
    return null
  }
  if (docs.some(d => d.errors?.length)) return null
  let changed = false
  for (const doc of docs) {
    if (doc.get('kind') !== 'Service') continue
    if (doc.getIn(['spec', 'clusterIP']) === 'None') continue
    doc.setIn(['spec', 'clusterIP'], 'None')
    changed = true
  }
  if (!changed) return null
  return docs.map(d => d.toString().replace(LEADING_DOC_SEPARATOR_RE, '').trimEnd()).join('\n---\n') + '\n'
}

/**
 * Застосовує текстовий трансформер до унікальних файлів із targets і пише зміни.
 * @param {import('../../../scripts/lib/lint-surface/types.mjs').LintViolation[]} targets violations із файлами для правки
 * @param {import('../../../scripts/lib/lint-surface/types.mjs').LintContext} ctx контекст lint-прогону
 * @param {(content: string) => string|null} transform чистий трансформер вмісту (null → без змін)
 * @returns {string[]} абсолютні шляхи змінених файлів
 */
function applyToFiles(targets, ctx, transform) {
  const files = [...new Set(targets.map(v => v.file).filter(Boolean))]
  /** @type {string[]} */
  const touchedFiles = []
  for (const rel of files) {
    const abs = join(ctx.cwd, rel)
    let content
    try {
      content = readFileSync(abs, 'utf8')
    } catch {
      continue
    }
    let next
    try {
      next = transform(content)
    } catch {
      next = null
    }
    if (next && next !== content) {
      ctx.recordWrite?.(abs)
      writeFileSync(abs, next)
      touchedFiles.push(abs)
    }
  }
  return touchedFiles
}

/**
 * Будує T0Pattern, що збирає violations за `data.kind` і застосовує `transform` пер-файл.
 * @param {string} id id патерну
 * @param {string} kind очікуваний `data.kind`
 * @param {(content: string) => string|null} transform чистий трансформер вмісту
 * @param {(n: number) => string} message звіт для debug
 * @returns {import('../../../scripts/lib/lint-surface/types.mjs').T0Pattern} T0-патерн автофіксу
 */
function fileTransformPattern(id, kind, transform, message) {
  return {
    id,
    test: violations => violations.some(v => v.data?.kind === kind && v.file),
    apply: (violations, ctx) => {
      const targets = violations.filter(v => v.data?.kind === kind && v.file)
      const touchedFiles = applyToFiles(targets, ctx, transform)
      return touchedFiles.length > 0 ? { touchedFiles, message: message(touchedFiles.length) } : { touchedFiles: [] }
    }
  }
}

/** @type {import('../../../scripts/lib/lint-surface/types.mjs').T0Pattern[]} */
export const patterns = [
  fileTransformPattern(
    'k8s-manifests-gateway-httproute-v1beta1',
    'gateway-httproute-v1beta1',
    content => {
      const { changed, content: next } = replaceGatewayHttpRouteV1beta1ApiVersionInYamlText(content)
      return changed ? next : null
    },
    n => `gateway HTTPRoute apiVersion v1beta1 → v1: ${n} файл(ів)`
  ),
  fileTransformPattern(
    'k8s-manifests-batch-v1beta1-apiversion',
    'batch-v1beta1-apiversion',
    content => {
      const { changed, content: next } = replaceBatchV1beta1ApiVersionInYamlText(content)
      return changed ? next : null
    },
    n => `batch apiVersion v1beta1 → v1: ${n} файл(ів)`
  ),
  fileTransformPattern(
    'k8s-manifests-schema-modeline-first',
    'schema-modeline-first',
    moveSchemaModelineFirst,
    n => `$schema-modeline → перший рядок: ${n} файл(ів)`
  ),
  fileTransformPattern(
    'k8s-manifests-kustomization-patches-sort',
    'kustomization-patches-sort',
    sortKustomizationPatches,
    n => `kustomization patches впорядковано: ${n} файл(ів)`
  ),
  fileTransformPattern(
    'k8s-manifests-deployment-strategy',
    'deployment-strategy',
    ensureDeploymentStrategy,
    n => `spec.strategy RollingUpdate проставлено: ${n} файл(ів)`
  ),
  fileTransformPattern(
    'k8s-manifests-networkpolicy-egress',
    'networkpolicy-egress',
    ensureNetworkPolicyEgress,
    n => `канонічний spec.egress проставлено: ${n} файл(ів)`
  ),
  fileTransformPattern(
    'k8s-manifests-hasura-configmap-env',
    'hasura-configmap-env',
    ensureHasuraConfigMapRequiredEnv,
    n => `обов'язкові HASURA_GRAPHQL_* env проставлено: ${n} файл(ів)`
  ),
  fileTransformPattern(
    'k8s-manifests-hasura-httproute-rule1-filters',
    'hasura-httproute-rule1-filters',
    ensureHasuraHttpRouteRule1Filters,
    n => `правило 1 Hasura-канона (RequestRedirect) проставлено: ${n} файл(ів)`
  ),
  fileTransformPattern(
    'k8s-manifests-svc-clusterip-type',
    'svc-clusterip-type',
    ensureSvcClusterIpType,
    n => `svc.yaml spec.type: ClusterIP проставлено: ${n} файл(ів)`
  ),
  fileTransformPattern(
    'k8s-manifests-svc-hl-cluster-ip',
    'svc-hl-cluster-ip',
    ensureSvcHlClusterIp,
    n => `svc-hl.yaml spec.clusterIP: None проставлено: ${n} файл(ів)`
  )
]
