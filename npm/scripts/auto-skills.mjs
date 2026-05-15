/**
 * Автовизначення skills для `.n-cursor.json` за умовами зі `npm/skills/<skill>/auto.md`.
 *
 * `auto.md` — джерело правди (а не hardcoded мапа). Підтримуються три варіанти:
 *
 *  - `завжди` — скіл активується незалежно від інших правил
 *    (приклади: `fix`, `lint`, `llm-patch`, `publish-telegram`).
 *  - `[rule, rule, …]` — скіл активується, якщо ВСІ перелічені правила вже виявлені
 *    auto-rules (приклади: `abie-clean - [abie]`, `taze - [bun]`).
 *  - файл відсутній або формат не розпізнано — скіл opt-in лише через `.n-cursor.json:skills`.
 *
 * Сканування `npm/skills/` — sync під час завантаження модуля (детермінізм + sync API
 * `auto-rules.mjs`-сусіда). Кеш на час процесу.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const PACKAGE_ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const SKILLS_DIR = join(PACKAGE_ROOT, 'skills')

const ALWAYS_LITERAL = 'завжди'
const BRACKET_LIST_RE = /^\[([^\]]+)\]$/u

/**
 * @typedef {{ always: true } | { rules: readonly string[] }} SkillAutoSpec
 */

/**
 * Парсить тіло `auto.md` одного скіла.
 * @param {string} text вміст файла (без `trim`)
 * @returns {SkillAutoSpec | null} `null` — формат не розпізнано (= opt-in)
 */
function parseSkillAutoSpec(text) {
  const trimmed = text.trim()
  if (trimmed === ALWAYS_LITERAL) {
    return { always: true }
  }
  const m = trimmed.match(BRACKET_LIST_RE)
  if (m) {
    const rules = m[1]
      .split(',')
      .map(s => s.trim())
      .filter(s => s.length > 0)
    if (rules.length === 0) return null
    return { rules: Object.freeze(rules) }
  }
  return null
}

/**
 * Сканує `npm/skills/<id>/auto.md`. Скіли без `auto.md` або з нерозпізнаним
 * вмістом не потрапляють у результат — їх можна вмикати лише вручну в конфізі.
 * @param {string} [skillsDir] override для тестів
 * @returns {Record<string, SkillAutoSpec>}
 */
export function discoverSkillAutoActivation(skillsDir = SKILLS_DIR) {
  if (!existsSync(skillsDir)) return {}
  /** @type {Record<string, SkillAutoSpec>} */
  const out = {}
  for (const entry of readdirSync(skillsDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue
    const autoMdPath = join(skillsDir, entry.name, 'auto.md')
    if (!existsSync(autoMdPath)) continue
    const spec = parseSkillAutoSpec(readFileSync(autoMdPath, 'utf8'))
    if (spec) out[entry.name] = spec
  }
  return out
}

/** Cache на час процесу: один скан `npm/skills/` дає всю автоактивацію. */
const SKILL_AUTO_ACTIVATION = discoverSkillAutoActivation()

/**
 * Стабільний алфавітний порядок скілів з автоактивацією. Експортовано для зворотної
 * сумісності (попередня версія мала жорстко прописаний `AUTO_SKILL_ORDER`).
 */
export const AUTO_SKILL_ORDER = Object.freeze(
  Object.keys(SKILL_AUTO_ACTIVATION).toSorted((a, b) => a.localeCompare(b))
)

/**
 * Похідна view на `SKILL_AUTO_ACTIVATION`: лише скіли з rule-залежностями.
 * Експортовано для зворотної сумісності та автодоку.
 */
export const AUTO_SKILL_RULE_DEPENDENCIES = Object.freeze(
  Object.fromEntries(
    Object.entries(SKILL_AUTO_ACTIVATION)
      .filter(([, spec]) => 'rules' in spec)
      .map(([id, spec]) => [id, /** @type {{ rules: readonly string[] }} */ (spec).rules])
  )
)

const DEFAULT_DISABLED_LIST = Object.freeze([])

/**
 * Визначає авто-skills згідно з вмістом `skills/<skill>/auto.md`.
 * @param {object} params параметри
 * @param {string[]} params.availableSkills перелік доступних skills із пакету (id без префікса n-)
 * @param {string[]} params.detectedRules id правил, виявлених auto-rules (вхідні залежності)
 * @param {string[]} [params.disableSkills] список `disable-skills` з конфігу
 * @returns {{ skills: string[] }} список id у стабільному алфавітному порядку
 */
export function detectAutoSkills({ availableSkills, detectedRules, disableSkills = DEFAULT_DISABLED_LIST }) {
  const normalizedSkills = new Set(availableSkills.map(s => s.trim().toLowerCase()))
  const disableSkillsSet = new Set(disableSkills)
  const detectedRulesSet = new Set(detectedRules)

  /** @type {Set<string>} */
  const detected = new Set()

  for (const [skillId, spec] of Object.entries(SKILL_AUTO_ACTIVATION)) {
    if (!normalizedSkills.has(skillId) || disableSkillsSet.has(skillId)) continue
    if ('always' in spec) {
      detected.add(skillId)
    } else if (spec.rules.every(d => detectedRulesSet.has(d))) {
      detected.add(skillId)
    }
  }

  return { skills: AUTO_SKILL_ORDER.filter(id => detected.has(id)) }
}
