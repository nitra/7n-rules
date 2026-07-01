/** @see ./docs/ua_http_route.md */
import { readFile } from 'node:fs/promises'
import { relative } from 'node:path'

import { createViolationReporter } from '../../../scripts/lib/lint-surface/violation-reporter.mjs'
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
 * Лінтить UA HTTP-route overlay concern-а abie.
 * @param {import('../../../scripts/lib/lint-surface/types.mjs').LintContext} ctx Контекст лінту (`cwd` тощо).
 * @returns {Promise<import('../../../scripts/lib/lint-surface/types.mjs').LintResult>} Результат лінту зі списком violations.
 */
export async function lint(ctx) {
  const reporter = createViolationReporter(ctx)
  const { pass, fail } = reporter
  const root = ctx.cwd

  const ignorePaths = await loadCursorIgnorePaths(root)
  const yamls = await findK8sYamlFiles(root, ignorePaths)

  const uaAbsList = yamls.filter(abs => isUaKustomizationPath(relative(root, abs).replaceAll('\\', '/') || abs))
  if (uaAbsList.length === 0) {
    pass('Немає ua/kustomization.yaml у дереві k8s — patch HTTPRoute (ua) не вимагається (abie.mdc, лише Vite-пакети)')
    return reporter.result()
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

  return reporter.result()
}
