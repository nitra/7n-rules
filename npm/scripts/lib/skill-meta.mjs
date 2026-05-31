/**
 * Спільний парсер метаданих скіла з `npm/skills/<id>/meta.json`.
 *
 * `meta.json` — єдине джерело правди для скіла замість колишнього `auto.md`:
 *  - `auto` — умова автоактивації (`"завжди"` | масив id правил), опційне;
 *  - `worktree` — boolean: чи виконувати скіл в окремому git-worktree (один інстанс).
 *
 * Цим хелпером користуються `auto-skills.mjs` (автоактивація), `n-cursor.js`
 * (sync + вшивання worktree-блоку) і check-концерн `npm-module/js/skill_meta.mjs`,
 * щоб не дублювати парсинг і форму валідації.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/** Літерал безумовної автоактивації (українською, як у `auto-skills.mjs`). */
export const SKILL_ALWAYS = 'завжди'

/**
 * @typedef {{ always: true } | { rules: string[] }} SkillAutoSpec
 */

/**
 * Перетворює значення поля `auto` з `meta.json` у `SkillAutoSpec`.
 * @param {unknown} value значення `meta.json.auto`
 * @returns {SkillAutoSpec | null} `null` — формат не розпізнано (= opt-in)
 */
export function parseSkillAutoSpec(value) {
  if (value === SKILL_ALWAYS) {
    return { always: true }
  }
  if (Array.isArray(value)) {
    const rules = value.map(s => String(s).trim()).filter(s => s.length > 0)
    if (rules.length === 0) return null
    return { rules }
  }
  return null
}

/**
 * Читає й парсить `meta.json` одного скіла.
 * @param {string} skillDir абсолютний шлях до каталогу скіла
 * @returns {Record<string, unknown> | null} розпарсений обʼєкт або `null` (немає файлу / невалідний JSON / не-обʼєкт)
 */
export function readSkillMetaRaw(skillDir) {
  const metaPath = join(skillDir, 'meta.json')
  if (!existsSync(metaPath)) return null
  try {
    const parsed = JSON.parse(readFileSync(metaPath, 'utf8'))
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    return /** @type {Record<string, unknown>} */ (parsed)
  } catch {
    return null
  }
}
