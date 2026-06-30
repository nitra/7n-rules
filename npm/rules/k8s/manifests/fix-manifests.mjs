/** @see ./docs/fix-manifests.md */

/**
 * T0-autofix для `k8s/manifests` — детерміновані правки без LLM, керовані structured
 * `data` детектора (#3 fix-hints). Покриває механічні родини порушень k8s.mdc:
 *   - `gateway-httproute-v1beta1` — apiVersion v1beta1 → v1 (+ $schema-modeline);
 *   - `schema-modeline-first` — перемістити `# yaml-language-server: $schema=…` у перший рядок;
 *   - `kustomization-patches-sort` — впорядкувати `patches[]` (реюз детекторних sort-ключів);
 *   - `deployment-strategy` — проставити канонічний `spec.strategy` RollingUpdate.
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
  kustomizationPatchSortKey,
  loadSnippetSpec,
  replaceGatewayHttpRouteV1beta1ApiVersionInYamlText,
  snippetNameForKind
} from './main.mjs'

const SCHEMA_MODELINE_RE = /^\s*#\s*yaml-language-server:\s*\$schema=\S+/u

/**
 * Переміщує рядок `# yaml-language-server: $schema=…` у перший рядок файла (без префіксів).
 * @param {string} content вміст файла
 * @returns {string|null} новий вміст або null, якщо modeline відсутній чи вже перший
 */
export function moveSchemaModelineFirst(content) {
  const lines = content.split('\n')
  const idx = lines.findIndex(l => SCHEMA_MODELINE_RE.test(l))
  if (idx <= 0) return null
  const modeline = lines.splice(idx, 1)[0].replace(/^\s+/u, '')
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
  return docs.map(d => d.toString().replace(/^---\n/u, '').trimEnd()).join('\n---\n') + '\n'
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
  return docs.map(d => d.toString().replace(/^---\n/u, '').trimEnd()).join('\n---\n') + '\n'
}

/**
 * Застосовує текстовий трансформер до унікальних файлів із targets і пише зміни.
 * @param {import('../../../scripts/lib/lint-surface/types.mjs').LintViolation[]} targets
 * @param {import('../../../scripts/lib/lint-surface/types.mjs').LintContext} ctx
 * @param {(content: string) => string|null} transform
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
 * @returns {import('../../../scripts/lib/lint-surface/types.mjs').T0Pattern}
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
  )
]
