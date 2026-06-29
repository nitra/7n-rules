/** @see ./docs/ua_node_selector.md */
import { readFile } from 'node:fs/promises'
import { relative } from 'node:path'

import { createViolationReporter } from '../../../scripts/lib/lint-surface/violation-reporter.mjs'
import { loadCursorIgnorePaths } from '../../../scripts/lib/load-cursor-config.mjs'

import { collectDeploymentDirs, findK8sYamlFiles } from '../lib/k8s-tree.mjs'
import { kustomizationHasAbieDeploymentNodeSelectorPatch } from '../lib/kustomization-patches.mjs'
import { abieOverlayK8sTreeHasDeployment, isUaKustomizationPath } from '../lib/overlay-paths.mjs'

/**
 * @param {import('../../../scripts/lib/lint-surface/types.mjs').LintContext} ctx
 * @returns {Promise<import('../../../scripts/lib/lint-surface/types.mjs').LintResult>}
 */
export async function lint(ctx) {
  const reporter = createViolationReporter(ctx)
  const { pass, fail } = reporter
  const root = ctx.cwd

  const ignorePaths = await loadCursorIgnorePaths(root)
  const yamls = await findK8sYamlFiles(root, ignorePaths)
  const deploymentDirs = await collectDeploymentDirs(root, yamls, fail)

  if (deploymentDirs.size === 0) {
    pass('Немає Deployment у дереві k8s — patch nodeSelector (ua) не вимагається')
    return reporter.result()
  }

  const uaAbsList = yamls.filter(abs => isUaKustomizationPath(relative(root, abs).replaceAll('\\', '/') || abs))
  if (uaAbsList.length === 0) {
    fail(
      'Є Deployment у k8s — додай ua/kustomization.yaml з patch на Deployment: path /spec/template/spec/nodeSelector, preem false (abie.mdc)'
    )
    return reporter.result()
  }

  for (const abs of uaAbsList) {
    const rel = relative(root, abs).replaceAll('\\', '/') || abs
    if (!abieOverlayK8sTreeHasDeployment(deploymentDirs, root, abs)) {
      pass(`${rel}: nodeSelector patch (ua) не застосовується — немає Deployment у дереві k8s цього пакета (abie)`)
      continue
    }
    let raw
    try {
      raw = await readFile(abs, 'utf8')
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      fail(`${rel}: не вдалося прочитати (${msg})`)
      continue
    }
    if (!kustomizationHasAbieDeploymentNodeSelectorPatch(raw, 'ua')) {
      fail(
        `${rel}: потрібен patch target kind Deployment: path /spec/template/spec/nodeSelector та preem: false (abie.mdc)`
      )
      continue
    }
    pass(`${rel}: nodeSelector patch (ua) відповідає abie.mdc`)
  }

  return reporter.result()
}
