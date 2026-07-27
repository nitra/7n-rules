/**
 * Тонка обгортка над `collectCiArtifactContributions`
 * (`@7n/rules/scripts/lib/ci-artifact-collect.mjs`) з capability цього consumer-а (spec
 * `2026-07-27-universal-plugin-slots-lang-php-extraction`, §7.3, Фаза 3). Спільна логіка
 * (collect + collision-детекція) живе в `@7n/rules`'s `ci-artifact-collect.mjs` — той самий
 * контракт, що й `@7n/rules-ci-github`, розрізняючись лише capability-фільтром.
 */
import { collectCiArtifactContributions } from '@7n/rules/scripts/lib/ci-artifact-collect.mjs'

/** Capability, для якої релевантні contributions цього consumer-а. */
const TARGET_CAPABILITY = 'ci:azure'

/**
 * @typedef {import('@7n/rules/scripts/lib/slot-contracts-ci.mjs').CiArtifactCandidate} ArtifactCandidate
 */

/**
 * @param {string} cwd абсолютний корінь consumer-репо
 * @returns {ReturnType<typeof collectCiArtifactContributions>} результат {@link collectCiArtifactContributions} для `ci:azure`
 */
export function collectArtifacts(cwd) {
  return collectCiArtifactContributions(cwd, TARGET_CAPABILITY)
}
