/**
 * Якщо в каталозі пакета (батько `k8s/`) є `vite.config.{js,mjs,ts}`, у `ua/kustomization.yaml`
 * має бути inline-patch HTTPRoute (непорожній `target.name`): `/spec/hostnames` (домени abie),
 * `/spec/parentRefs/0/namespace` (`ua` або `ua-*`).
 *
 * Для спільних сервісів (`auth-run-hl`, `file-link-hl`) у base-HTTPRoute пакета — кожен `backendRef`
 * має `namespace: dev`; в overlay patch — JSON6902 на `/spec/rules/…/backendRefs/…/namespace` зі
 * `value: ua`. Кількість patch-ів = кількість таких посилань у base.
 * @param {string} [cwd] корінь репозиторію
 */
import { readFile } from 'node:fs/promises'
import { relative } from 'node:path'

import { createCheckReporter } from '../../../scripts/lib/check-reporter.mjs'
import { loadCursorIgnorePaths } from '../../../scripts/lib/load-cursor-config.mjs'

import { analyzeAbieSharedBackendRefsInPackageK8s } from '../lib/http-route.mjs'
import { findK8sYamlFiles } from '../lib/k8s-tree.mjs'
import {
  getCombinedNginxRunPatchTextFromKustomization,
  validateAbieNginxRunHttpRoutePatches
} from '../lib/kustomization-patches.mjs'
import {
  abiePackageDirFromK8sOverlay,
  abieOverlayRequiresHttpRouteByVite,
  isUaKustomizationPath
} from '../lib/overlay-paths.mjs'

/**
 * @returns {Promise<number>} результат
 * @param {string} [cwd] корінь репозиторію
 */
export async function check(cwd = process.cwd()) {
  const reporter = createCheckReporter()
  const { pass, fail } = reporter
  const root = cwd

  const ignorePaths = await loadCursorIgnorePaths(root)
  const yamls = await findK8sYamlFiles(root, ignorePaths)

  const uaAbsList = yamls.filter(abs => isUaKustomizationPath(relative(root, abs).replaceAll('\\', '/') || abs))
  if (uaAbsList.length === 0) {
    pass('Немає ua/kustomization.yaml у дереві k8s — patch HTTPRoute (ua) не вимагається (abie.mdc, лише Vite-пакети)')
    return reporter.getExitCode()
  }

  /** @type {Map<string, Promise<{ refCount: number, baseErrors: string[] }>>} */
  const cache = new Map()

  for (const abs of uaAbsList) {
    const rel = relative(root, abs).replaceAll('\\', '/') || abs
    if (!abieOverlayRequiresHttpRouteByVite(root, abs)) {
      pass(`${rel}: HTTPRoute patch (ua) не застосовується — немає vite.config.{js,mjs,ts} у пакеті (abie)`)
      continue
    }
    const pkgAbs = abiePackageDirFromK8sOverlay(root, abs)
    if (!pkgAbs) {
      fail(`${rel}: внутрішня помилка abie overlay (немає каталогу пакета)`)
      continue
    }
    let p = cache.get(pkgAbs)
    if (!p) {
      p = analyzeAbieSharedBackendRefsInPackageK8s(root, pkgAbs, yamls)
      cache.set(pkgAbs, p)
    }
    const sharedAnalysis = await p
    let hasBaseError = false
    for (const err of sharedAnalysis.baseErrors) {
      fail(err)
      hasBaseError = true
    }
    if (hasBaseError) continue
    let raw
    try {
      raw = await readFile(abs, 'utf8')
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      fail(`${rel}: не вдалося прочитати (${msg})`)
      continue
    }
    const combined = getCombinedNginxRunPatchTextFromKustomization(raw)
    const v = validateAbieNginxRunHttpRoutePatches(combined, 'ua', raw, sharedAnalysis.refCount)
    if (v === null) pass(`${rel}: HTTPRoute patch (ua) відповідає abie.mdc`)
    else fail(`${rel}: ${v}`)
  }

  return reporter.getExitCode()
}
