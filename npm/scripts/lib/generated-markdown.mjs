/**
 * Утиліти генерації AGENTS.md / CLAUDE.md з шаблонів CLI `n-cursor`.
 *
 * Після розгортання Mustache-секцій і збирання рядків CLAUDE.md нормалізує markdown,
 * щоб не лишати подвійні порожні рядки (MD012) між пунктами списку чи на стиках секцій.
 */

/**
 * Згортає три й більше послідовних `\n` до рівно двох (один порожній рядок між блоками).
 * @param {string} text вихідний markdown
 * @returns {string} markdown без послідовностей з трьох і більше `\n`
 */
export function collapseMultipleBlankLines(text) {
  return String(text).replaceAll(/\n{3,}/g, '\n\n')
}

/**
 * Розгортає блок Mustache `{{#section}}…{{/section}}` для масиву елементів.
 * Після `trim` тіла секції елементи зʼєднуються одним `\n` без зайвих порожніх рядків між ними.
 * @param {string} template вихідний текст шаблону
 * @param {string} section ім'я секції (наприклад services)
 * @param {Record<string, string>[]} items елементи для повторення тіла секції
 * @param {string} prop ключ поля для підстановки замість `{{prop}}`
 * @returns {string} шаблон після підстановки всіх входжень блоку секції
 */
export function expandMustacheSection(template, section, items, prop) {
  const open = `{{#${section}}}`
  const close = `{{/${section}}}`
  const placeholder = `{{${prop}}}`
  let result = template
  let start = result.indexOf(open)
  let end = result.indexOf(close)
  while (start !== -1 && end !== -1 && end > start) {
    const inner = result.slice(start + open.length, end).trim()
    const rendered = items.map(item => inner.split(placeholder).join(String(item[prop]))).join('\n')
    result = result.slice(0, start) + rendered + result.slice(end + close.length)
    start = result.indexOf(open)
    end = result.indexOf(close)
  }
  return result
}

/**
 * Підставляє у AGENTS.template.md списки правил, skills і команд.
 * @param {string} templateText вміст AGENTS.template.md
 * @param {string[]} mdcBasenames імена файлів (*.mdc) з .cursor/rules
 * @param {{ name: string }[]} skillItems рядки для секції Skills
 * @param {{ name: string }[]} commandItems рядки для секції commands
 * @returns {string} готовий вміст AGENTS.md без подвійних порожніх рядків у списках
 */
export function renderAgentsTemplate(templateText, mdcBasenames, skillItems, commandItems) {
  let result = templateText
  const serviceItems = mdcBasenames.map(mdcName => ({
    name: `- .cursor/rules/${mdcName}`
  }))
  result = expandMustacheSection(result, 'services', serviceItems, 'name')
  result = expandMustacheSection(result, 'skills', skillItems, 'name')
  result = expandMustacheSection(result, 'commands', commandItems, 'name')
  return collapseMultipleBlankLines(result)
}

/**
 * Збирає markdown з рядків, прибираючи подвійні порожні рядки на стиках секцій.
 * @param {string[]} lines рядки документа
 * @returns {string} зібраний markdown із завершальним `\n`
 */
export function formatGeneratedMarkdownLines(lines) {
  const text = lines.join('\n')
  const collapsed = collapseMultipleBlankLines(text)
  return collapsed.endsWith('\n') ? collapsed : `${collapsed}\n`
}
