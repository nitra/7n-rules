/**
 * Парсер метаданих правила з `npm/rules/<id>/meta.json` (data-driven автодетект).
 *
 * `meta.json.auto` має один із чотирьох видів:
 *  - `"завжди"`                       → always-on;
 *  - `["rule", …]`                    → активується, коли всі правила-залежності виявлені;
 *  - `{ "glob": "<pat>" | [<pat>] }`  → наявність файлів/каталогів за glob (OR);
 *  - `{ "predicate": "<name>", "arg"? }` → незводимий предикат із реєстру `rule-predicates.mjs`.
 *
 * Поля `worktree` правило НЕ має (це скілова вісь). Дзеркало `skill-meta.mjs`.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/** Літерал безумовної активації (українською, як у скілах). */
export const RULE_ALWAYS = 'завжди'

/**
 * @typedef {{ always: true } | { rules: string[] } | { glob: string[] } | { predicate: string, arg: unknown }} RuleAutoSpec
 */

/**
 * Нормалізує значення `meta.json.auto` у дискриміновану форму.
 * @param {unknown} value значення поля `auto`
 * @returns {RuleAutoSpec | null} `null` — формат не розпізнано (= opt-in)
 */
export function parseRuleAutoSpec(value) {
  if (value === RULE_ALWAYS) return { always: true }

  if (Array.isArray(value)) {
    const rules = value.map(s => String(s).trim()).filter(s => s.length > 0)
    return rules.length > 0 ? { rules } : null
  }

  if (value !== null && typeof value === 'object') {
    const obj = /** @type {Record<string, unknown>} */ (value)
    if ('glob' in obj) {
      const raw = obj.glob
      const globs = (Array.isArray(raw) ? raw : [raw]).filter(g => typeof g === 'string' && g.length > 0)
      return globs.length > 0 ? { glob: /** @type {string[]} */ (globs) } : null
    }
    if ('predicate' in obj) {
      return typeof obj.predicate === 'string' && obj.predicate.length > 0
        ? { predicate: obj.predicate, arg: obj.arg }
        : null
    }
  }
  return null
}

/** Допустимі значення `meta.json.lint` (вісь scope: чи детектор дробиться на changed-set). */
const LINT_SCOPES = new Set(['per-file', 'full'])

/**
 * Нормалізує значення `meta.json.lint` у scope детектора.
 *  - `"per-file"` — детектор декомпозується на змінені файли (дельта vs origin);
 *  - `"full"`     — нероздільно крос-файловий (лише `--full` / CI).
 * Об'єктна форма `{scope, ci}` скасована: CI=`--read-only --full` ганяє все повністю,
 * тож per-rule CI-override не потрібен (spec 2026-06-14-lint-rule-consolidation §3-А).
 * @param {unknown} value значення поля `lint`
 * @returns {'per-file' | 'full' | null} scope або `null` (відсутнє/невалідне = не lint-крок)
 */
export function parseRuleLintSpec(value) {
  return typeof value === 'string' && LINT_SCOPES.has(value) ? /** @type {'per-file'|'full'} */ (value) : null
}

/**
 * Читає й парсить `meta.json` одного правила.
 * @param {string} ruleDir абсолютний шлях до каталогу правила
 * @returns {Record<string, unknown> | null} обʼєкт або `null` (немає файлу / невалідний JSON / не-обʼєкт)
 */
export function readRuleMetaRaw(ruleDir) {
  const metaPath = join(ruleDir, 'main.json')
  if (!existsSync(metaPath)) return null
  try {
    const parsed = JSON.parse(readFileSync(metaPath, 'utf8'))
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    return /** @type {Record<string, unknown>} */ (parsed)
  } catch {
    return null
  }
}
