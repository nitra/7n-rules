/**
 * Universal typed slot bus для плагінів `@7n/rules` (spec
 * `2026-07-27-universal-plugin-slots-lang-php-extraction`, Фаза 1 — контракт і broker).
 *
 * Один плагін-маніфест (`package.json#n-rules`) може декларувати `slots.provides` (contributions —
 * immutable дані чи посилання на package-relative resource) і `slots.consumes` (consumers — які
 * версії слоту surface вміє матеріалізувати, і через який handler-модуль). Цей модуль:
 *
 * - резолвить усі `requiresPluginApi === 2` плагіни (через наявний {@link resolvePlugins}) у один
 *   immutable граф contributions/consumers/diagnostics (`resolveSlotGraph`, СИНХРОННО — той самий
 *   hot-path-контракт, що вже мав `getDocFilesExtensions`: hook на кожен файл не може платити за
 *   динамічний import);
 * - валідує envelope (slot/version/id regex, рівно один з resource/value, безпечність шляху —
 *   без абсолютних шляхів, `..`-сегментів і symlink escape за межі packageRoot);
 * - НІКОЛИ не читає вміст `resource` і не імпортує consumer-handler під час discovery — це
 *   принципово унеможливлює runtime-цикли contributions→contributions (рішення І spec, §2);
 *   імпорт відбувається лише в {@link loadSlotConsumer}, яку викликає сам surface, що знає, який
 *   slot він матеріалізує.
 *
 * Плагіни без `requiresPluginApi === 2` (усі, що існують станом на Фазу 1 — жоден маніфест його ще
 * не декларує) не потрапляють у граф — вони отримують diagnostic і далі обслуговуються legacy
 * `contributes`-поверхнями `resolve-plugins.mjs` без змін (Фаза 2 видаляє legacy шлях, не ця
 * фаза). Це навмисний перехідний стан.
 */
import { existsSync, realpathSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, resolve as resolvePath, sep } from 'node:path'
import { pathToFileURL } from 'node:url'

import { PLUGIN_API_VERSION } from './plugin-api.mjs'
import { resolvePlugins } from './resolve-plugins.mjs'

/** Slot id: lowercase dot/dash-separated, мінімум два сегменти (spec §3.2). */
const SLOT_RE = /^[a-z][a-z0-9]*(?:[.-][a-z][a-z0-9]*)+$/u
/** Contribution/consumer id: стабільний plugin-local identifier (spec §3.2). */
const ID_RE = /^[a-z][a-z0-9-]*$/u
/** Поля, заборонені у contribution envelope (v1 — жодного прихованого ordering, spec §3.2/рішення З). */
const FORBIDDEN_CONTRIBUTION_FIELDS = ['priority', 'before', 'after']

/**
 * @typedef {object} SlotDiagnostic
 * @property {'error' | 'warning'} severity `error` — hard-порушення контракту (§9); `warning` —
 *   очікуваний перехідний стан (напр. плагін без `requiresPluginApi: 2`)
 * @property {string} code стабільний машинний код (напр. `missing-resource`, `version-mismatch`)
 * @property {string} plugin npm-ім'я плагіна-джерела діагностики
 * @property {string | null} slot slot id, якщо застосовний
 * @property {number | null} version версія слоту, якщо застосовна
 * @property {string} message зрозуміле людині пояснення (українською)
 */

/**
 * @typedef {object} SlotContribution
 * @property {string} pluginName npm-ім'я плагіна-контриб'ютора
 * @property {string} packageRoot абсолютний корінь пакета плагіна
 * @property {string} slot slot id
 * @property {number} version версія слоту (positive integer)
 * @property {string} id стабільний plugin-local identifier contribution-у
 * @property {string | null} resourcePath абсолютний (realpath) шлях ресурсу — `null`, якщо contribution через `value`
 * @property {unknown} value inline JSON-value payload — `undefined`, якщо contribution через `resource`
 * @property {number} manifestIndex позиція у `slots.provides` маніфесту (стабільний tie-break порядку)
 * @property {{ capabilities: string[] }} requires опційні capability-вимоги contribution-у
 */

