/**
 * T0-autofix для policy-concern-а `text/cspell`: merge-запис `.cspell.json` замість
 * wholesale-перезапису (інцидент nitra/task: скаффолд-перезапис зніс локальні `words`
 * і repo-специфічні `ignorePaths` на кшталт `target/**`).
 *
 * Канон читається з template концерну (ctx.concernDir), не з тексту violation:
 * snippet (`version`, `ignorePaths`) + contains (`import`-підрядки). Гарантії merge:
 * існуючі `words`/`flagWords`/`ignorePaths` і будь-які інші поля ЗБЕРІГАЮТЬСЯ,
 * канонічне лише ДОДАЄТЬСЯ — нічого не видаляється мовчки. Заборонені import-и
 * (`@cspell/dict-*`) НЕ вирізаються автоматично: видалення — ручне рішення.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Читає JSON-файл template-а; відсутній або невалідний → null.
 * @param {string} path абсолютний шлях
 * @returns {object|null} розпарсений об'єкт або null
 */
function readTemplateJson(path) {
  if (!existsSync(path)) return null
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return null
  }
}

/**
 * Merge канону snippet-а у конфіг: масиви — union (існуючі елементи попереду, без
 * видалень), скаляри — канонічне значення (напр. `version`), об'єкти — не чіпаємо
 * (rego їх не перевіряє). Мутує `cfg`.
 * @param {Record<string, unknown>} cfg поточний `.cspell.json`
 * @param {Record<string, unknown>} snippet канон з `.cspell.json.snippet.json`
 * @returns {string[]} людиночитані описи внесених змін (порожньо — без змін)
 */
function mergeSnippet(cfg, snippet) {
  const changes = []
  for (const [key, canonical] of Object.entries(snippet)) {
    if (Array.isArray(canonical)) {
      const existing = Array.isArray(cfg[key]) ? cfg[key] : []
      const toAdd = canonical.filter(v => !existing.includes(v))
      if (toAdd.length === 0) continue
      cfg[key] = [...existing, ...toAdd]
      changes.push(`${key}: +${toAdd.length}`)
    } else if (typeof canonical !== 'object' && cfg[key] !== canonical) {
      cfg[key] = canonical
      changes.push(`${key}=${String(canonical)}`)
    }
  }
  return changes
}

/**
 * Merge contains-канону: для кожного `field` кожен needle-підрядок має зустрічатись
 * у масиві — інакше дописуємо needle як окремий елемент (існуючі записи не чіпаємо).
 * Мутує `cfg`.
 * @param {Record<string, unknown>} cfg поточний `.cspell.json`
 * @param {Record<string, string[]>} contains канон з `.cspell.json.contains.json`
 * @returns {string[]} описи внесених змін
 */
function mergeContains(cfg, contains) {
  const changes = []
  for (const [field, needles] of Object.entries(contains)) {
    const arr = Array.isArray(cfg[field]) ? cfg[field] : []
    const missing = needles.filter(n => arr.every(item => !(typeof item === 'string' && item.includes(n))))
    if (missing.length === 0) continue
    cfg[field] = [...arr, ...missing]
    changes.push(`${field}: +${missing.join(', ')}`)
  }
  return changes
}

/** @type {import('../../../scripts/lib/lint-surface/types.mjs').T0Pattern[]} */
export const patterns = [
  {
    id: 'cspell-merge',
    test: violations => violations.some(v => v.reason === 'policy-file-missing' || v.reason === 'policy-deny'),
    apply: (violations, ctx) => {
      if (!ctx.concernDir) return { touchedFiles: [] }
      const snippet = readTemplateJson(join(ctx.concernDir, 'template', '.cspell.json.snippet.json'))
      const contains = readTemplateJson(join(ctx.concernDir, 'template', '.cspell.json.contains.json'))
      if (!snippet && !contains) return { touchedFiles: [] }

      const cfgPath = join(ctx.cwd, '.cspell.json')
      const created = !existsSync(cfgPath)
      /** @type {Record<string, unknown>} */
      let cfg = {}
      if (!created) {
        try {
          cfg = JSON.parse(readFileSync(cfgPath, 'utf8'))
        } catch {
          return { touchedFiles: [] } // невалідний JSON — не чіпаємо детермінованим фіксом
        }
      }

      const changes = [...mergeSnippet(cfg, snippet ?? {}), ...mergeContains(cfg, contains ?? {})]
      // `language` — presence-only канон (rego, inverse): додаємо дефолт лише коли поля немає.
      if (!cfg.language) {
        cfg.language = 'en,uk'
        changes.push('language=en,uk')
      }
      if (changes.length === 0 && !created) return { touchedFiles: [] }

      ctx.recordWrite?.(cfgPath)
      writeFileSync(cfgPath, `${JSON.stringify(cfg, null, 2)}\n`)
      return {
        touchedFiles: [cfgPath],
        message: created
          ? `.cspell.json створено зі snippet (${changes.join('; ')})`
          : `.cspell.json merge: ${changes.join('; ')}`
      }
    }
  }
]
