/**
 * Перевірка abie: для кожного каталогу з `kind: Deployment` під `k8s/` поруч має бути `hc.yaml`
 * з коректним modeline (yaml-language-server $schema).
 *
 * Це JS-частина (FS-парність + modeline). Структурну валідацію `HealthCheckPolicy`
 * (apiVersion, requestPath, port, targetRef з суфіксом `-hl`) робить CLI через
 * `policy/health_check_policy/target.json` (walkGlob по hc.yaml у k8s-дереві).
 */
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { relative } from 'node:path'

import { createCheckReporter } from '../../../../scripts/utils/check-reporter.mjs'
import { loadCursorIgnorePaths } from '../../../../scripts/utils/load-cursor-config.mjs'

import { validateAbieHcModeline } from '../../utils/hc-yaml.mjs'
import { collectDeploymentDirs, findK8sYamlFiles } from '../../utils/k8s-tree.mjs'

/**
 * @returns {Promise<number>} результат
 */
export async function check() {
  const reporter = createCheckReporter()
  const { pass, fail } = reporter
  const root = process.cwd()

  const ignorePaths = await loadCursorIgnorePaths(root)
  const yamls = await findK8sYamlFiles(root, ignorePaths)
  const deploymentDirs = await collectDeploymentDirs(root, yamls, fail)

  if (deploymentDirs.size === 0) {
    pass('Немає Deployment у дереві k8s — перевірку hc.yaml пропущено')
    return reporter.getExitCode()
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

  return reporter.getExitCode()
}