/**
 * @typedef {object} SlotConsumer
 * @property {string} pluginName npm-ім'я плагіна-консюмера
 * @property {string} packageRoot абсолютний корінь пакета плагіна
 * @property {string} slot slot id, який споживається
 * @property {number[]} versions підтримувані версії слоту (непорожній, унікальні positive integers)
 * @property {string} handlerPath абсолютний (realpath) шлях до handler-модуля (НЕ імпортований)
 * @property {number} manifestIndex позиція у `slots.consumes` маніфесту
 */

/**
 * @typedef {object} SlotGraph
 * @property {Array<{ name: string, packageRoot: string }>} plugins плагіни, що увійшли у граф (`requiresPluginApi === 2`), у порядку resolvePlugins
 * @property {Set<string>} capabilities активні capabilities з УСІХ наявних плагінів (resolvePlugins, не лише graph-учасників — capability-гейт має лишатись коректним і під час поетапної Фази 2-міграції, коли частина плагінів ще на legacy-маніфесті)
 * @property {SlotContribution[]} contributions усі валідні contributions, у детермінованому порядку (resolved plugin order → manifest order, spec рішення З)
 * @property {SlotConsumer[]} consumers усі валідні consumers, у тому самому порядку
 * @property {SlotDiagnostic[]} diagnostics діагностики discovery/validation (§9) — no-consumer НЕ породжує diagnostic (§9.5, silent no-op)
 */

/** Кеш графа на процес: cacheKey → {@link SlotGraph}. Ключ узгоджений з {@link resolvePlugins} — той самий `(root, names, allowInstall)`. */
const SLOT_GRAPH_CACHE = new Map()

/**
 * Best-effort realpath: для наявного шляху — повний realpath; для ще-неіснуючого — realpath
 * найближчого наявного предка + залишок сегментів. Потрібен, щоб і "resource не знайдено", і
 * "symlink escape" перевірялись ОДНИМ і тим самим containment-кодом незалежно від того, чи
 * resource вже існує на диску (та ж проблема, що `realpathBestEffort` у
 * `lint-surface/collateral-veto.mjs`, але локальна копія — окремий шар, без крос-імпорту).
 * @param {string} p абсолютний шлях
 * @returns {string} realpath або найкраще наближення
 */
function bestEffortRealpath(p) {
  try {
    return realpathSync(p)
  } catch {
    const parent = dirname(p)
    if (parent === p) return p
    return join(bestEffortRealpath(parent), basename(p))
  }
}

/**
 * Чи `target` дорівнює `root` або лежить під ним (обидва — вже realpath-нормалізовані).
 * @param {string} root containment-межа
 * @param {string} target перевірюваний шлях
 * @returns {boolean} true — у межах
 */
function isContained(root, target) {
  return target === root || target.startsWith(root + sep)
}

/**
 * Безпечний резолв package-relative шляху (`resource`/`handler`, spec §3.2/§3.3): має починатись
 * з `./`, не бути абсолютним, не містити `..`-сегментів, і після realpath лишатись у межах
 * `packageRoot` (symlink escape заблокований). Не читає вміст файлу — лише перевіряє існування
 * (`exists`), щоб виклик міг відрізнити "unsafe path" (§9.3) від "missing resource" (§9.4).
 * @param {string} packageRoot абсолютний корінь пакета плагіна
 * @param {unknown} relPath сире значення поля з маніфесту
 * @returns {{ ok: true, absPath: string, exists: boolean } | { ok: false, reason: string }} результат перевірки
 */
