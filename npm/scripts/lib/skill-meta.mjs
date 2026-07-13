/**
 * Спільний парсер метаданих скіла з `npm/skills/<id>/main.json`.
 *
 * `main.json` — єдине джерело правди для скіла замість колишнього `auto.md`:
 *  - `auto` — умова автоактивації (`"завжди"` | масив id правил), опційне;
 *  - `worktree` — boolean: чи виконувати скіл в окремому git-worktree (один інстанс);
 *  - `requireRoot` — boolean, опційне: чи скіл вимагає запуску з кореня репо.
 *    Worktree-скіли (`worktree:true`) вимагають кореня неявно (корінь worktree =
 *    його toplevel), тож для них поле зайве. Явний `requireRoot:true` — для
 *    in-place скілів, що мутують CWD без worktree-ізоляції (напр. `n-taze`).
 *
 * Цим хелпером користуються `auto-skills.mjs` (автоактивація), `n-rules.js`
 * (sync + вшивання worktree/root-блоку) і check-концерн `npm-module/js/skill_meta.mjs`,
 * щоб не дублювати парсинг і форму валідації.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/** Літерал безумовної автоактивації (українською, як у `auto-skills.mjs`). */
export const SKILL_ALWAYS = 'завжди'

/** Допустимі тири моделі для агентного виконання скіла (`pi`-runner). */
export const SKILL_TIERS = ['min', 'avg', 'max']

/**
 * Дефолтна тира за відсутності `main.json.tier`: скіли відкриті й агентні, слабка
 * локальна модель іде в мета-рамблінг, тож безпечніше дефолтити в найсильніший тир.
 */
export const DEFAULT_SKILL_TIER = 'max'

/**
 * @typedef {{ always: true } | { rules: string[] }} SkillAutoSpec
 */

/**
 * Перетворює значення поля `auto` з `main.json` у `SkillAutoSpec`.
 * @param {unknown} value значення `main.json.auto`
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
 * Чи вимагає скіл запуску з кореня репо («активовано root-захист»). Єдина похідна
 * ознака: `worktree:true` (корінь гарантує worktree) АБО явний `requireRoot:true`.
 * @param {Record<string, unknown> | null} meta розпарсений `main.json` (або null)
 * @returns {boolean} true — скіл мутує проєкт і має стартувати з кореня
 */
export function skillRequiresRoot(meta) {
  return meta?.worktree === true || meta?.requireRoot === true
}

/**
 * Тира моделі для агентного виконання скіла (`pi`-runner). Повертає `main.json.tier`,
 * якщо це валідний тир, інакше — `DEFAULT_SKILL_TIER` (`max`).
 * @param {Record<string, unknown> | null} meta розпарсений `main.json` (або null)
 * @returns {'min'|'avg'|'max'} тира
 */
export function skillTier(meta) {
  const tier = meta?.tier
  return typeof tier === 'string' && SKILL_TIERS.includes(tier)
    ? /** @type {'min'|'avg'|'max'} */ (tier)
    : DEFAULT_SKILL_TIER
}

/**
 * Читає й парсить `main.json` одного скіла.
 * @param {string} skillDir абсолютний шлях до каталогу скіла
 * @returns {Record<string, unknown> | null} розпарсений обʼєкт або `null` (немає файлу / невалідний JSON / не-обʼєкт)
 */
export function readSkillMetaRaw(skillDir) {
  const metaPath = join(skillDir, 'main.json')
  if (!existsSync(metaPath)) return null
  try {
    const parsed = JSON.parse(readFileSync(metaPath, 'utf8'))
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    return /** @type {Record<string, unknown>} */ (parsed)
  } catch {
    return null
  }
}
