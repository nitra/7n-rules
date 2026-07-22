/**
 * Cross-документна аналітика abie HTTPRoute: підрахунок `backendRefs` до спільних
 * сервісів (`auth-run-hl`, `file-link-hl`) у base-маніфестах пакета (поза overlay `ua`).
 * Використовується ua_http_route-концерном для синхронізації числа patch-ів namespace
 * у overlay із кількістю base-reference.
 */
import { relative } from 'node:path'

import { isK8sYamlInAbiePackageExcludingUaOverlay } from './overlay-paths.mjs'
import { readAndParseYamlDocs, silentFail } from './yaml.mjs'

/** Імена спільних headless-сервісів, на які HTTPRoute-и пакетів посилаються крізь namespace. */
export const ABIE_SHARED_CROSS_NS_BACKEND_NAMES = Object.freeze(['auth-run-hl', 'file-link-hl'])
const ABIE_SHARED_CROSS_NS_BACKEND_SET = new Set(ABIE_SHARED_CROSS_NS_BACKEND_NAMES)

/**
 * Перевіряє один `backendRef`: якщо це спільний `-hl` сервіс, має бути `namespace: dev`.
 * @param {unknown} br опис.
 * @param {string} rel rel-шлях файла
 * @param {string[]} errors мутабельний список помилок
 * @returns {number} 1 — це shared backend, 0 — інакше
 */
function checkSharedBackendRef(br, rel, errors) {
  if (br === null || typeof br !== 'object' || Array.isArray(br)) return 0
  const brRec = /** @type {Record<string, unknown>} */ (br)
  const name = brRec.name
  if (typeof name !== 'string' || !ABIE_SHARED_CROSS_NS_BACKEND_SET.has(name)) return 0
  if (typeof brRec.namespace !== 'string' || brRec.namespace !== 'dev') {
    errors.push(`${rel}: HTTPRoute backendRefs до ${name} має містити namespace: dev (abie.mdc)`)
  }
  if (brRec.port !== 8080) {
    errors.push(`${rel}: HTTPRoute backendRefs до ${name} має містити port: 8080 (abie.mdc)`)
  }
  return 1
}

/**
 * Збирає по HTTPRoute-документу кількість посилань на shared backends і порушення namespace.
 * @param {unknown} obj корінь YAML
 * @param {string} rel опис.
 * @returns {{ refCount: number, errors: string[] }} статистика shared-backend посилань і порушення namespace
 */
function httpRouteDocSharedCrossNsBackendStats(obj, rel) {
  /** @type {string[]} */
  const errors = []
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) return { refCount: 0, errors }
  const rec = /** @type {Record<string, unknown>} */ (obj)
  if (rec.kind !== 'HTTPRoute') return { refCount: 0, errors }
  const spec = rec.spec
  if (spec === null || typeof spec !== 'object' || Array.isArray(spec)) return { refCount: 0, errors }
  const rules = /** @type {Record<string, unknown>} */ (spec).rules
  if (!Array.isArray(rules)) return { refCount: 0, errors }
  let refCount = 0
  for (const rule of rules) {
    if (!(rule !== null && typeof rule === 'object' && !Array.isArray(rule))) {
      continue
    }

    const brs = /** @type {Record<string, unknown>} */ (rule).backendRefs
    if (Array.isArray(brs)) {
      for (const br of brs) {
        refCount += checkSharedBackendRef(br, rel, errors)
      }
    }
  }
  return { refCount, errors }
}

/**
 * Збирає по yaml-файлах пакета (поза overlay ua) кількість shared-`-hl` `backendRefs`
 * і базові помилки (без `namespace: dev`).
 * @param {string} root корінь репозиторію
 * @param {string} pkgAbs абсолютний шлях каталогу пакета
 * @param {string[]} yamlFilesAbs усі yaml під k8s
 * @returns {Promise<{ refCount: number, baseErrors: string[] }>} агрегована статистика й помилки base-шару
 */
export async function analyzeAbieSharedBackendRefsInPackageK8s(root, pkgAbs, yamlFilesAbs) {
  const pkgRel = relative(root, pkgAbs).replaceAll('\\', '/') || pkgAbs
  let refCount = 0
  /** @type {string[]} */
  const baseErrors = []
  for (const abs of yamlFilesAbs) {
    const rel = relative(root, abs).replaceAll('\\', '/') || abs
    if (isK8sYamlInAbiePackageExcludingUaOverlay(rel, pkgRel)) {
      const docs = await readAndParseYamlDocs(abs, rel, silentFail)
      if (docs) {
        for (const doc of docs) {
          if (doc.errors.length !== 0) {
            continue
          }

          const json = doc.toJSON()
          const st = httpRouteDocSharedCrossNsBackendStats(json, rel)
          refCount += st.refCount
          baseErrors.push(...st.errors)
        }
      }
    }
  }
  return { refCount, baseErrors }
}
