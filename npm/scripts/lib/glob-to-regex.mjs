/**
 * Перетворення glob-патернів у RegExp — утиліт рушія авто-детекту правил
 * (`auto-rules.mjs` матчить `main.json:auto.glob` по зміненим файлам) і
 * перевірок `files` у package.json (правило npm-module з `@7n/rules-lang-js`).
 * Живе в ядрі (фаза 5c spec lang-plugins-extraction): рушій не залежить від
 * плагінів, а плагінні правила імпортують через `@7n/rules/scripts/lib/…`.
 */

/** Символи зі спеціальним значенням у RegExp, які в glob — літерали (екрануємо). */
const REGEX_SPECIAL_IN_GLOB = new Set(['.', '+', '^', '$', '{', '}', '(', ')', '|', '[', ']', '\\'])

const GLOBSTAR_LEADING_RE = /^__GLOBSTAR__\//u
const GLOBSTAR_TRAILING_RE = /\/__GLOBSTAR__$/u

/**
 * Перетворює glob-патерн (як у npm `files` чи `main.json:auto.glob`) у `RegExp`
 * з якорями `^` / `$`. Підтримує globstar (нуль або більше сегментів), `*`
 * (символи без `/`), `?` (один символ без `/`) і brace-альтернативи `{a,b,c}`
 * (наприклад `*.{png,jpg,svg}` → `(?:png|jpg|svg)`). Клас `[…]` не
 * підтримується — у негативних патернах `files` цього достатньо.
 * @param {string} glob posix-шлях у glob-нотації
 * @returns {RegExp} `RegExp` з якорями `^` / `$`
 */
export function globToRegex(glob) {
  const parts = glob.split('/')
  const tokens = parts.map(p => {
    if (p === '**') return '__GLOBSTAR__'
    let out = ''
    let braceDepth = 0
    for (const c of p) {
      switch (c) {
        case '*': {
          out += '[^/]*'
          continue
        }
        case '?': {
          out += '[^/]'
          continue
        }
        case '{': {
          out += '(?:'
          braceDepth++
          continue
        }
        case '}': {
          if (braceDepth > 0) {
            out += ')'
            braceDepth--
            continue
          }
          break
        }
        case ',': {
          if (braceDepth > 0) {
            out += '|'
            continue
          }
          break
        }
        default: {
          break
        }
      }
      out += REGEX_SPECIAL_IN_GLOB.has(c) ? `\\${c}` : c
    }
    return out
  })
  let re = tokens.join('/')
  re = re.replaceAll('/__GLOBSTAR__/', '(?:/.*/|/)')
  re = re.replace(GLOBSTAR_LEADING_RE, '(?:.*/)?')
  re = re.replace(GLOBSTAR_TRAILING_RE, '(?:/.*)?')
  re = re.replaceAll('__GLOBSTAR__', '.*')
  // Дозволено: уся функція існує саме для конструкції RegExp з glob-pattern
  // (значення з package.json `files` або main.json `auto.glob`, не від
  // кінцевого користувача), і спецсимволи вже екрановано через
  // `REGEX_SPECIAL_IN_GLOB` вище.
  // eslint-disable-next-line security/detect-non-literal-regexp
  return new RegExp(`^${re}$`, 'u')
}
