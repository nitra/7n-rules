/**
 * Тонка обгортка над `collectCiArtifactContributions`
 * (`@7n/rules/scripts/lib/ci-artifact-collect.mjs`) з capability цього consumer-а (spec
 * `2026-07-27-universal-plugin-slots-lang-php-extraction`, §7.2, Фаза 3). Спільна для
 * detector-а (`main.mjs`) і T0-фіксу (`fix-consume.mjs`) — щоб обидва бачили ОДИН і той самий
 * набір contributions в ОДНОМУ й тому ж graph-порядку (детермінований порядок застосування при
 * двох contributors в один target file, spec §10 Фаза 3 п.4).
 */
import { collectCiArtifactContributions } from '@7n/rules/scripts/lib/ci-artifact-collect.mjs'

/** Capability, для якої релевантні contributions цього consumer-а. */
const TARGET_CAPABILITY = 'ci:github'

/**
 * @typedef {import('@7n/rules/scripts/lib/slot-contracts-ci.mjs').CiArtifactCandidate} ArtifactCandidate
 */

/**
 * @param {string} cwd абсолютний корінь consumer-репо
 * @returns {ReturnType<typeof collectCiArtifactContributions>} результат {@link collectCiArtifactContributions} для `ci:github`
 */
export function collectArtifacts(cwd) {
  return collectCiArtifactContributions(cwd, TARGET_CAPABILITY)
}
