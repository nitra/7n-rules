/**
 * Спільний collect+collision helper для generic `ci.artifact@1` consumer-ів (spec
 * `2026-07-27-universal-plugin-slots-lang-php-extraction`, §7.2, §7.3, §9.10, Фаза 3):
 * `@7n/rules-ci-github` і `@7n/rules-ci-azure` потребують ІДЕНТИЧНИЙ collect+collision-контракт,
 * розрізняючись лише `targetCapability`-фільтром — provider-specific diagnose/fix лишається у
 * кожного consumer-а окремо (spec §2 рішення Б).
 *
 * Окремий файл від `slot-contracts-ci.mjs` (а не той самий модуль) — навмисно: цей модуль читає
 * slot graph (`plugin-slots.mjs`), який сам імпортує `plugin-api.mjs` (`PLUGIN_API_VERSION`);
 * `plugin-api.mjs` re-експортує payload-контракт з `slot-contracts-ci.mjs` (spec §3.3). Якби
 * graph-читання жило в `slot-contracts-ci.mjs`, вийшов би import-цикл
 * `plugin-api → slot-contracts-ci → plugin-slots → plugin-api`. Тому цей модуль НЕ
 * ре-експортується через `@7n/rules/plugin-api` — плагіни імпортують його напряму через
 * `@7n/rules/scripts/lib/ci-artifact-collect.mjs`.
 */
import { getSlotContributions, resolveSlotGraph } from './plugin-slots.mjs'
import { readNRulesConfigLite } from './read-n-rules-config-lite.mjs'
import { loadCiArtifactPayload, validateCiArtifactPayload } from './slot-contracts-ci.mjs'

/**
 * @typedef {import('./slot-contracts-ci.mjs').CiArtifactCandidate} CiArtifactCandidate
 */

/**
 * Групує `candidates` за `artifactId` і виявляє domain collision (spec §9.10): той самий
 * `artifactId` від ДВОХ РІЗНИХ contributions (різний `(pluginName, id)`) — hard error з
 * provenance обох. Provider-agnostic — спільна для GitHub- і Azure-consumer-ів (той самий
 * collision-контракт, spec §9.10 не розрізняє provider).
 * @param {CiArtifactCandidate[]} candidates кандидати з валідним payload для цільової capability
 * @returns {{ relevant: CiArtifactCandidate[], collisions: Array<{ artifactId: string, group: CiArtifactCandidate[] }> }} відфільтровані (без колізій) + самі колізії
 */
function splitCiArtifactCollisions(candidates) {
  /** @type {Map<string, CiArtifactCandidate[]>} */
  const byArtifactId = new Map()
  for (const c of candidates) {
    const list = byArtifactId.get(c.descriptor.artifactId) ?? []
    list.push(c)
    byArtifactId.set(c.descriptor.artifactId, list)
  }

  const collisions = []
  const collidedIds = new Set()
  for (const [artifactId, group] of byArtifactId) {
    const distinctSources = new Set(group.map(g => `${g.contribution.pluginName}::${g.contribution.id}`))
    if (distinctSources.size > 1) {
      collidedIds.add(artifactId)
      collisions.push({ artifactId, group })
    }
  }

  return { relevant: candidates.filter(c => !collidedIds.has(c.descriptor.artifactId)), collisions }
}

/**
 * Збирає `ci.artifact@1` contributions, релевантні для `targetCapability` цього consumer-а.
 * @param {string} cwd абсолютний корінь consumer-репо
 * @param {string} targetCapability capability цього consumer-а (напр. `ci:github`)
 * @returns {Promise<{ relevant: CiArtifactCandidate[], collisions: Array<{ artifactId: string, group: CiArtifactCandidate[] }>, errors: Array<{ contribution: import('./plugin-slots.mjs').SlotContribution, reason: string }> }>}
 *   `relevant` — валідні contributions без колізій у graph-порядку (resolved plugin order →
 *   manifest order, spec рішення З); `collisions` — domain collision-и (§9.10); `errors` —
 *   contributions з невалідним/нечитабельним payload
 */
export async function collectCiArtifactContributions(cwd, targetCapability) {
  const config = await readNRulesConfigLite(cwd)
  const graph = resolveSlotGraph(cwd, config, { allowInstall: false, quiet: true })
  const contributions = getSlotContributions(graph, 'ci.artifact', [1])

  /** @type {CiArtifactCandidate[]} */
  const candidates = []
  const errors = []
  for (const contribution of contributions) {
    const loaded = loadCiArtifactPayload(contribution)
    if (!loaded.ok) {
      errors.push({ contribution, reason: loaded.errors.join('; ') })
      continue
    }
    const validated = validateCiArtifactPayload(loaded.raw)
    if (!validated.ok) {
      errors.push({ contribution, reason: validated.errors.join('; ') })
      continue
    }
    if (validated.descriptor.targetCapability !== targetCapability) continue
    candidates.push({ contribution, descriptor: validated.descriptor })
  }

  const { relevant, collisions } = splitCiArtifactCollisions(candidates)
  return { relevant, collisions, errors }
}

/**
 * Репортить invalid-payload/collision діагностики, спільні для generic-consumer-ів обох
 * providers (винесено з provider `main.mjs` — той самий текст/reason для обох, лише
 * provider-specific `reportArtifact` різний).
 * @param {{ fail: (msg: string, opts?: { reason?: string, file?: string, data?: object }) => void }} reporter `createViolationReporter(ctx)`-сумісний reporter
 * @param {{ errors: Array<{ contribution: import('./plugin-slots.mjs').SlotContribution, reason: string }>, collisions: Array<{ artifactId: string, group: CiArtifactCandidate[] }> }} collected результат {@link collectCiArtifactContributions}
 * @returns {void}
 */
export function reportCiArtifactCollectionDiagnostics(reporter, collected) {
  for (const { contribution, reason } of collected.errors) {
    reporter.fail(`ci.artifact contribution "${contribution.id}" (${contribution.pluginName}) — невалідний payload: ${reason}`, {
      reason: 'invalid-payload'
    })
  }
  for (const { artifactId, group } of collected.collisions) {
    const provenance = group.map(g => `${g.contribution.pluginName}#${g.contribution.id}`).join(', ')
    reporter.fail(
      `ci.artifact "${artifactId}": колізія — кілька contributions претендують на той самий артефакт (${provenance})`,
      { reason: 'artifact-id-collision' }
    )
  }
}
