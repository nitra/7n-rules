/**
 * lint-поверхня k8s/hasura_configmap: gated detector. Без власного `main.mjs` generic
 * lint-surface (`hasHandWrittenMain` у `scripts/lib/lint-surface/detect.mjs`) промотує
 * будь-який concern із резолвним `policy.files.walkGlob` у **ungated** standalone detector —
 * rego `hasura_configmap.rego` прогнав би тоді напряму на всі `configmap.yaml` під k8s,
 * без перевірки, чи є поруч Hasura Deployment (false positive на звичайних CronJob/Job
 * ConfigMap, issue: efes-cloud/backend). Cross-file JS-гейт (`findDeploymentDocInDir` +
 * `isHasuraDeploymentManifest`) і сам виклик rego живуть у `k8s/manifests/main.mjs`
 * (`validateHasuraConfigMapRemoteSchemaPermissions`, export) — тут лише тонка обгортка.
 */
import { createViolationReporter } from '../../../scripts/lib/lint-surface/violation-reporter.mjs'
import { loadCursorIgnorePaths } from '../../../scripts/lib/load-cursor-config.mjs'
import { findK8sYamlFiles, validateHasuraConfigMapRemoteSchemaPermissions } from '../manifests/main.mjs'

/**
 * Detector k8s/hasura_configmap (read-only).
 * @param {import('../../../scripts/lib/lint-surface/types.mjs').LintContext} ctx контекст лінту.
 * @returns {Promise<import('../../../scripts/lib/lint-surface/types.mjs').LintResult>} результат із порушеннями
 */
export async function lint(ctx) {
  const reporter = createViolationReporter(ctx)
  const { pass, fail } = reporter
  const root = ctx.cwd

  const ignorePaths = await loadCursorIgnorePaths(root)
  const yamlFiles = await findK8sYamlFiles(root, ignorePaths)
  if (yamlFiles.length === 0) {
    pass('Немає *.yaml під k8s — перевірку hasura_configmap пропущено')
    return reporter.result()
  }

  await validateHasuraConfigMapRemoteSchemaPermissions(root, yamlFiles, fail, pass)

  return reporter.result()
}
