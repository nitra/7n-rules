/**
 * Canonical payload-контракт слоту `ci.artifact@1` (spec
 * `2026-07-27-universal-plugin-slots-lang-php-extraction`, §7.1, Фаза 3).
 *
 * Broker (`plugin-slots.mjs`) валідує лише universal envelope contribution-а (slot/version/id/
 * resource|value/requires) — сам payload (JSON-документ, на який вказує `resource`, або inline
 * `value`) типізує й перевіряє **consumer** (spec §3.3: «Payload типізується й перевіряється
 * consumer-ом»). Цей модуль — єдине джерело правди для форми payload-у `ci.artifact@1`, спільне
 * для обох first-party CI-консюмерів (`@7n/rules-ci-github`, `@7n/rules-ci-azure`) і для
 * майбутніх third-party consumer-ів, що захочуть той самий контракт. Публічний доступ —
 * `@7n/rules/plugin-api` (re-export, spec §3.3).
 *
 * Невідомі поля payload відхиляються у v1 (spec §7.1: "Нове поле, яке змінює semantics, потребує
 * ci.artifact@2") — це навмисно суворо: тихе ігнорування нового поля новішого payload-у старим
 * consumer-ом було б мовчазною втратою semantics, а не graceful degradation.
 */
import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { dirname, isAbsolute, sep } from 'node:path'

/** `artifactId` — той самий regex, що й `id` contribution-у в universal envelope (spec §3.2, §7.1). */
export const CI_ARTIFACT_ID_RE = /^[a-z][a-z0-9-]*$/u

const KNOWN_PAYLOAD_FIELDS = Object.freeze([
  'targetCapability',
  'artifactId',
  'targetPath',
  'format',
  'mode',
  'template',
  'mergeStrategy',
  'fix'
])
/** v1: лише `yaml` (spec §7.1). */
const KNOWN_FORMATS = new Set(['yaml'])
const KNOWN_MODES = new Set(['required-file', 'patch-existing'])
const KNOWN_MERGE_STRATEGIES = new Set(['deep-subset', 'contains-step'])

/**
 * @typedef {object} CiArtifactDescriptor
 * @property {string} targetCapability capability активного consumer-а, для якого призначений artifact (напр. `ci:github`)
 * @property {string} artifactId domain collision key — стабільний ідентифікатор логічного артефакту (унікальний серед РІЗНИХ contributions, spec §9.10)
 * @property {string} targetPath consumer-repo-relative шлях цільового файлу (posix, без `..`, без абсолютних)
 * @property {'yaml'} format формат цільового файлу — у v1 лише `yaml`
 * @property {'required-file'|'patch-existing'} mode `required-file` — файл обов'язковий (T0 створює з template); `patch-existing` — застосовується лише коли target вже існує (файл належить іншому активному concern-у, spec §7.1)
 * @property {string} template шлях до канонічного snippet-у, відносний від каталогу дескриптора (`./…`, без `..`)
 * @property {'deep-subset'|'contains-step'} mergeStrategy `deep-subset` — GitHub-стиль structural merge; `contains-step` — Azure-стиль пошук canonical кроку на будь-якій глибині
 * @property {boolean} fix чи дозволений deterministic T0 fix для цього artifact-у
 */

/**
 * Перевіряє, що `p` — безпечний repo-relative шлях (`targetPath`): рядок, без ведучого `/`,
 * без `..`-сегментів. Не перевіряє існування — лише форму (containment за realpath — відповідальність
 * викликача, який знає consumer-repo root).
 * @param {unknown} p сире значення поля
 * @returns {boolean} true — безпечна форма
 */
export function isSafeRepoRelativePath(p) {
  if (typeof p !== 'string' || p.length === 0) return false
  if (isAbsolute(p)) return false
  return !p.split('/').includes('..')
}

/**
 * Перевіряє, що `p` — безпечний package-relative шлях у стилі envelope (spec §3.2): рядок,
 * починається з `./`, без `..`-сегментів. Використовується для `template` (шлях від каталогу
 * дескриптора, не від package root — containment-резолв виконує {@link resolveArtifactTemplatePath}).
 * @param {unknown} p сире значення поля
 * @returns {boolean} true — безпечна форма
 */
export function isSafeTemplateRelPath(p) {
  return typeof p === 'string' && p.startsWith('./') && !p.split('/').includes('..')
}

/**
 * Валідує payload `ci.artifact@1` (spec §7.1). Не читає файлову систему — чиста форма-перевірка,
 * тому придатна і для value-based, і для resource-based contributions (обидві дають один і той
 * самий JSON-подібний обʼєкт викликачу).
 * @param {unknown} raw сирий payload (розпарсений `value`/`resource`)
 * @returns {{ ok: true, descriptor: CiArtifactDescriptor } | { ok: false, errors: string[] }} результат
 */
