/** @see ./docs/main.md */
import { reportCiArtifactCollectionDiagnostics } from '@7n/rules/scripts/lib/ci-artifact-collect.mjs'
import { createViolationReporter } from '@7n/rules/scripts/lib/lint-surface/violation-reporter.mjs'

// `slots/` — публікується разом з пакетом (spec §7.3); `package.json#files` цього плагіна
// доповнить оркестратор інтеграції (Фаза 3 явно НЕ чіпає plugin manifests, spec-задача).
import { diagnoseArtifact, loadCanonicalCommand } from '../../../slots/ci-artifact-consumer.mjs'
import { collectArtifacts } from './collect-artifacts.mjs'

/**
 * Діагностує ОДИН artifact (`mergeStrategy: "contains-step"`) проти поточного стану
 * `targetPath`. Винесено з {@link lint} — та сама причина.
 * @param {ReturnType<typeof createViolationReporter>} reporter репортер порушень
 * @param {{ cwd: string }} ctx контекст лінту (лише `cwd` тут потрібен)
 * @param {import('./collect-artifacts.mjs').ArtifactCandidate} candidate одна валідна (без колізій) contribution
 * @returns {Promise<void>}
 */
async function reportArtifact(reporter, ctx, { contribution, descriptor }) {
  const commandResult = await loadCanonicalCommand(contribution, descriptor)
  if (!commandResult.ok) {
    reporter.fail(`ci.artifact "${descriptor.artifactId}" (${contribution.pluginName}): ${commandResult.reason}`, {
      reason: 'template-error',
      file: descriptor.targetPath
    })
    return
  }

  const diag = await diagnoseArtifact({
    cwd: ctx.cwd,
    targetPath: descriptor.targetPath,
    command: commandResult.command
  })
  // patch-existing: pipeline-файл належить ІНШОМУ, окремому концерну (azure-pipelines) — його
  // відсутність не порушення ЦЬОГО concern-а, generic consumer мовчки пропускає (spec §7.1).
  if (!diag.applicable) return

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
          contributionId: contribution.id
        }
      }
    )
  }
}

/**
 * Detector generic-consumer-а слоту `ci.artifact@1` для `ci:azure` (spec §7.3, Фаза 3):
 * перевіряє наявність канонічного lint-кроку (АБО загального full-lint fallback-у) на будь-якій
 * глибині `azure-pipelines.yml` — без жодного PHP/lang-specific literal тут (v1 diagnostic-only,
 * `fix: false` — немає T0-фіксу, лише порушення).
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
