/** @see ./docs/ua_node_selector.md */
import { readFile } from 'node:fs/promises'
import { relative } from 'node:path'

import { createCheckReporter } from '../../../scripts/lib/check-reporter.mjs'
import { loadCursorIgnorePaths } from '../../../scripts/lib/load-cursor-config.mjs'

import { collectDeploymentDirs, findK8sYamlFiles } from '../lib/k8s-tree.mjs'
import { kustomizationHasAbieDeploymentNodeSelectorPatch } from '../lib/kustomization-patches.mjs'
import { abieOverlayK8sTreeHasDeployment, isUaKustomizationPath } from '../lib/overlay-paths.mjs'

/**
 * @returns {Promise<number>} результат
 * @param {string} [cwd] корінь репозиторію
 */
export async function main(cwd = process.cwd()) {
  const reporter = createCheckReporter()
  const { pass, fail } = reporter
  const root = cwd

  const ignorePaths = await loadCursorIgnorePaths(root)
  const yamls = await findK8sYamlFiles(root, ignorePaths)
  const deploymentDirs = await collectDeploymentDirs(root, yamls, fail)

  if (deploymentDirs.size === 0) {
    pass('Немає Deployment у дереві k8s — patch nodeSelector (ua) не вимагається')
    return reporter.getExitCode()
  }

  const uaAbsList = yamls.filter(abs => isUaKustomizationPath(relative(root, abs).replaceAll('\\', '/') || abs))
  if (uaAbsList.length === 0) {
    fail(
      'Є Deployment у k8s — додай ua/kustomization.yaml з patch на Deployment: path /spec/template/spec/nodeSelector, preem false (abie.mdc)'
    )
    return reporter.getExitCode()
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

  return reporter.getExitCode()
}
