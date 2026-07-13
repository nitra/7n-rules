/**
 * Автовизначення skills для `.n-rules.json` за умовами з `npm/skills/<skill>/main.json`.
 *
 * `main.json` — джерело правди (а не hardcoded мапа). Підтримуються три варіанти:
 *
 *  - `auto: "завжди"` — скіл активується незалежно від інших правил
 *    (приклади: `fix`, `lint`, `llm-patch`, `publish-telegram`).
 *  - `auto: ["rule", …]` — скіл активується, якщо ВСІ перелічені правила вже виявлені
 *    auto-rules (приклади: `adr-normalize - ["adr"]`, `taze - ["bun"]`).
 *  - поле `auto` відсутнє або формат не розпізнано — скіл opt-in лише через `.n-rules.json:skills`.
 *
 * Сканування `npm/skills/` — sync під час завантаження модуля (детермінізм + sync API
 * `auto-rules.mjs`-сусіда). Кеш на час процесу.
 */
import { existsSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { parseSkillAutoSpec, readSkillMetaRaw } from './lib/skill-meta.mjs'

const PACKAGE_ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const SKILLS_DIR = join(PACKAGE_ROOT, 'skills')

/**
 * @typedef {{ always: true } | { rules: readonly string[] }} SkillAutoSpec
 */

/**
 * Сканує `npm/skills/<id>/main.json`. Скіли без `main.json` або без розпізнаного
 * `auto` не потрапляють у результат — їх вмикають лише вручну в конфізі.
 * @param {string} [skillsDir] override для тестів
 * @returns {Record<string, SkillAutoSpec>} мапа `skillId → spec`
 */
export function discoverSkillAutoActivation(skillsDir = SKILLS_DIR) {
  if (!existsSync(skillsDir)) return {}
  /** @type {Record<string, SkillAutoSpec>} */
  const out = {}
  for (const entry of readdirSync(skillsDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue
    const raw = readSkillMetaRaw(join(skillsDir, entry.name))
    if (!raw) continue
    const spec = parseSkillAutoSpec(raw.auto)
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
export const AUTO_SKILL_ORDER = Object.freeze(Object.keys(SKILL_AUTO_ACTIVATION).toSorted((a, b) => a.localeCompare(b)))

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
    if ('always' in spec || spec.rules.every(d => detectedRulesSet.has(d))) {
      detected.add(skillId)
    }
  }

  return { skills: AUTO_SKILL_ORDER.filter(id => detected.has(id)) }
}