function resolveSafePackagePath(packageRoot, relPath) {
  if (typeof relPath !== 'string' || relPath.length === 0)
    return { ok: false, reason: 'шлях має бути непорожнім рядком' }
  if (isAbsolute(relPath)) return { ok: false, reason: 'абсолютний шлях заборонений' }
  if (!relPath.startsWith('./')) return { ok: false, reason: 'шлях має починатися з "./"' }
  if (relPath.split('/').includes('..')) return { ok: false, reason: '".." сегменти заборонені' }

  const packageRootReal = bestEffortRealpath(resolvePath(packageRoot))
  const candidate = resolvePath(packageRoot, relPath)
  const candidateReal = bestEffortRealpath(candidate)
  if (!isContained(packageRootReal, candidateReal)) {
    return { ok: false, reason: 'symlink escape поза межі пакета' }
  }
  return { ok: true, absPath: candidateReal, exists: existsSync(candidate) }
}

/**
 * Конструктор {@link SlotDiagnostic} (заморожений — граф immutable).
 * @param {SlotDiagnostic['severity']} severity рівень
 * @param {string} code машинний код
 * @param {string} plugin npm-ім'я плагіна
 * @param {string | null} slot slot id або null
 * @param {number | null} version версія слоту або null
 * @param {string} message повідомлення
 * @returns {SlotDiagnostic} заморожена діагностика
 */
function diagnostic(severity, code, plugin, slot, version, message) {
  return Object.freeze({ severity, code, plugin, slot: slot ?? null, version: version ?? null, message })
}

/**
 * Валідує опційний блок `requires.capabilities` contribution-у.
 * @param {unknown} requires сире значення поля `requires`
 * @returns {{ ok: true, capabilities: string[] } | { ok: false, reason: string }} результат
 */
function readRequiresCapabilities(requires) {
  if (requires === undefined) return { ok: true, capabilities: [] }
  if (requires === null || typeof requires !== 'object' || Array.isArray(requires)) {
    return { ok: false, reason: 'requires має бути обʼєктом' }
  }
  if (requires.capabilities === undefined) return { ok: true, capabilities: [] }
  if (!Array.isArray(requires.capabilities) || requires.capabilities.some(c => typeof c !== 'string')) {
    return { ok: false, reason: 'requires.capabilities має бути масивом рядків' }
  }
  return { ok: true, capabilities: requires.capabilities }
}

/**
 * Резолвить payload contribution-у (`resource` XOR `value`, вже перевірене викликачем) —
 * path-безпека БЕЗУМОВНА, `missing-resource` (§9.4) — лише коли `capabilitiesSatisfied`
 * (capability-gated-off resource ніколи не читається, spec §12 acceptance).
 * @param {{ hasResource: boolean, resource: unknown, rawValue: unknown, packageRoot: string, capabilitiesSatisfied: boolean }} args вхід
 * @returns {{ ok: true, resourcePath: string | null, value: unknown } | { ok: false, code: 'unsafe-resource-path' | 'missing-resource', reason: string }} результат
 */
function resolveContributionPayload({ hasResource, resource, rawValue, packageRoot, capabilitiesSatisfied }) {
  if (!hasResource) return { ok: true, resourcePath: null, value: rawValue }

  const safe = resolveSafePackagePath(packageRoot, resource)
  if (!safe.ok) return { ok: false, code: 'unsafe-resource-path', reason: safe.reason }
  if (capabilitiesSatisfied && !safe.exists) {
    return { ok: false, code: 'missing-resource', reason: `не знайдено (${safe.absPath})` }
  }
  return { ok: true, resourcePath: safe.absPath, value: undefined }
}

/**
 * Валідує один елемент `slots.provides` (envelope §3.2) і резолвить безпечний provenance.
 * Не кидає винятків — повертає або валідну contribution, або diagnostic; hard-помилки (§9.3,
 * §9.4, §9.8) представлені як `severity: 'error'` diagnostic, не exception — так само, як
 * `resolvePlugins` graceful-скіпає биті плагіни (fail-safe hot-path). Розбита на
 * {@link readRequiresCapabilities}/{@link resolveContributionPayload} — інакше єдина функція
 * з усіма envelope-перевірками перевищує поріг когнітивної складності лінтера.
 * @param {{ raw: unknown, pluginName: string, packageRoot: string, manifestIndex: number, activeCapabilities: Set<string> }} args вхід
 * @returns {{ contribution: SlotContribution } | { diagnostic: SlotDiagnostic }} результат
 */
