/**
 * lint-поверхня k8s/kubeconform: read-only detector (`kubeconform`, schema-валідація). Per-file:
 * приймає `ctx.files` (конкретні `.yaml`/`.yml` під `k8s/`), інакше знайдені `k8s/`-корені
 * (full-режим, `findK8sRoots`). Виділено з колишнього bundled `k8s/manifests` (spec
 * docs/specs/2026-07-02-text-check-per-file-split-design.md §6) — kubeconform валідує кожен
 * маніфест незалежно (без крос-файлового стану), тож коректний і на списку конкретних файлів.
 * `kubescape` (kustomize-build) і крос-файлові валідатори лишаються в `k8s/manifests`.
 */
import { createViolationReporter } from '../../../scripts/lib/lint-surface/violation-reporter.mjs'
import { loadCursorIgnorePaths } from '../../../scripts/lib/load-cursor-config.mjs'
import { findK8sRoots, runKubeconform } from '../manifests/main.mjs'

/** Розширення `.yaml`/`.yml` — фільтр delta-списку файлів у `lint(ctx)`. */
const YAML_EXT_RE = /\.ya?ml$/u

/**
 * Detector k8s/kubeconform (read-only).
 * @param {import('../../../scripts/lib/lint-surface/types.mjs').LintContext} ctx контекст лінту.
 * @returns {Promise<import('../../../scripts/lib/lint-surface/types.mjs').LintResult>} результат із порушеннями
 */
export async function lint(ctx) {
  const reporter = createViolationReporter(ctx)
  const { fail } = reporter
  const root = ctx.cwd

  let targets
  if (ctx.files === undefined) {
    const ignorePaths = await loadCursorIgnorePaths(root)
    targets = await findK8sRoots(root, ignorePaths)
  } else {
    targets = ctx.files.filter(f => YAML_EXT_RE.test(f))
  }
  if (targets.length === 0) return reporter.result()

  const code = runKubeconform(targets, ctx.verbose === true)
  if (code !== 0 && code !== 127) fail('kubeconform знайшов невалідні маніфести (k8s.mdc)', 'kubeconform')

  return reporter.result()
}
