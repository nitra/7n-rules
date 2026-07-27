/** @see ./docs/main.md */
import { reportCiArtifactCollectionDiagnostics } from '@7n/rules/scripts/lib/ci-artifact-collect.mjs'
import { createViolationReporter } from '@7n/rules/scripts/lib/lint-surface/violation-reporter.mjs'

// `slots/` — публікується разом з пакетом (spec §7.2); `package.json#files` цього плагіна
// доповнить оркестратор інтеграції (Фаза 3 явно НЕ чіпає plugin manifests, spec-задача).
// eslint-disable-next-line n/no-unpublished-import
import { diagnoseArtifact, loadCanonicalTemplate } from '../../../slots/ci-artifact-consumer.mjs'
import { collectArtifacts } from './collect-artifacts.mjs'

/**
 * Діагностує ОДИН artifact (mode `required-file` → missing-check; інакше deep-subset diff проти
 * поточного стану `targetPath`). Винесено з {@link lint} — та сама причина.
 * @param {ReturnType<typeof createViolationReporter>} reporter репортер порушень
 * @param {{ cwd: string }} ctx контекст лінту (лише `cwd` тут потрібен)
 * @param {import('./collect-artifacts.mjs').ArtifactCandidate} candidate одна валідна (без колізій) contribution
 * @returns {Promise<void>}
 */
async function reportArtifact(reporter, ctx, { contribution, descriptor }) {
  const templateResult = await loadCanonicalTemplate(contribution, descriptor)
  if (!templateResult.ok) {
    reporter.fail(`ci.artifact "${descriptor.artifactId}" (${contribution.pluginName}): ${templateResult.reason}`, {
      reason: 'template-error',
      file: descriptor.targetPath
    })
    return
  }

  const diag = await diagnoseArtifact({
    cwd: ctx.cwd,
    targetPath: descriptor.targetPath,
    canonical: templateResult.canonical
  })
  if (diag.missing) {
    // patch-existing: target-файл належить ІНШОМУ, окремому концерну (spec §7.1) — його
    // відсутність не порушення ЦЬОГО concern-а, generic consumer мовчки пропускає.
    if (descriptor.mode !== 'required-file') return
    reporter.fail(
      `${descriptor.targetPath} відсутній — T0 створить canonical файл (contribution "${descriptor.artifactId}" від ${contribution.pluginName})`,
      {
        reason: 'artifact-missing',
        file: descriptor.targetPath,
        data: {
          kind: 'artifact-missing',
          artifactId: descriptor.artifactId,
          contributorPlugin: contribution.pluginName,
          contributionId: contribution.id,
          fix: descriptor.fix
        }
      }
    )
    return
  }
  for (const v of diag.violations) {
    reporter.fail(
      `${descriptor.targetPath}: ${v} (contribution "${descriptor.artifactId}" від ${contribution.pluginName})`,
      {
        reason: 'artifact-mismatch',
        file: descriptor.targetPath,
        data: {
          kind: 'artifact-mismatch',
          artifactId: descriptor.artifactId,
          contributorPlugin: contribution.pluginName,
          contributionId: contribution.id,
          fix: descriptor.fix
        }
      }
    )
  }
}

/**
 * Detector generic-consumer-а слоту `ci.artifact@1` для `ci:github` (spec §7.2, Фаза 3):
 * матеріалізує КОЖНУ активну contribution проти поточного стану consumer-репо — без жодного
 * PHP/lang-specific literal тут, уся domain-семантика приходить із payload-у contribution-а.
 * @param {import('@7n/rules/scripts/lib/lint-surface/types.mjs').LintContext} ctx контекст лінту
 * @returns {Promise<import('@7n/rules/scripts/lib/lint-surface/types.mjs').LintResult>} результат перевірки
 */
export async function lint(ctx) {
  const reporter = createViolationReporter(ctx)
  const collected = await collectArtifacts(ctx.cwd)
  reportCiArtifactCollectionDiagnostics(reporter, collected)
  for (const candidate of collected.relevant) await reportArtifact(reporter, ctx, candidate)
  return reporter.result()
}