function validateContribution({ raw, pluginName, packageRoot, manifestIndex, activeCapabilities }) {
  const fail = (code, slot, version, message) => ({
    diagnostic: diagnostic('error', code, pluginName, slot, version, message)
  })

  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return fail('invalid-contribution', null, null, `${pluginName}: slots.provides[${manifestIndex}] не є обʼєктом.`)
  }
  const { slot, version, id, resource } = raw

  if (typeof slot !== 'string' || !SLOT_RE.test(slot)) {
    return fail(
      'invalid-slot-id',
      typeof slot === 'string' ? slot : null,
      null,
      `${pluginName}: slot "${String(slot)}" не відповідає ${SLOT_RE} (provides[${manifestIndex}]).`
    )
  }
  if (!Number.isSafeInteger(version) || version < 1) {
    return fail(
      'invalid-version',
      slot,
      null,
      `${pluginName}: version слоту "${slot}" має бути positive integer, отримано ${JSON.stringify(version)}.`
    )
  }
  if (typeof id !== 'string' || !ID_RE.test(id)) {
    return fail(
      'invalid-contribution-id',
      slot,
      version,
      `${pluginName}: id "${String(id)}" слоту "${slot}"@${version} не відповідає ${ID_RE}.`
    )
  }
  const forbidden = FORBIDDEN_CONTRIBUTION_FIELDS.filter(f => Object.hasOwn(raw, f))
  if (forbidden.length > 0) {
    return fail(
      'forbidden-field',
      slot,
      version,
      `${pluginName}: contribution "${id}" заборонені поля ${forbidden.join(', ')} (v1 не має прихованого ordering, spec рішення З).`
    )
  }
  const hasResource = typeof resource === 'string'
  const hasValue = Object.hasOwn(raw, 'value')
  if (hasResource === hasValue) {
    return fail(
      'invalid-payload-shape',
      slot,
      version,
      `${pluginName}: contribution "${id}" слоту "${slot}"@${version} має мати РІВНО ОДНЕ з resource/value.`
    )
  }

  const requiresResult = readRequiresCapabilities(raw.requires)
  if (!requiresResult.ok) {
    return fail('invalid-requires', slot, version, `${pluginName}: ${requiresResult.reason} (contribution "${id}").`)
  }
  const { capabilities: requiresCapabilities } = requiresResult
  const capabilitiesSatisfied = requiresCapabilities.every(cap => activeCapabilities.has(cap))

  const payload = resolveContributionPayload({
    hasResource,
    resource,
    rawValue: raw.value,
    packageRoot,
    capabilitiesSatisfied
  })
  if (!payload.ok) {
    return fail(
      payload.code,
      slot,
      version,
      `${pluginName}: resource "${resource}" contribution-у "${id}" (${slot}@${version}) — ${payload.reason}.`
    )
  }

  return {
    contribution: Object.freeze({
      pluginName,
      packageRoot,
      slot,
      version,
      id,
      resourcePath: payload.resourcePath,
      value: payload.value,
      manifestIndex,
      requires: Object.freeze({ capabilities: Object.freeze([...requiresCapabilities]) })
    })
  }
}

/**
 * Валідує один елемент `slots.consumes` (envelope §3.3). Так само fail-safe (diagnostic, не
 * throw) і так само НЕ читає/імпортує `handler` — лише перевіряє безпечність шляху.
 * @param {{ raw: unknown, pluginName: string, packageRoot: string, manifestIndex: number }} args вхід
 * @returns {{ consumer: SlotConsumer } | { diagnostic: SlotDiagnostic }} результат
 */
