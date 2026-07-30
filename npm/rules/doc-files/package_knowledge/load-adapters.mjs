/**
 * Матеріалізує package-knowledge adapters через універсальний plugin slot bus.
 *
 * Loader вимагає явні repository/domain roots і повертає лише повний валідний
 * набір adapters. Broken resource, contract mismatch або відсутній extractor
 * для потрібного extension є blocking diagnostic без whole-file fallback.
 */

import { realpath } from 'node:fs/promises'
import { isAbsolute, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import { getSlotContributions, resolveSlotGraph } from '../../../scripts/lib/plugin-slots.mjs'

const DOMAIN_SLOT = 'knowledge.domain'
const EXTRACTOR_SLOT = 'knowledge.extractor'
const SLOT_VERSION = 1

/**
 * @typedef {object} KnowledgeAdapterDiagnostic
 * @property {'error'} severity diagnostic severity
 * @property {true} blocking чи блокує publication
 * @property {string} code stable machine code
 * @property {string | null} slot owning slot
 * @property {string | null} plugin provider package
 * @property {string | null} contributionId provider contribution ID
 * @property {string} message user-facing explanation
 */

/**
 * @typedef {object} KnowledgeDomainAdapter
 * @property {string} id stable adapter ID
 * @property {1} apiVersion knowledge contract version
 * @property {string} ecosystem owning ecosystem
 * @property {(repoRoot: string) => object[] | Promise<object[]>} findDomains domain discovery
 * @property {(path: string) => object | Promise<object>} resolveDomain path ownership resolver
 */

/**
 * @typedef {object} KnowledgeExtractorAdapter
 * @property {string} id stable adapter ID
 * @property {1} apiVersion knowledge contract version
 * @property {string[]} extensions owned source extensions
 * @property {{ id: string, grammarVersion: string, runtimeVersion: string }} parser parser provenance
 * @property {(input: { domain: object, file: { path: string, content: string, contentHash: string }, signal?: AbortSignal }) => object | Promise<object>} analyzeFile fail-closed file analysis
 * @property {((input: { file: { path: string, content: string, contentHash?: string } }) => object | Promise<object>) | undefined} collectTestScenarios optional full-parser active test collector
 */

/**
 * Створює blocking diagnostic у єдиній формі для caller-а knowledge pipeline.
 * @param {string} code стабільний машинний код
 * @param {string | null} slot slot або null для помилки кореня
 * @param {string | null} plugin npm-імʼя плагіна
 * @param {string | null} contributionId id contribution-а
 * @param {string} message пояснення українською
 * @returns {KnowledgeAdapterDiagnostic} immutable diagnostic
 */
function blockingDiagnostic(code, slot, plugin, contributionId, message) {
  return Object.freeze({ severity: 'error', blocking: true, code, slot, plugin, contributionId, message })
}

/**
 * Нормалізує явний абсолютний root і не дозволяє loader-у непомітно підмінити його `cwd`.
 * @param {unknown} value repoRoot або domainRoot від caller-а
 * @param {'repoRoot' | 'domainRoot'} name назва аргументу для diagnostic
 * @returns {Promise<{ ok: true, path: string } | { ok: false, diagnostic: KnowledgeAdapterDiagnostic }>} normalized root або diagnostic
 */
async function resolveExplicitRoot(value, name) {
  if (typeof value !== 'string' || !isAbsolute(value)) {
    return {
      ok: false,
      diagnostic: blockingDiagnostic(
        'invalid-root',
        null,
        null,
        null,
        `${name} має бути явним абсолютним шляхом; loader не використовує process.cwd().`
      )
    }
  }
  try {
    return { ok: true, path: await realpath(resolve(value)) }
  } catch {
    return {
      ok: false,
      diagnostic: blockingDiagnostic('root-not-found', null, null, null, `${name} не існує або недоступний: ${value}.`)
    }
  }
}

/**
 * Повертає true, коли `child` лежить у `parent` або збігається з ним.
 * @param {string} parent реальний repoRoot
 * @param {string} child реальний domainRoot
 * @returns {boolean} чи належить domain репозиторію
 */
function isWithin(parent, child) {
  const rel = relative(parent, child)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

/**
 * Валідує default export одного domain adapter-а без запуску його semantic logic.
 * @param {unknown} adapter default export resource-модуля
 * @param {import('../../../scripts/lib/plugin-slots.mjs').SlotContribution} contribution provenance slot bus
 * @returns {KnowledgeDomainAdapter | null} адаптер або null при невалідній формі
 */
function validateDomainAdapter(adapter, contribution) {
  if (!adapter || typeof adapter !== 'object') return null
  if (
    adapter.id !== contribution.id ||
    adapter.apiVersion !== SLOT_VERSION ||
    typeof adapter.ecosystem !== 'string' ||
    adapter.ecosystem.length === 0 ||
    typeof adapter.findDomains !== 'function' ||
    typeof adapter.resolveDomain !== 'function'
  ) {
    return null
  }
  return Object.freeze({
    id: adapter.id,
    apiVersion: adapter.apiVersion,
    ecosystem: adapter.ecosystem,
    findDomains: adapter.findDomains,
    resolveDomain: adapter.resolveDomain
  })
}

/**
 * Валідує default export extractor-а та його ownership розширень.
 * @param {unknown} adapter default export resource-модуля
 * @param {import('../../../scripts/lib/plugin-slots.mjs').SlotContribution} contribution provenance slot bus
 * @returns {KnowledgeExtractorAdapter | null} адаптер або null при невалідній формі
 */
function validateExtractorAdapter(adapter, contribution) {
  if (!adapter || typeof adapter !== 'object') return null
  if (
    adapter.id !== contribution.id ||
    adapter.apiVersion !== SLOT_VERSION ||
    typeof adapter.analyzeFile !== 'function' ||
    !adapter.parser ||
    typeof adapter.parser !== 'object' ||
    !Array.isArray(adapter.extensions)
  ) {
    return null
  }
  const { parser } = adapter
  if (
    typeof parser.id !== 'string' ||
    parser.id.length === 0 ||
    typeof parser.grammarVersion !== 'string' ||
    parser.grammarVersion.length === 0 ||
    typeof parser.runtimeVersion !== 'string' ||
    parser.runtimeVersion.length === 0
  ) {
    return null
  }
  if (
    adapter.extensions.length === 0 ||
    adapter.extensions.some(extension => typeof extension !== 'string' || !extension.startsWith('.'))
  ) {
    return null
  }
  if (new Set(adapter.extensions).size !== adapter.extensions.length) return null
  return Object.freeze({
    id: adapter.id,
    apiVersion: adapter.apiVersion,
    extensions: Object.freeze([...adapter.extensions]),
    parser: Object.freeze({
      id: parser.id,
      grammarVersion: parser.grammarVersion,
      runtimeVersion: parser.runtimeVersion
    }),
    analyzeFile: adapter.analyzeFile,
    ...(typeof adapter.collectTestScenarios === 'function' && { collectTestScenarios: adapter.collectTestScenarios })
  })
}

/**
 * Завантажує один resource adapter. Будь-яка помилка materialization — blocking: knowledge
 * publication не може перейти на whole-file або інший неявний fallback.
 * @param {import('../../../scripts/lib/plugin-slots.mjs').SlotContribution} contribution contribution з slot bus
 * @param {string} slot slot для diagnostic
 * @param {(adapter: unknown, contribution: import('../../../scripts/lib/plugin-slots.mjs').SlotContribution) => object | null} validate контрактна валідація adapter-а
 * @returns {Promise<{ adapter: object } | { diagnostic: KnowledgeAdapterDiagnostic }>} adapter або blocking diagnostic
 */
async function loadAdapter(contribution, slot, validate) {
  if (contribution.resourcePath === null) {
    return {
      diagnostic: blockingDiagnostic(
        'adapter-resource-required',
        slot,
        contribution.pluginName,
        contribution.id,
        `${contribution.pluginName}:${contribution.id} для ${slot}@${SLOT_VERSION} має посилатися на ESM resource.`
      )
    }
  }
  try {
    // eslint-disable-next-line no-unsanitized/method -- plugin slot resolver supplies a real resource path inside the explicit repository root
    const mod = await import(pathToFileURL(contribution.resourcePath).href)
    const adapter = validate(mod.default, contribution)
    if (!adapter) {
      return {
        diagnostic: blockingDiagnostic(
          'malformed-adapter',
          slot,
          contribution.pluginName,
          contribution.id,
          `${contribution.pluginName}:${contribution.id} не відповідає контракту ${slot}@${SLOT_VERSION}.`
        )
      }
    }
    return { adapter }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    return {
      diagnostic: blockingDiagnostic(
        'adapter-import-failed',
        slot,
        contribution.pluginName,
        contribution.id,
        `${contribution.pluginName}:${contribution.id} не завантажився для ${slot}@${SLOT_VERSION}: ${detail}`
      )
    }
  }
}

/* eslint-disable sonarjs/cognitive-complexity -- validation pipeline keeps blocking invariants in one atomic return boundary */
/**
 * Матеріалізує мовні knowledge adapters через універсальний slot bus. `repoRoot` і
 * `domainRoot` обовʼязкові та явні: loader не визначає domain boundary і не читає `cwd`.
 * Він повертає `adapters: null` за першої blocking-проблеми, тому caller фізично не може
 * продовжити з частковим набором або whole-file fallback.
 * @param {{ repoRoot: string, domainRoot: string, config?: { plugins?: unknown } | null, requiredExtensions?: string[] }} input roots, config і файли domain-а, що треба аналізувати
 * @returns {Promise<object>} complete adapter set або blocking diagnostics
 */
export async function loadKnowledgeAdapters(input) {
  const repo = await resolveExplicitRoot(input?.repoRoot, 'repoRoot')
  if (!repo.ok) return Object.freeze({ blocked: true, diagnostics: Object.freeze([repo.diagnostic]), adapters: null })

  const domain = await resolveExplicitRoot(input?.domainRoot, 'domainRoot')
  if (!domain.ok)
    return Object.freeze({ blocked: true, diagnostics: Object.freeze([domain.diagnostic]), adapters: null })
  if (!isWithin(repo.path, domain.path)) {
    const diagnostic = blockingDiagnostic(
      'domain-outside-repository',
      null,
      null,
      null,
      `domainRoot ${domain.path} має лежати в repoRoot ${repo.path}.`
    )
    return Object.freeze({ blocked: true, diagnostics: Object.freeze([diagnostic]), adapters: null })
  }

  const graph = resolveSlotGraph(repo.path, input?.config ?? {}, { allowInstall: false, quiet: true })
  const relevantDiagnostics = graph.diagnostics
    .filter(
      diagnostic => diagnostic.severity === 'error' && [DOMAIN_SLOT, EXTRACTOR_SLOT].includes(diagnostic.slot ?? '')
    )
    .map(diagnostic =>
      blockingDiagnostic(`slot-${diagnostic.code}`, diagnostic.slot, diagnostic.plugin, null, diagnostic.message)
    )
  if (relevantDiagnostics.length > 0) {
    return Object.freeze({ blocked: true, diagnostics: Object.freeze(relevantDiagnostics), adapters: null })
  }

  const domainContributions = getSlotContributions(graph, DOMAIN_SLOT, [SLOT_VERSION])
  const extractorContributions = getSlotContributions(graph, EXTRACTOR_SLOT, [SLOT_VERSION])
  /** @type {KnowledgeAdapterDiagnostic[]} */
  const diagnostics = []

  const loadedDomains = await Promise.all(
    domainContributions.map(contribution => loadAdapter(contribution, DOMAIN_SLOT, validateDomainAdapter))
  )
  const loadedExtractors = await Promise.all(
    extractorContributions.map(contribution => loadAdapter(contribution, EXTRACTOR_SLOT, validateExtractorAdapter))
  )
  for (const loaded of [...loadedDomains, ...loadedExtractors]) {
    if ('diagnostic' in loaded) diagnostics.push(loaded.diagnostic)
  }
  if (diagnostics.length > 0)
    return Object.freeze({ blocked: true, diagnostics: Object.freeze(diagnostics), adapters: null })

  /** @type {KnowledgeDomainAdapter[]} */
  const domainAdapters = loadedDomains.map(loaded => loaded.adapter)
  /** @type {KnowledgeExtractorAdapter[]} */
  const extractorAdapters = loadedExtractors.map(loaded => loaded.adapter)
  const duplicateIds = new Set()
  for (const [slot, adapters] of [
    [DOMAIN_SLOT, domainAdapters],
    [EXTRACTOR_SLOT, extractorAdapters]
  ]) {
    const seen = new Set()
    for (const adapter of adapters) {
      if (seen.has(adapter.id)) duplicateIds.add(`${slot}:${adapter.id}`)
      seen.add(adapter.id)
    }
  }
  for (const duplicate of duplicateIds) {
    const [slot, contributionId] = duplicate.split(':')
    diagnostics.push(
      blockingDiagnostic(
        'duplicate-adapter-id',
        slot,
        null,
        contributionId,
        `Кілька provider-ів ${slot}@${SLOT_VERSION} мають id ${contributionId}.`
      )
    )
  }
  const extensionOwners = new Map()
  for (const adapter of extractorAdapters) {
    for (const extension of adapter.extensions) {
      const owner = extensionOwners.get(extension)
      if (owner) {
        diagnostics.push(
          blockingDiagnostic(
            'duplicate-extractor-extension',
            EXTRACTOR_SLOT,
            null,
            adapter.id,
            `Розширення ${extension} одночасно належить extractor-ам ${owner} і ${adapter.id}.`
          )
        )
      } else {
        extensionOwners.set(extension, adapter.id)
      }
    }
  }
  const requiredExtensions = input?.requiredExtensions ?? []
  if (
    !Array.isArray(requiredExtensions) ||
    requiredExtensions.some(extension => typeof extension !== 'string' || !extension.startsWith('.'))
  ) {
    diagnostics.push(
      blockingDiagnostic(
        'invalid-required-extension',
        EXTRACTOR_SLOT,
        null,
        null,
        'requiredExtensions має бути масивом розширень на кшталт .js.'
      )
    )
  } else {
    for (const extension of [...new Set(requiredExtensions)].toSorted()) {
      if (!extensionOwners.has(extension)) {
        diagnostics.push(
          blockingDiagnostic(
            'missing-extractor-extension',
            EXTRACTOR_SLOT,
            null,
            null,
            `Не знайдено ${EXTRACTOR_SLOT}@${SLOT_VERSION} для required extension ${extension}.`
          )
        )
      }
    }
  }
  if (diagnostics.length > 0)
    return Object.freeze({ blocked: true, diagnostics: Object.freeze(diagnostics), adapters: null })

  return Object.freeze({
    blocked: false,
    diagnostics: Object.freeze([]),
    adapters: Object.freeze({ domain: Object.freeze(domainAdapters), extractor: Object.freeze(extractorAdapters) })
  })
}
/* eslint-enable sonarjs/cognitive-complexity */
