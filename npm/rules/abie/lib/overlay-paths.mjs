/**
 * Path-хелпери для overlay-перевірок abie:
 *   - класифікація шляхів (`isUaKustomizationPath`, `isAbieK8sBaseYamlPath`),
 *   - вилучення каталогу пакета з overlay-шляху (`abiePackageDirFromK8sOverlay`),
 *   - умовний gate для HTTPRoute через наявність `vite.config.*` (`abieOverlayRequiresHttpRouteByVite`),
 *   - перевірка наявності `Deployment` у дереві пакета (`abieOverlayK8sTreeHasDeployment`),
 *   - чи yaml належить base-шару пакета (`isK8sYamlInAbiePackageExcludingUaOverlay`).
 */
import { existsSync } from 'node:fs'
import { join, relative } from 'node:path'

const UA_KUSTOMIZATION_PATH_RE = /(^|\/)ua\/kustomization\.yaml$/u
const OVERLAY_PACKAGE_DIR_RE = /^(.+)\/k8s\/ua\/kustomization\.yaml$/u
const BASE_SEGMENT_RE = /(^|\/)base\//u
const TRAILING_SLASH_RE = /\/$/u

/**
 * Чи `rel` — це `…/ua/kustomization.yaml` (abie overlay).
 * @param {string} rel posix-шлях від кореня репозиторію
 * @returns {boolean} результат
 */
export function isUaKustomizationPath(rel) {
  const norm = rel.replaceAll('\\', '/')
  return UA_KUSTOMIZATION_PATH_RE.test(norm)
}

/**
 * Каталог пакета (батько `k8s/`) для overlay `…/k8s/ua/kustomization.yaml`.
 * @param {string} root корінь репозиторію
 * @param {string} kustomizationAbs абсолютний шлях до ua kustomization
 * @returns {string | null} результат
 */
export function abiePackageDirFromK8sOverlay(root, kustomizationAbs) {
  const rel = relative(root, kustomizationAbs).replaceAll('\\', '/') || kustomizationAbs
  const m = rel.match(OVERLAY_PACKAGE_DIR_RE)
  return m ? join(root, m[1]) : null
}

/**
 * Чи у каталозі пакета (батько `k8s/`) є `vite.config.{js,mjs,ts}` — HTTPRoute-вимога abie
 * застосовується лише до Vite-пакетів.
 * @param {string} root корінь репозиторію
 * @param {string} kustomizationAbs абсолютний шлях до ua kustomization
 * @returns {boolean} результат
 */
export function abieOverlayRequiresHttpRouteByVite(root, kustomizationAbs) {
  const pkg = abiePackageDirFromK8sOverlay(root, kustomizationAbs)
  if (!pkg) return false
  return (
    existsSync(join(pkg, 'vite.config.js')) ||
    existsSync(join(pkg, 'vite.config.mjs')) ||
    existsSync(join(pkg, 'vite.config.ts'))
  )
}

/**
 * Чи у дереві `k8s/` пакета є `Deployment` (за каталогами з `collectDeploymentDirs`).
 * @param {Set<string>} deploymentDirs абсолютні каталоги з Deployment
 * @param {string} root корінь репозиторію
 * @param {string} kustomizationAbs абсолютний шлях до ua kustomization
 * @returns {boolean} результат
 */
export function abieOverlayK8sTreeHasDeployment(deploymentDirs, root, kustomizationAbs) {
  const pkg = abiePackageDirFromK8sOverlay(root, kustomizationAbs)
  if (!pkg) return false
  const k8sRoot = join(pkg, 'k8s').replaceAll('\\', '/')
  for (const dir of deploymentDirs) {
    const norm = dir.replaceAll('\\', '/')
    if (norm === k8sRoot || norm.startsWith(`${k8sRoot}/`)) return true
  }
  return false
}

/**
 * Чи rel-шлях `…/k8s/base/…` (base-шар abie, не overlay).
 * @param {string} rel опис.
 * @returns {boolean} результат
 */
export function isAbieK8sBaseYamlPath(rel) {
  const norm = rel.replaceAll('\\', '/')
  return BASE_SEGMENT_RE.test(norm)
}

/**
 * Чи yaml належить до `<pkgRel>/k8s/**` поза `ua/` піддеревом (base-шар abie).
 * @param {string} relFromRoot шлях від кореня
 * @param {string} pkgRelFromRoot каталог пакета від кореня
 * @returns {boolean} результат
 */
export function isK8sYamlInAbiePackageExcludingUaOverlay(relFromRoot, pkgRelFromRoot) {
  const normRel = relFromRoot.replaceAll('\\', '/')
  const pkg = pkgRelFromRoot.replaceAll('\\', '/').replace(TRAILING_SLASH_RE, '')
  const prefix = `${pkg}/k8s/`
  if (!normRel.startsWith(prefix)) return false
  const after = normRel.slice(prefix.length)
  return !after.startsWith('ua/')
}