function validateConsumer({ raw, pluginName, packageRoot, manifestIndex }) {
  const fail = (code, slot, message) => ({ diagnostic: diagnostic('error', code, pluginName, slot, null, message) })

  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return fail('invalid-consumer', null, `${pluginName}: slots.consumes[${manifestIndex}] не є обʼєктом.`)
  }
  const { slot, versions, handler } = raw
  if (typeof slot !== 'string' || !SLOT_RE.test(slot)) {
    return fail(
      'invalid-slot-id',
      typeof slot === 'string' ? slot : null,
      `${pluginName}: slot "${String(slot)}" не відповідає ${SLOT_RE} (consumes[${manifestIndex}]).`
    )
  }
  const uniqueVersions = new Set(versions)
  const versionsValid =
    Array.isArray(versions) &&
    versions.length > 0 &&
    uniqueVersions.size === versions.length &&
    versions.every(v => Number.isSafeInteger(v) && v >= 1)
  if (!versionsValid) {
    return fail(
      'invalid-consumer-versions',
      slot,
      `${pluginName}: versions consumer-а слоту "${slot}" мають бути непорожнім масивом унікальних positive integers.`
    )
  }
  const safe = resolveSafePackagePath(packageRoot, handler)
  if (!safe.ok) {
    return fail(
      'unsafe-handler-path',
      slot,
      `${pluginName}: handler "${String(handler)}" consumer-а слоту "${slot}" — ${safe.reason}.`
    )
  }

  return {
    consumer: Object.freeze({
      pluginName,
      packageRoot,
      slot,
      versions: Object.freeze([...versions]),
      handlerPath: safe.absPath,
      manifestIndex
    })
  }
}

/**
 * Читає масив `rawSlots[field]` (`provides`/`consumes`) з diagnostic при невалідній формі.
 * Відсутнє поле — легітимний стан (плагін не має жодного provides або consumes), без diagnostic.
 * @param {{ provides?: unknown, consumes?: unknown } | null} rawSlots сирий блок `slots` з маніфесту
 * @param {'provides' | 'consumes'} field яке поле читати
 * @param {string} pluginName npm-ім'я плагіна (для diagnostic)
 * @param {SlotDiagnostic[]} diagnostics акумулятор діагностик (мутується)
 * @returns {unknown[]} масив сирих елементів (порожній при відсутності/помилці)
 */
function readSlotsArray(rawSlots, field, pluginName, diagnostics) {
  if (!rawSlots || rawSlots[field] === undefined) return []
  if (!Array.isArray(rawSlots[field])) {
    diagnostics.push(
      diagnostic(
        'error',
        'invalid-slots-shape',
        pluginName,
        null,
        null,
        `${pluginName}: slots.${field} має бути масивом.`
      )
    )
    return []
  }
  return rawSlots[field]
}

/**
 * Прохід acceptance: чи плагін входить у slot graph (§9.1 manifest parse failure, §9.2
 * requiresPluginApi gate). Push-ить diagnostic сам, коли відхиляє — так виклик у
 * {@link resolveSlotGraph} лишається однорядковим `if`.
 * @param {import('./resolve-plugins.mjs').ResolvedPlugin} plugin резолвлений плагін
 * @param {SlotDiagnostic[]} diagnostics акумулятор діагностик (мутується)
 * @returns {boolean} true — плагін приймається у граф
 */
function acceptPlugin(plugin, diagnostics) {
  const { name, manifest } = plugin
  if (manifest.manifestError) {
    diagnostics.push(
      diagnostic(
        'error',
        'manifest-parse-error',
        name,
        null,
        null,
        `Плагін ${name}: package.json не читається/не парситься (${manifest.manifestError}).`
      )
    )
    return false
  }
  if (manifest.requiresPluginApi !== PLUGIN_API_VERSION) {
    const actual = manifest.requiresPluginApi === undefined ? '(відсутнє)' : JSON.stringify(manifest.requiresPluginApi)
    diagnostics.push(
      diagnostic(
        'warning',
        'plugin-api-version-skip',
        name,
        null,
        null,
        `Плагін ${name} не входить у slot graph: очікується requiresPluginApi=${PLUGIN_API_VERSION}, отримано ${actual} — обслуговується legacy contributes-поверхнями до Фази 2.`
      )
    )
    return false
  }
  return true
}

