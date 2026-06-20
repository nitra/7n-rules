/** @see ./docs/docgen-extract-anchors.md */

const URL_RE = /https?:\/\/[^\s'"`)<>]+/g
// Після обрізання template-частини URL має лишитися host (R10).
const STATIC_URL_RE = /^https?:\/\/[^/${]+/
const EXPORT_CONST_RE = /export\s+const\s+([A-Z][A-Z0-9_]+)\s*=\s*(['"`])([^'"`]+)\2/g
const ERROR_MARKER_RE = /\(([a-z][\w-]*\.mdc)\)/g
// Повне ім'я json-конфіга (з опційним провідним дотом). Lookbehind `(?<![\w.])`
// не дає почати матч усередині складеного імені — інакше `settings.local.json`
// дало б хибний анкор `.local.json`, а `capacitor.config.json` → `.config.json`,
// і модель, маючи їх у «обов'язкових анкорах», писала б неіснуючий файл як факт.
const CONFIG_REF_RE = /(?<![\w.])(\.?[a-z][\w.-]*\.json)\b/gi
const FILE_HEADER_RE = /^\s*\/\*\*([\s\S]*?)\*\//
const CODE_BLOCK_RE = /```[a-z]{0,12}\n([\s\S]*?)\n[ \t]{0,8}\*?[ \t]{0,8}```/g

/**
 * Dedup масив, зберігаючи порядок появи.
 * @param {Array<string>} arr вхідний масив
 * @returns {Array<string>} масив без дублікатів у вихідному порядку
 */
function uniq(arr) {
  const seen = new Set()
  const out = []
  for (const x of arr) {
    if (!seen.has(x)) {
      seen.add(x)
      out.push(x)
    }
  }
  return out
}

/**
 * Витягує анкори з вихідного коду файла.
 * @param {string} src вміст файлу
 * @returns {{
 *   urls: string[],
 *   magicStrings: Array<{name:string, value:string}>,
 *   errorMarkers: string[],
 *   configRefs: string[],
 *   examples: string[]
 * }} категоризовані анкори файлу
 */
export function extractAnchors(src) {
  // R10: template-literal URL (`https://h/${expr}/x`) — обрізаємо на `${`, лишаючи
  // статичний префікс. Інакше анкор тягне у доку сміття типу `…/${encodeURIComponent(name`.
  const urls = uniq(
    Array.from(src.matchAll(URL_RE), m => m[0])
      .map(u => {
        const i = u.indexOf('${')
        return i === -1 ? u : u.slice(0, i)
      })
      .filter(u => STATIC_URL_RE.test(u))
  )

  const magicStrings = []
  const seenNames = new Set()
  for (const m of src.matchAll(EXPORT_CONST_RE)) {
    const name = m[1]
    const value = m[3]
    if (!seenNames.has(name) && value.length <= 120) {
      seenNames.add(name)
      magicStrings.push({ name, value })
    }
  }

  const errorMarkers = uniq(Array.from(src.matchAll(ERROR_MARKER_RE), m => m[1]))
  const configRefs = uniq(Array.from(src.matchAll(CONFIG_REF_RE), m => m[1]))

  // Витягуємо code-block приклади тільки з file-header — там автор зазвичай показує контракт.
  const headerMatch = src.match(FILE_HEADER_RE)
  const examples = headerMatch ? uniq(Array.from(headerMatch[1].matchAll(CODE_BLOCK_RE), m => m[1].trim())) : []

  return { urls, magicStrings, errorMarkers, configRefs, examples }
}

/**
 * Плоский список анкор-токенів, які мають дослівно зʼявитися в документі (R5):
 * URLs, імена констант-рядків, маркери `(rule.mdc)`, конфіги. Приклади й
 * code-блоки опускаються — їх багаторядковість не звіряється підрядком.
 * @param {ReturnType<typeof extractAnchors>} a анкори файлу
 * @returns {string[]} токени для перевірки покриття/валідності
 */
export function anchorTokens(a) {
  return [...a.urls, ...a.magicStrings.map(s => s.name), ...a.errorMarkers.map(m => `(${m})`), ...a.configRefs]
}

/**
 * Форматує анкори у компактний текст для system-промпта.
 * Якщо анкорів немає взагалі — повертає порожній рядок (системний блок про
 * анкори не додається, щоб не вводити LLM в оману «обовʼязковими» полями).
 * @param {ReturnType<typeof extractAnchors>} a анкори файлу
 * @returns {string} компактний текстовий блок або порожній рядок
 */
export function anchorsToPrompt(a) {
  const blocks = []
  if (a.urls.length) blocks.push(`URLs (згадай у тексті): ${a.urls.join(', ')}`)
  if (a.magicStrings.length) {
    const consts = a.magicStrings.map(s => s.name + '=' + JSON.stringify(s.value)).join('; ')
    blocks.push(`Експортовані константи-рядки (наведи назву і призначення): ${consts}`)
  }
  if (a.errorMarkers.length) {
    const markers = a.errorMarkers.map(m => '(' + m + ')').join(', ')
    blocks.push(`Маркери повідомлень (згадай у Поведінці): ${markers}`)
  }
  if (a.configRefs.length) blocks.push(`Конфіги, на які спирається код: ${a.configRefs.join(', ')}`)
  if (a.examples.length) {
    const fenced = a.examples.map(e => '```\n' + e + '\n```').join('\n')
    blocks.push(`Приклади з документації автора (наведи дослівно у Поведінці):\n${fenced}`)
  }
  if (!blocks.length) return ''
  return `АНКОРИ ДО ОБОВ'ЯЗКОВОГО ВКЛЮЧЕННЯ:\n${blocks.join('\n')}`
}
