/** @see ./docs/hc_pairing.md */
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { relative } from 'node:path'

import { createViolationReporter } from '../../../scripts/lib/lint-surface/violation-reporter.mjs'
import { loadCursorIgnorePaths } from '../../../scripts/lib/load-cursor-config.mjs'

import { validateAbieHcModeline } from '../lib/hc-yaml.mjs'
import { collectDeploymentDirs, findK8sYamlFiles } from '../lib/k8s-tree.mjs'

/**
 * @param {import('../../../scripts/lib/lint-surface/types.mjs').LintContext} ctx Контекст лінту (cwd, перелік файлів тощо).
 * @returns {Promise<import('../../../scripts/lib/lint-surface/types.mjs').LintResult>} Результат лінту з переліком порушень.
 */
export async function lint(ctx) {
  const reporter = createViolationReporter(ctx)
  const { pass, fail } = reporter
  const root = ctx.cwd

  const ignorePaths = await loadCursorIgnorePaths(root)
  const yamls = await findK8sYamlFiles(root, ignorePaths)
  const deploymentDirs = await collectDeploymentDirs(root, yamls, fail)

  if (deploymentDirs.size === 0) {
    pass('Немає Deployment у дереві k8s — перевірку hc.yaml пропущено')
    return reporter.result()
  }
  pass(`Знайдено Deployment у ${deploymentDirs.size} директорія(ї/й) k8s — перевіряємо hc.yaml поруч`)

  for (const dir of [...deploymentDirs].toSorted((a, b) => a.localeCompare(b))) {
    const hcAbs = `${dir}/hc.yaml`
    const relHc = relative(root, hcAbs).replaceAll('\\', '/') || 'hc.yaml'
    if (!existsSync(hcAbs)) {
      fail(`${relative(root, dir) || dir}: є Deployment, але немає hc.yaml поруч — додай HealthCheckPolicy (abie.mdc)`)
      continue
    }
    let hcRaw
    try {
      hcRaw = await readFile(hcAbs, 'utf8')
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      fail(`${relHc}: не вдалося прочитати (${msg})`)
      continue
    }
    const modelineErr = validateAbieHcModeline(hcRaw, relHc)
    if (modelineErr === null) pass(`${relHc}: modeline OK`)
    else fail(modelineErr)
  }

  return reporter.result()
}