/**
 * Валідує `slots.provides` ОДНОГО прийнятого плагіна (envelope + дубль-check у межах плагіна).
 * @param {import('./resolve-plugins.mjs').ResolvedPlugin} plugin прийнятий (`acceptPlugin`) плагін
 * @param {Set<string>} activeCapabilities повний набір capabilities (прохід 1 {@link resolveSlotGraph})
 * @param {SlotDiagnostic[]} diagnostics акумулятор діагностик (мутується)
 * @returns {SlotContribution[]} валідні contributions цього плагіна, у manifest-порядку
 */
function collectPluginContributions(plugin, activeCapabilities, diagnostics) {
  const { name, packageRoot, manifest } = plugin
  const providesRaw = readSlotsArray(manifest.slots, 'provides', name, diagnostics)
  const seenContributionKeys = new Set()
  const out = []
  for (const [manifestIndex, raw] of providesRaw.entries()) {
    const result = validateContribution({ raw, pluginName: name, packageRoot, manifestIndex, activeCapabilities })
    if ('diagnostic' in result) {
      diagnostics.push(result.diagnostic)
      continue
    }
    const { contribution } = result
    const dedupeKey = `${contribution.slot}::${contribution.version}::${contribution.id}`
    if (seenContributionKeys.has(dedupeKey)) {
      diagnostics.push(
        diagnostic(
          'error',
          'duplicate-contribution',
          name,
          contribution.slot,
          contribution.version,
          `${name}: дубль contribution id "${contribution.id}" для ${contribution.slot}@${contribution.version} (provides[${manifestIndex}]).`
        )
      )
      continue
    }
    seenContributionKeys.add(dedupeKey)
    out.push(contribution)
  }
  return out
}

/**
 * Валідує `slots.consumes` ОДНОГО прийнятого плагіна.
 * @param {import('./resolve-plugins.mjs').ResolvedPlugin} plugin прийнятий (`acceptPlugin`) плагін
 * @param {SlotDiagnostic[]} diagnostics акумулятор діагностик (мутується)
 * @returns {SlotConsumer[]} валідні consumers цього плагіна, у manifest-порядку
 */
function collectPluginConsumers(plugin, diagnostics) {
  const { name, packageRoot, manifest } = plugin
  const consumesRaw = readSlotsArray(manifest.slots, 'consumes', name, diagnostics)
  const out = []
  for (const [manifestIndex, raw] of consumesRaw.entries()) {
    const result = validateConsumer({ raw, pluginName: name, packageRoot, manifestIndex })
    if ('diagnostic' in result) {
      diagnostics.push(result.diagnostic)
      continue
    }
    out.push(result.consumer)
  }
  return out
}

/**
 * Прохід 3 (§9.5 no-consumer → silent no-op; §9.6 version mismatch → hard error): контрибуції
 * без ЖОДНОГО зареєстрованого consumer-а слоту мовчки ігноруються (жодного diagnostic);
 * контрибуції слоту з активним consumer-ом, чию версію не підтримує ЖОДЕН з consumer-ів цього
 * слоту — actionable error із provenance обох сторін.
 * @param {SlotContribution[]} contributions усі валідні contributions (проходи 1-2)
 * @param {SlotConsumer[]} consumers усі валідні consumers (проходи 1-2)
 * @param {SlotDiagnostic[]} diagnostics акумулятор діагностик (мутується)
 * @returns {void}
 */
