/** @see ./docs/harness.md */

/**
 * Run-harness фасад (Фаза A4, дизайн 2026-07-11): єдиний декларативний вхід над
 * трьома раннерами (`runOneShot` / `runAgentFix` / `runAgentSkill`).
 *
 * Мета — щоб consumer (inline-драбина n-cursor, майбутній MT-runner Фази B, 7n-test)
 * описував ЩО запустити **профілем-обʼєктом**, а не набором позиційних opts, і щоб
 * той самий профіль серіалізувався у JSON (Фаза B мапить `a.md`-вузол MT → профіль
 * без коду). Фасад тонкий: він резолвить профіль у opts і делегує в наявний раннер,
 * НЕ дублюючи їхню логіку (write-guard, verify-loop, toolset-и лишаються в раннерах).
 *
 * Профіль (усі поля опційні, крім прив'язки до раннера через `kind`):
 *   { schema_version: 1, kind: 'fix'|'skill'|'one-shot',
 *     tier, model, timeoutMs, maxTokens, thinkingLevel,
 *     verifyMax, anchoredEdits, webTools }
 * `schema_version` присутній з дня 1 — Фаза B хоче стабільності контракту.
 *
 * Модуль pi-free на рівні top-level: раннери самі роблять lazy pi-import у fix/skill
 * гілці; `createHarness` лише готує замикання.
 */

/** Поточна версія схеми профілю. Несумісна зміна → bump + міграція consumer-ів. */
export const HARNESS_SCHEMA_VERSION = 1

/** Підтримувані види задач (прив'язка профілю до раннера). */
const KINDS = new Set(['fix', 'skill', 'one-shot'])

/**
 * Валідує профіль: відомий `kind`, сумісний `schema_version`.
 * @param {object} profile профіль-обʼєкт
 * @returns {{ ok: true } | { ok: false, error: string }} результат валідації
 */
export function validateProfile(profile) {
  if (!profile || typeof profile !== 'object') return { ok: false, error: 'профіль має бути обʼєктом' }
  const v = profile.schema_version ?? HARNESS_SCHEMA_VERSION
  if (v !== HARNESS_SCHEMA_VERSION) {
    return { ok: false, error: `несумісний schema_version ${v} (очікується ${HARNESS_SCHEMA_VERSION})` }
  }
  if (!KINDS.has(profile.kind)) {
    return { ok: false, error: `невідомий kind "${profile.kind}" (допустимі: ${[...KINDS].join(', ')})` }
  }
  return { ok: true }
}

/**
 * Резолвить профіль + per-виклик поля у opts конкретного раннера.
 * Профіль задає дефолти конфігурації, `call` — динаміку виклику (cwd, violation,
 * verify, chain тощо); `call` перекриває збіжні поля профілю.
 * @param {object} profile профіль-обʼєкт (валідований)
 * @param {object} call per-виклик поля
 * @returns {object} opts для раннера
 */
function resolveOpts(profile, call) {
  const { schema_version: _sv, kind: _kind, ...profileOpts } = profile
  return { ...profileOpts, ...call }
}

/**
 * Створює harness із набором іменованих профілів.
 * @param {{ profiles?: Record<string, object>,
 *   deps?: { runOneShot?: (opts: object) => Promise<object>, runAgentFix?: (...args: unknown[]) => Promise<object>, runAgentSkill?: (prompt: string, opts: object) => Promise<object> } }} [args]
 *   `profiles` — мапа імʼя→профіль; `deps` — інжекція раннерів (тести / кастомний wiring).
 * @returns {{ run: (spec: object) => Promise<object>, profileNames: () => string[] }} harness
 */
export function createHarness({ profiles = {}, deps = {} } = {}) {
  /**
   * Лениво тягне раннер (pi-free top-level: імпорт лише при першому виклику потрібного kind).
   * @param {string} kind вид задачі
   * @returns {Promise<(...args: unknown[]) => Promise<object>>} функція-раннер
   */
  async function runnerFor(kind) {
    if (kind === 'fix') {
      if (deps.runAgentFix) return deps.runAgentFix
      const mod = await import('./agent-fix.mjs')
      return mod.runAgentFix
    }
    if (kind === 'skill') {
      if (deps.runAgentSkill) return deps.runAgentSkill
      const mod = await import('./agent-skill.mjs')
      return mod.runAgentSkill
    }
    if (deps.runOneShot) return deps.runOneShot
    const mod = await import('./one-shot.mjs')
    return mod.runOneShot
  }

  /**
   * Запускає задачу за профілем.
   * @param {object} spec `{ profile: string|object, ...call }` — профіль за іменем або
   *   інлайн-обʼєктом + per-виклик поля (`fix`: ruleId, violation, cwd, verify, targetFiles…;
   *   `skill`: prompt, cwd…; `one-shot`: messages…).
   * @returns {Promise<object>} результат відповідного раннера (контракт не змінюється)
   */
  async function run(spec = {}) {
    const { profile: profileRef, ...call } = spec
    const profile = typeof profileRef === 'string' ? profiles[profileRef] : profileRef
    if (!profile) throw new Error(`профіль не знайдено: ${JSON.stringify(profileRef)}`)
    const valid = validateProfile(profile)
    if (!valid.ok) throw new Error(`невалідний профіль: ${valid.error}`)

    const run = await runnerFor(profile.kind)
    const opts = resolveOpts(profile, call)
    if (profile.kind === 'fix') {
      // runAgentFix(ruleId, violation, cwd, opts) — позиційні + opts.
      const { ruleId, violation, cwd, ...rest } = opts
      return run(ruleId, violation, cwd, rest)
    }
    if (profile.kind === 'skill') {
      // runAgentSkill(prompt, opts) — prompt позиційний.
      const { prompt, ...rest } = opts
      return run(prompt, rest)
    }
    // one-shot: усе в одному obj-arg.
    return run(opts)
  }

  return { run, profileNames: () => Object.keys(profiles) }
}
