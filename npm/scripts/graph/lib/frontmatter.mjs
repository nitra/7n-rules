/**
 * Мінімальний YAML-фронтматер парсер для Markdown-файлів.
 * Підтримує: рядки, числа, boolean, масиви (flow і block), вкладені об'єкти (один рівень).
 */

const FM_RE = /^---\r?\n([\s\S]*?)\r?\n---/u

/**
 * @param {string} content вміст md-файлу
 * @returns {{ data: Record<string, unknown>, body: string }}
 */
export function parseFrontmatter(content) {
  const m = FM_RE.exec(content)
  if (!m) return { data: {}, body: content }
  const raw = m[1]
  const body = content.slice(m[0].length).trimStart()
  return { data: parseYamlBlock(raw), body }
}

/**
 * @param {string} block YAML-блок між ---
 * @returns {Record<string, unknown>}
 */
function parseYamlBlock(block) {
  const result = {}
  const lines = block.split(/\r?\n/u)
  let i = 0

  while (i < lines.length) {
    const line = lines[i]
    const keyMatch = /^([a-z_][a-z0-9_]*):\s*(.*)/iu.exec(line)
    if (!keyMatch) { i++; continue }

    const key = keyMatch[1]
    const rest = keyMatch[2].trim()

    if (rest === '' || rest === '|' || rest === '>') {
      // block scalar або об'єкт — збираємо indented рядки
      const children = []
      i++
      while (i < lines.length && /^\s+/u.test(lines[i])) {
        children.push(lines[i])
        i++
      }
      if (children.length > 0 && /^\s+-\s+/u.test(children[0])) {
        result[key] = children.map(l => l.replace(/^\s+-\s+/u, '').trim())
      } else {
        result[key] = parseYamlBlock(children.map(l => l.replace(/^\s{2}/u, '')).join('\n'))
      }
    } else if (rest.startsWith('[')) {
      result[key] = rest.slice(1, rest.lastIndexOf(']')).split(',').map(s => s.trim()).filter(Boolean)
      i++
    } else {
      result[key] = parseScalar(rest)
      i++
    }
  }

  return result
}

/** @param {string} s */
function parseScalar(s) {
  if (s === 'true') return true
  if (s === 'false') return false
  if (s === 'null' || s === '~') return null
  const n = Number(s)
  if (!Number.isNaN(n) && s !== '') return n
  return s.replace(/^["']|["']$/gu, '')
}