function appendVersionMismatchDiagnostics(contributions, consumers, diagnostics) {
  const consumersBySlot = new Map()
  for (const consumer of consumers) {
    if (!consumersBySlot.has(consumer.slot)) consumersBySlot.set(consumer.slot, [])
    consumersBySlot.get(consumer.slot).push(consumer)
  }
  for (const contribution of contributions) {
    const slotConsumers = consumersBySlot.get(contribution.slot)
    if (!slotConsumers || slotConsumers.length === 0) continue
    const supported = slotConsumers.some(c => c.versions.includes(contribution.version))
    if (!supported) {
      const consumerSummary = slotConsumers.map(c => `${c.pluginName}@[${c.versions.join(',')}]`).join(', ')
      diagnostics.push(
        diagnostic(
          'error',
          'version-mismatch',
          contribution.pluginName,
          contribution.slot,
          contribution.version,
          `${contribution.pluginName}: contribution "${contribution.id}" слоту ${contribution.slot}@${contribution.version} не підтримується жодним consumer-ом (${consumerSummary}).`
        )
      )
    }
  }
}

/**
 * Резолвить один immutable slot graph для проєкту — СИНХРОННО, один filesystem/plugin scan на
 * `(projectRoot, config, allowInstall)` (кешовано на процес, той самий ключ, що й
 * {@link resolvePlugins}). Hot-path-контракт: без await, без динамічного import — читає лише те,
 * що вже на диску (existsSync/realpathSync), ніколи не викликає consumer-handler.
 *
 * Плагін без `requiresPluginApi === 2` НЕ входить у граф (§9.2) — легітимний перехідний стан,
 * доки Фаза 2 не переведе first-party плагіни на slots; такий плагін і далі обслуговується
 * legacy `contributes`-поверхнями `resolve-plugins.mjs` без змін.
 *
 * Три послідовні проходи (винесені у {@link acceptPlugin}/{@link collectPluginContributions}/
 * {@link collectPluginConsumers}/{@link appendVersionMismatchDiagnostics} — інакше єдина функція
 * перевищує поріг когнітивної складності лінтера): (1) capabilities УСІХ наявних плагінів
 * — ПОВНІСТЮ, до валідації жодної contribution (інакше плагін A раніше у списку з
 * `requires.capabilities` на capability плагіна B, пізнішого у списку, хибно вважав би її
 * неактивною); (2) acceptance + envelope validation кожного плагіна; (3) version-mismatch
 * діагностика на вже повному наборі contributions/consumers.
 * @param {string} projectRoot корінь репозиторію
 * @param {{ plugins?: unknown } | null | undefined} config розпарсений `.n-rules.json`
 * @param {{ allowInstall?: boolean, quiet?: boolean }} [options] прокидається у {@link resolvePlugins}
 * @returns {SlotGraph} заморожений граф (top-level; масиви/обʼєкти-елементи так само заморожені — Set capabilities лишається змінюваним контейнером за конвенцією репо, див. `getActiveCapabilities`)
 */
export function resolveSlotGraph(projectRoot, config, options = {}) {
  const root = resolvePath(projectRoot)
  const plugins = resolvePlugins(root, config, options)
  const cacheKey = `${root} ${plugins.map(p => p.name).join(',')} ${options.allowInstall !== false}`
  const cached = SLOT_GRAPH_CACHE.get(cacheKey)
  if (cached) return cached

  /** @type {SlotDiagnostic[]} */
  const diagnostics = []
  /** @type {Array<{ name: string, packageRoot: string }>} */
  const acceptedPlugins = []
  /** @type {SlotContribution[]} */
  const contributions = []
  /** @type {SlotConsumer[]} */
  const consumers = []
  const capabilities = new Set()

  for (const plugin of plugins) {
    for (const cap of plugin.manifest.capabilities) capabilities.add(cap)
  }

  for (const plugin of plugins) {
    if (!acceptPlugin(plugin, diagnostics)) continue
    acceptedPlugins.push({ name: plugin.name, packageRoot: plugin.packageRoot })
    contributions.push(...collectPluginContributions(plugin, capabilities, diagnostics))
    consumers.push(...collectPluginConsumers(plugin, diagnostics))
  }

  appendVersionMismatchDiagnostics(contributions, consumers, diagnostics)

  const graph = Object.freeze({
    plugins: Object.freeze(acceptedPlugins.map(p => Object.freeze({ ...p }))),
    capabilities,
    contributions: Object.freeze(contributions),
    consumers: Object.freeze(consumers),
    diagnostics: Object.freeze(diagnostics)
  })
  SLOT_GRAPH_CACHE.set(cacheKey, graph)
  return graph
}

