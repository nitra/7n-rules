/**
 * Парсинг inline JSON6902-патчів у abie ua-kustomization:
 *   - **nodeSelector** patch на `Deployment` (preem: false);
 *   - **HTTPRoute** patch (hostnames, parentRefs namespace, backendRefs namespace).
 *
 * Regex використовуються, бо `patch:` — це YAML-string з вкладеним JSON6902, який ми не парсимо
 * вдруге; підрядки на кшталт `path: /spec/hostnames` і `value: ua` достатньо інформативні.
 */
import { parseAllDocuments } from 'yaml'

import { LINE_SPLIT_RE, MODELINE_RE, stripBom } from './yaml.mjs'

const PATCH_NODE_SELECTOR_PATH_RE = /path:\s*\/spec\/template\/spec\/nodeSelector\b/u
const PATCH_PREEM_FALSE_RE = /\bpreem:\s*['"]?false['"]?\b/u
const PATCH_HOSTNAMES_PATH_RE = /path:\s*\/spec\/hostnames\b/mu
// Overlay namespaces: дозволено `ua` і `ua-*` (наприклад `ua-b2b`).
const PATCH_PARENT_REF_NS_UA_RE =
  /path:\s*\/spec\/parentRefs\/0\/namespace\b[\s\S]{0,200}?value:\s*['"]?ua(?:-[a-z0-9][a-z0-9-]*)?['"]?(?:\s|$)/imu

/** Домени `hostnames` для overlay `ua` (підрядки у JSON6902-тексті patch). */
const ABIE_UA_HTTPROUTE_HOST_MARKERS = ['abie.app', 'vybeerai.com.ua', '*.abie.app', '*.vybeerai.com.ua']

// ── nodeSelector (ua) ─────────────────────────────────────────────────────

/**
 * Чи patch-рядок містить очікуваний ua nodeSelector (preem: false).
 * @param {string} patchText
 * @returns {boolean}
 */
function jsonPatchTextHasUaDeploymentNodeSelector(patchText) {
  if (typeof patchText !== 'string' || patchText.trim() === '') return false
  if (!PATCH_NODE_SELECTOR_PATH_RE.test(patchText)) return false
  if (!PATCH_PREEM_FALSE_RE.test(patchText)) return false
  return true
}

/**
 * Чи один елемент `patches` відповідає abie nodeSelector для `mode`.
 * @param {unknown} p
 * @param {'ua'} mode
 * @returns {boolean}
 */
function inlineKustomizationPatchMatchesAbieMode(p, mode) {
  if (p === null || typeof p !== 'object' || Array.isArray(p)) return false
  const pr = /** @type {Record<string, unknown>} */ (p)
  const target = pr.target
  if (target === null || typeof target !== 'object' || Array.isArray(target)) return false
  const tg = /** @type {Record<string, unknown>} */ (target)
  if (tg.kind !== 'Deployment') return false
  const patchStr = pr.patch
  if (typeof patchStr !== 'string') return false
  if (mode === 'ua' && jsonPatchTextHasUaDeploymentNodeSelector(patchStr)) return true
  return false
}

/**
 * Чи документ Kustomization містить відповідний inline patch на Deployment.
 * @param {import('yaml').Document} doc
 * @param {'ua'} mode
 * @returns {boolean}
 */
function kustomizationDocumentHasAbieDeploymentNodeSelectorPatch(doc, mode) {
  if (doc.errors.length > 0) return false
  const root = doc.toJSON()
  if (root === null || typeof root !== 'object' || Array.isArray(root)) return false
  const rec = /** @type {Record<string, unknown>} */ (root)
  if (rec.kind !== 'Kustomization') return false
  const patches = rec.patches
  if (!Array.isArray(patches)) return false
  for (const p of patches) {
    if (inlineKustomizationPatchMatchesAbieMode(p, mode)) return true
  }
  return false
}

/**
 * Чи `kustomization.yaml` містить валідні inline patch для Deployment nodeSelector (ua).
 * @param {string} raw повний текст файла
 * @param {'ua'} mode
 * @returns {boolean}
 */
export function kustomizationHasAbieDeploymentNodeSelectorPatch(raw, mode) {
  const body = stripBom(raw)
  const lines = body.split(LINE_SPLIT_RE)
  const first = lines[0] ?? ''
  const rest = MODELINE_RE.test(first.trim()) ? lines.slice(1).join('\n') : body
  /** @type {import('yaml').Document[]} */
  let docs
  try {
    docs = parseAllDocuments(rest)
  } catch {
    return false
  }
  for (const doc of docs) {
    if (kustomizationDocumentHasAbieDeploymentNodeSelectorPatch(doc, mode)) return true
  }
  return false
}

// ── HTTPRoute (ua) ────────────────────────────────────────────────────────

/**
 * @param {unknown} p
 * @returns {string | null}
 */
function extractHttpRoutePatchString(p) {
  if (p === null || typeof p !== 'object' || Array.isArray(p)) return null
  const pr = /** @type {Record<string, unknown>} */ (p)
  const target = pr.target
  if (target === null || typeof target !== 'object' || Array.isArray(target)) return null
  const tg = /** @type {Record<string, unknown>} */ (target)
  if (tg.kind !== 'HTTPRoute' || typeof tg.name !== 'string' || tg.name.trim() === '') return null
  const patchStr = pr.patch
  return typeof patchStr === 'string' && patchStr.trim() !== '' ? patchStr : null
}

/**
 * Збирає inline `patch`-рядки для HTTPRoute (непорожній `target.name`) з одного Kustomization-документа.
 * @param {import('yaml').Document} doc
 * @returns {string[]}
 */
function collectAbieHttpRoutePatchStringsFromKustomizationDoc(doc) {
  if (doc.errors.length > 0) return []
  const root = doc.toJSON()
  if (root === null || typeof root !== 'object' || Array.isArray(root)) return []
  const rec = /** @type {Record<string, unknown>} */ (root)
  if (rec.kind !== 'Kustomization' || !Array.isArray(rec.patches)) return []
  /** @type {string[]} */
  const out = []
  for (const p of rec.patches) {
    const s = extractHttpRoutePatchString(p)
    if (s !== null) out.push(s)
  }
  return out
}

/**
 * Збирає всі inline JSON6902-фрагменти HTTPRoute (непорожній `target.name`) у kustomization.yaml.
 * @param {string} raw повний текст файла
 * @returns {string}
 */
export function getCombinedNginxRunPatchTextFromKustomization(raw) {
  const body = stripBom(raw)
  const lines = body.split(LINE_SPLIT_RE)
  const first = lines[0] ?? ''
  const rest = MODELINE_RE.test(first.trim()) ? lines.slice(1).join('\n') : body
  /** @type {import('yaml').Document[]} */
  let docs
  try {
    docs = parseAllDocuments(rest)
  } catch {
    return ''
  }
  /** @type {string[]} */
  const chunks = []
  for (const doc of docs) {
    chunks.push(...collectAbieHttpRoutePatchStringsFromKustomizationDoc(doc))
  }
  return chunks.join('\n')
}

/**
 * Рахує операції JSON6902 з `path: /spec/rules/.../backendRefs/.../namespace` і `value: ua[-…]`.
 * @param {string} combined сукупний текст patch
 * @param {'ua'} mode
 * @returns {number}
 */
function countAbieHttpRouteBackendRefNamespacePatchesInCombined(combined, mode) {
  if (mode !== 'ua') return 0
  const re =
    /path:\s*\/spec\/rules\/\d+\/backendRefs\/\d+\/namespace\b[\s\S]{0,200}?value:\s*['"]?ua(?:-[a-z0-9][a-z0-9-]*)?['"]?(?:\s|$)/gimu
  return [...combined.matchAll(re)].length
}

/**
 * Перевіряє сукупний текст patch(ів) HTTPRoute на відповідність abie.mdc.
 * @param {string} combined сукупний текст patch
 * @param {'ua'} mode
 * @param {string} [_fullKustomizationRaw] зберігається для API-сумісності, не використовується
 * @param {number} [sharedCrossNsBackendRefCount] кількість `auth-run-hl`/`file-link-hl` у base HTTPRoute
 * @returns {string | null} повідомлення про помилку або null
 */
export function validateAbieNginxRunHttpRoutePatches(
  combined,
  mode,
  _fullKustomizationRaw,
  sharedCrossNsBackendRefCount = 0
) {
  if (typeof combined !== 'string' || combined.trim() === '') {
    return `очікується patch target kind HTTPRoute з непорожнім target.name (hostnames, parentRefs namespace ${mode}) — abie.mdc`
  }
  if (!PATCH_HOSTNAMES_PATH_RE.test(combined)) {
    return 'HTTPRoute: потрібен path /spec/hostnames у patch (abie.mdc)'
  }
  const markers = ABIE_UA_HTTPROUTE_HOST_MARKERS
  if (!markers.some(m => combined.includes(m))) {
    return `HTTPRoute: у value для /spec/hostnames має бути один із доменів abie (${markers.join(', ')}) — abie.mdc`
  }
  if (!PATCH_PARENT_REF_NS_UA_RE.test(combined)) {
    return `HTTPRoute: потрібен path /spec/parentRefs/0/namespace з value ${mode} (abie.mdc)`
  }
  const sharedCount =
    typeof sharedCrossNsBackendRefCount === 'number' && Number.isFinite(sharedCrossNsBackendRefCount)
      ? Math.max(0, Math.floor(sharedCrossNsBackendRefCount))
      : 0
  if (sharedCount > 0) {
    const patchHits = countAbieHttpRouteBackendRefNamespacePatchesInCombined(combined, mode)
    if (patchHits < sharedCount) {
      return `HTTPRoute: для backendRefs до спільних сервісів auth-run-hl, file-link-hl очікується ${sharedCount} JSON6902 patch(ів) з path /spec/rules/…/backendRefs/…/namespace та value ${mode} (зараз ${patchHits}) — abie.mdc`
    }
  }
  return null
}

/**
 * Чи kustomization містить валідні patch для HTTPRoute (ua).
 * @param {string} raw повний текст kustomization.yaml
 * @param {'ua'} mode
 * @returns {boolean}
 */
export function kustomizationHasAbieNginxRunHttpRoutePatch(raw, mode) {
  const combined = getCombinedNginxRunPatchTextFromKustomization(raw)
  return validateAbieNginxRunHttpRoutePatches(combined, mode, raw) === null
}
