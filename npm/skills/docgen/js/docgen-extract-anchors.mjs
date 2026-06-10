/**
 * E1 (Fact-anchoring): детермінований витяг «анкорів» — конкретних фрагментів
 * з коду, які LLM зобовʼязана згадати в документації, щоб не зісковзнути на
 * generic-фрази.
 *
 * Категорії анкорів:
 *   - urls         : усі https?://… у вихідному коді
 *   - magicStrings : export const X = '…' з непорожнім value (≤120 символів)
 *   - errorMarkers : суфікси повідомлень про помилки виду `(rule.mdc)`
 *   - configRefs   : посилання на .json-конфіги проєкту (.n-cursor.json, …)
 *   - examples     : ```…```-блоки у file-header JSDoc (першому коментарі файла)
 *
 * Всі регулярки — на сирому src без AST: дешево, безпечно, без false-positive
 * критичної ваги (надмір — менша проблема, ніж пропуск).
 */

const URL_RE = /https?:\/\/[^\s'"`)<>]+/g
const EXPORT_CONST_RE = /export\s+const\s+([A-Z][A-Z0-9_]+)\s*=\s*(['"`])([^'"`]+)\2/g
const ERROR_MARKER_RE = /\(([a-z][\w-]*\.mdc)\)/g
const CONFIG_REF_RE = /\b(\.[a-z][\w.-]*\.json)\b/gi
const FILE_HEADER_RE = /^\s*\/\*\*([\s\S]*?)\*\//
const CODE_BLOCK_RE = /```[a-z]*\n([\s\S]*?)\n\s*\*?\s*```/g

/** Dedup масив, зберігаючи порядок появи. */
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
 * @param {string} src
 * @returns {{
 *   urls: string[],
 *   magicStrings: Array<{name:string, value:string}>,
 *   errorMarkers: string[],
 *   configRefs: string[],
 *   examples: string[]
 * }}
 */
export function extractAnchors(src) {
  const urls = uniq([...src.matchAll(URL_RE)].map(m => m[0]))

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

  const errorMarkers = uniq([...src.matchAll(ERROR_MARKER_RE)].map(m => m[1]))
  const configRefs = uniq([...src.matchAll(CONFIG_REF_RE)].map(m => m[1]))

  // Витягуємо code-block приклади тільки з file-header — там автор зазвичай показує контракт.
  const headerMatch = src.match(FILE_HEADER_RE)
  const examples = headerMatch ? uniq([...headerMatch[1].matchAll(CODE_BLOCK_RE)].map(m => m[1].trim())) : []

  return { urls, magicStrings, errorMarkers, configRefs, examples }
}

/**
 * Форматує анкори у компактний текст для system-промпта.
 * Якщо анкорів немає взагалі — повертає порожній рядок (системний блок про
 * анкори не додається, щоб не вводити LLM в оману «обовʼязковими» полями).
 * @param {ReturnType<typeof extractAnchors>} a
 * @returns {string}
 */
export function anchorsToPrompt(a) {
  const blocks = []
  if (a.urls.length) blocks.push(`URLs (згадай у тексті): ${a.urls.join(', ')}`)
  if (a.magicStrings.length) {
    blocks.push(
      `Експортовані константи-рядки (наведи назву і призначення): ${a.magicStrings.map(s => `${s.name}=${JSON.stringify(s.value)}`).join('; ')}`
    )
  }
  if (a.errorMarkers.length) blocks.push(`Маркери повідомлень (згадай у Поведінці): ${a.errorMarkers.map(m => `(${m})`).join(', ')}`)
  if (a.configRefs.length) blocks.push(`Конфіги, на які спирається код: ${a.configRefs.join(', ')}`)
  if (a.examples.length) blocks.push(`Приклади з документації автора (наведи дослівно у Поведінці):\n${a.examples.map(e => '```\n' + e + '\n```').join('\n')}`)
  if (!blocks.length) return ''
  return `АНКОРИ ДО ОБОВ'ЯЗКОВОГО ВКЛЮЧЕННЯ:\n${blocks.join('\n')}`
}
