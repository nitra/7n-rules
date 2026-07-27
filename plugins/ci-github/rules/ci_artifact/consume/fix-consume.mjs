/**
 * T0-фікс generic-consumer-а слоту `ci.artifact@1` (`mergeStrategy: "deep-subset"`, spec §7.2):
 * приводить кожен цільовий файл до канонічного `template` — детерміновано, без LLM.
 *
 * Застосовує ВСІ `descriptor.fix === true` contributions у ТОМУ САМОМУ graph-порядку, що
 * detector (`collectArtifacts`, spec §10 Фаза 3 п.4 — deterministic order при двох contributors
 * в один target file): кожен наступний виклик `applyDeepSubsetFix` читає файл ПІСЛЯ merge-у
 * попередньої contribution, тож contribution Б (напр. `patch-existing`) бачить уже застосовану
 * contribution А (напр. `required-file`).
 */
// eslint-disable-next-line n/no-unpublished-import
import { applyDeepSubsetFix, loadCanonicalTemplate } from '../../../slots/ci-artifact-consumer.mjs'
import { collectArtifacts } from './collect-artifacts.mjs'

/**
 * Чи `data` — violation цього concern-а, для якої дозволений deterministic fix.
 * @param {Record<string, unknown> | undefined} data `violation.data`
 * @returns {boolean} true — fix-eligible
 */
function isFixableViolationData(data) {
  return (data?.kind === 'artifact-missing' || data?.kind === 'artifact-mismatch') && data?.fix === true
}

/** @type {import('@7n/rules/scripts/lib/lint-surface/types.mjs').T0Pattern[]} */
export const patterns = [
  {
    id: 'ci-github-ci-artifact-consume',
    test: violations => violations.some(v => isFixableViolationData(v.data)),
    apply: async (violations, ctx) => {
      const targeted = violations.filter(v => isFixableViolationData(v.data))
      if (targeted.length === 0) return { touchedFiles: [] }

      const { relevant } = await collectArtifacts(ctx.cwd)
      const touched = new Set()
      for (const { contribution, descriptor } of relevant) {
        if (!descriptor.fix) continue
        const isTargeted = targeted.some(
          v => v.data?.artifactId === descriptor.artifactId && v.file === descriptor.targetPath
        )
        if (!isTargeted) continue

        const templateResult = await loadCanonicalTemplate(contribution, descriptor)
        if (!templateResult.ok) continue // template-error — детектор уже репортить, T0 нічого не пише

        const result = await applyDeepSubsetFix({
          cwd: ctx.cwd,
          targetPath: descriptor.targetPath,
          canonical: templateResult.canonical,
          templateText: templateResult.templateText,
          recordWrite: ctx.recordWrite
        })
        for (const f of result.touchedFiles) touched.add(f)
      }
      return { touchedFiles: [...touched] }
    }
  }
]