/**
 * Contributions одного слоту, відфільтровані за підтримуваними версіями і активними
 * capabilities графа — capability-гейт застосовується ТУТ, тобто ДО того, як викликач прочитає
 * `resourcePath` (spec §12 acceptance: "capabilities застосовуються до contributions до
 * завантаження resource"). Синхронна — жодного I/O, лише фільтр вже готового графа.
 * @param {SlotGraph} graph граф від {@link resolveSlotGraph}
 * @param {string} slot slot id
 * @param {number[]} [supportedVersions] версії, які вміє матеріалізувати викликач; відсутнє — без фільтра за версією (введення для діагностики/інспекції)
 * @returns {SlotContribution[]} contributions у порядку графа (resolved plugin order → manifest order)
 */
export function getSlotContributions(graph, slot, supportedVersions) {
  const versionFilter = Array.isArray(supportedVersions) ? new Set(supportedVersions) : null
  return graph.contributions.filter(
    c =>
      c.slot === slot &&
      (versionFilter === null || versionFilter.has(c.version)) &&
      c.requires.capabilities.every(cap => graph.capabilities.has(cap))
  )
}

/**
 * Consumers одного слоту (без фільтра версій — викликач сам звіряє свій набір версій).
 * @param {SlotGraph} graph граф від {@link resolveSlotGraph}
 * @param {string} slot slot id
 * @returns {SlotConsumer[]} consumers у порядку графа
 */
export function getSlotConsumers(graph, slot) {
  return graph.consumers.filter(c => c.slot === slot)
}

/**
 * ЄДИНЕ місце динамічного import consumer-handler-а (spec §3.4: "module import відбувається лише
 * в loadSlotConsumer()"). Викликається САМИМ surface-ом, коли він реально матеріалізує contributions
 * цього слоту — ніколи під час discovery (`resolveSlotGraph`). Перевіряє форму default-експорту
 * (§3.3): обʼєкт, стабільний `id`, функція `validate`.
 * @param {SlotConsumer} consumer запис з {@link getSlotConsumers}
 * @returns {Promise<{ id: string, validate: (contribution: unknown) => unknown, [key: string]: unknown }>} валідований consumer-обʼєкт (default-експорт handler-модуля)
 */
export async function loadSlotConsumer(consumer) {
  // file:// URL — інакше відносний шлях трактується як bare package specifier
  // eslint-disable-next-line no-unsanitized/method
  const mod = await import(pathToFileURL(consumer.handlerPath).href)
  const candidate = mod?.default
  if (!candidate || typeof candidate !== 'object') {
    throw new TypeError(
      `plugin-slots: ${consumer.pluginName} (слот ${consumer.slot}) — default-експорт handler-а не є обʼєктом.`
    )
  }
  if (typeof candidate.id !== 'string' || candidate.id === '') {
    throw new TypeError(`plugin-slots: ${consumer.pluginName} (слот ${consumer.slot}) — consumer без стабільного "id".`)
  }
  if (typeof candidate.validate !== 'function') {
    throw new TypeError(
      `plugin-slots: ${consumer.pluginName} (слот ${consumer.slot}) — consumer без функції "validate".`
    )
  }
  return candidate
}

/** Скидає кеш slot graph (для тестів). */
export function clearSlotResolveCache() {
  SLOT_GRAPH_CACHE.clear()
}