export function validateCiArtifactPayload(raw) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, errors: ['payload ci.artifact@1 має бути обʼєктом'] }
  }
  const r = /** @type {Record<string, unknown>} */ (raw)
  /** @type {string[]} */
  const errors = []

  const unknown = Object.keys(r).filter(k => !KNOWN_PAYLOAD_FIELDS.includes(k))
  if (unknown.length > 0) errors.push(`невідомі поля payload (v1 їх відхиляє): ${unknown.join(', ')}`)

  if (typeof r.targetCapability !== 'string' || r.targetCapability === '') {
    errors.push('targetCapability має бути непорожнім рядком')
  }
  if (typeof r.artifactId !== 'string' || !CI_ARTIFACT_ID_RE.test(r.artifactId)) {
    errors.push(`artifactId має відповідати ${CI_ARTIFACT_ID_RE}`)
  }
  if (!isSafeRepoRelativePath(r.targetPath)) {
    errors.push('targetPath має бути безпечним repo-relative шляхом (без абсолютних і ".." сегментів)')
  }
  if (typeof r.format !== 'string' || !KNOWN_FORMATS.has(r.format)) {
    errors.push(`format підтримує лише: ${[...KNOWN_FORMATS].join(', ')} (v1)`)
  }
  if (typeof r.mode !== 'string' || !KNOWN_MODES.has(r.mode)) {
    errors.push(`mode підтримує лише: ${[...KNOWN_MODES].join(', ')}`)
  }
  if (!isSafeTemplateRelPath(r.template)) {
    errors.push('template має бути безпечним шляхом від каталогу дескриптора (починається з "./", без ".." сегментів)')
  }
  if (typeof r.mergeStrategy !== 'string' || !KNOWN_MERGE_STRATEGIES.has(r.mergeStrategy)) {
    errors.push(`mergeStrategy підтримує лише: ${[...KNOWN_MERGE_STRATEGIES].join(', ')}`)
  }
  if (typeof r.fix !== 'boolean') errors.push('fix має бути boolean')

  if (errors.length > 0) return { ok: false, errors }
  return {
    ok: true,
    descriptor: Object.freeze({
      targetCapability: r.targetCapability,
      artifactId: r.artifactId,
      targetPath: r.targetPath,
      format: r.format,
      mode: r.mode,
      template: r.template,
      mergeStrategy: r.mergeStrategy,
      fix: r.fix
    })
  }
}

/**
 * Best-effort realpath (той самий підхід, що й `plugin-slots.mjs#bestEffortRealpath` — окрема
 * копія, не крос-імпорт з internal-модуля, spec §3.4 тримає broker і consumer-типізацію окремо).
 * @param {string} p абсолютний шлях
 * @returns {string} realpath або найкраще наближення
 */
function bestEffortRealpath(p) {
  try {
    return realpathSync(p)
  } catch {
    const parent = dirname(p)
    if (parent === p) return p
    return `${bestEffortRealpath(parent)}${sep}${p.slice(parent.length + 1)}`
  }
}

/**
 * Резолвить абсолютний шлях `descriptor.template` — ВІД каталогу дескриптора (`resourcePath`
 * contribution-у, якщо contribution resource-based; інакше `packageRoot` для value-based
 * contributions, де "каталогу дескриптора" не існує) — з containment-перевіркою в межах
 * `contribution.packageRoot` (та сама межа безпеки, що broker застосовує до всіх
 * package-relative шляхів, spec §3.2).
 * @param {{ packageRoot: string, resourcePath: string | null }} contribution provenance contribution-у (`SlotContribution` з `plugin-slots.mjs`)
 * @param {CiArtifactDescriptor} descriptor валідований payload
 * @returns {{ ok: true, absPath: string, exists: boolean } | { ok: false, reason: string }} результат
 */
export function resolveArtifactTemplatePath(contribution, descriptor) {
  const baseDir = contribution.resourcePath ? dirname(contribution.resourcePath) : contribution.packageRoot
  const packageRootReal = bestEffortRealpath(contribution.packageRoot)
  const candidate = `${baseDir}/${descriptor.template.slice(2)}`
  const candidateReal = bestEffortRealpath(candidate)
  const contained = candidateReal === packageRootReal || candidateReal.startsWith(packageRootReal + sep)
  if (!contained) return { ok: false, reason: 'template escape поза межі пакета' }
  return { ok: true, absPath: candidateReal, exists: existsSync(candidate) }
}

/**
 * Читає й розбирає payload contribution-у ci.artifact (`resource` XOR `value`, вже резолвлені
 * broker-ом у `SlotContribution`). Broker НІКОЛИ не читає вміст `resource` (spec §3.4) — це
 * єдине місце, де вміст дескриптора реально завантажується з диска, і робить це САМ consumer,
 * а не broker.
 * @param {{ resourcePath: string | null, value: unknown }} contribution `SlotContribution` (лише поля, потрібні тут)
 * @returns {{ ok: true, raw: unknown } | { ok: false, errors: string[] }} сирий (ще не валідований) payload
 */
export function loadCiArtifactPayload(contribution) {
  if (contribution.resourcePath === null) return { ok: true, raw: contribution.value }
  try {
    const text = readFileSync(contribution.resourcePath, 'utf8')
    return { ok: true, raw: JSON.parse(text) }
  } catch (error) {
    return {
      ok: false,
      errors: [`resource "${contribution.resourcePath}" не читається/не парситься як JSON: ${error.message}`]
    }
  }
}

/**
 * @typedef {object} CiArtifactCandidate
 * @property {import('./plugin-slots.mjs').SlotContribution} contribution provenance contribution-у
 * @property {CiArtifactDescriptor} descriptor валідований payload
 */
