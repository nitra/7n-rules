/**
 * Автовизначення skills для `.n-cursor.json` за умовами з `npm/bin/auto-skills.md`.
 *
 * Скіли автододаються залежно від уже виявлених правил (auto-rules) — щоб не дублювати
 * умови, які вже формалізовані для відповідного правила. Наприклад:
 *
 * - `abie-kustomize - [abie]` — додається разом з правилом `abie`
 * - `taze - [bun]` — додається разом з правилом `bun`
 *
 * Скіли без секції `[rules]` у `auto-skills.md` (`fix`, `lint`, `publish-telegram`)
 * додаються завжди, якщо доступні в пакеті й не у `disable-skills`.
 */

/** Порядок автододавання skills відповідно до `auto-skills.md`. */
export const AUTO_SKILL_ORDER = Object.freeze(['abie-kustomize', 'fix', 'lint', 'publish-telegram', 'taze'])

/**
 * Залежність скілів від правил (`auto-skills.md` синтаксис `skill - [rules]`).
 * Ключ варто автододати, коли всі правила-залежності вже додані до конфігу автодетектом.
 */
export const AUTO_SKILL_RULE_DEPENDENCIES = Object.freeze(
  /** @type {Record<string, readonly string[]>} */ ({
    'abie-kustomize': Object.freeze(['abie']),
    taze: Object.freeze(['bun'])
  })
)

/** Скіли без залежностей — додаються завжди (рядок «завжди» в `auto-skills.md`). */
const ALWAYS_ON_SKILLS = Object.freeze(['fix', 'lint', 'publish-telegram'])

const DEFAULT_DISABLED_LIST = Object.freeze([])

/**
 * Визначає авто-skills згідно з `auto-skills.md`.
 * @param {object} params параметри
 * @param {string[]} params.availableSkills перелік доступних skills із пакету (id без префікса n-)
 * @param {string[]} params.detectedRules id правил, виявлених auto-rules (вхідні залежності)
 * @param {string[]} [params.disableSkills] список `disable-skills` з конфігу
 * @returns {{ skills: string[] }} список id у стабільному порядку (за `AUTO_SKILL_ORDER`)
 */
export function detectAutoSkills({ availableSkills, detectedRules, disableSkills = DEFAULT_DISABLED_LIST }) {
  const normalizedSkills = new Set(availableSkills.map(s => s.trim().toLowerCase()))
  const disableSkillsSet = new Set(disableSkills)
  const detectedRulesSet = new Set(detectedRules)

  /** @type {string[]} */
  const detected = []

  /**
   * Додає skill до результату, якщо він доступний і не в disable-списку.
   * @param {string} skillId id skill
   * @returns {void}
   */
  function addSkill(skillId) {
    if (!normalizedSkills.has(skillId) || disableSkillsSet.has(skillId) || detected.includes(skillId)) {
      return
    }
    detected.push(skillId)
  }

  for (const skillId of ALWAYS_ON_SKILLS) {
    addSkill(skillId)
  }

  for (const [skillId, deps] of Object.entries(AUTO_SKILL_RULE_DEPENDENCIES)) {
    if (deps.every(d => detectedRulesSet.has(d))) {
      addSkill(skillId)
    }
  }

  return { skills: AUTO_SKILL_ORDER.filter(id => detected.includes(id)) }
}
