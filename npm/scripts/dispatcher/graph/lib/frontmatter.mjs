/**
 * YAML front-matter parser/serializer для graph task-файлів.
 *
 * Підтримує:
 * - Прості `key: value` рядки
 * - Вкладені об'єкти (блок з відступами), напр. `executor:` + indented children
 * - Списки: `deps:` / `skills:` із рядками `  - item`
 * - Серіалізацію назад у YAML (для запису front-matter)
 *
 * Чисто — без залежностей, тільки вбудований JS. FS не торкається.
 */

const FM_BOUNDARY_RE = /^---\r?\n([\s\S]*?)\r?\n---/

/**
 * Парсить YAML front-matter з markdown-тексту.
 * Повертає словник (може містити вкладені об'єкти та масиви).
 * @param {string} text вміст файлу
 * @returns {Record<string, unknown>} ключ-значення, або {} якщо front-matter відсутній
 */
export function parseFrontMatter(text) {
  const m = text.match(FM_BOUNDARY_RE)
  if (!m) return {}
  return parseYamlBlock(m[1])
}

/**
 * Отримує тіло документа (без front-matter).
 * @param {string} text вміст файлу
 * @returns {string} тіло без front-matter
 */
export function getBody(text) {
  const m = text.match(FM_BOUNDARY_RE)
  if (!m) return text
  return text.slice(m[0].length).trimStart()
}

/**
 * Парсить YAML-блок (без --- рядків).
 * @param {string} block YAML-текст
 * @returns {Record<string, unknown>} розпарсений об'єкт
 */
function parseYamlBlock(block) {
  const lines = block.split(/\r?\n/)
  const result = {}
  let i = 0

  while (i < lines.length) {
    const line = lines[i]
    if (!line.trim() || line.trimStart().startsWith('#')) {
      i++
      continue
    }

    const indent = getIndent(line)
    if (indent > 0) {
      // Верхній рівень — пропускаємо "бродячі" дочірні рядки
      i++
      continue
    }

    const colonIdx = line.indexOf(':')
    if (colonIdx === -1) {
      i++
      continue
    }

    const key = line.slice(0, colonIdx).trim()
    const rawVal = line.slice(colonIdx + 1).trim()

    if (rawVal.length > 0) {
      // Inline значення — scalar
      result[key] = parseScalar(rawVal)
      i++
    } else {
      // Значення відсутнє після ':' — дивимось наступні рядки
      i++
      if (i >= lines.length) {
        result[key] = null
        continue
      }

      const nextLine = lines[i]
      if (!nextLine.trim()) {
        result[key] = null
        continue
      }

      const nextIndent = getIndent(nextLine)
      if (nextIndent === 0) {
        // Без відступу — null
        result[key] = null
        continue
      }

      const nextTrimmed = nextLine.trimStart()
      if (nextTrimmed.startsWith('- ')) {
        // Список
        const arr = []
        while (i < lines.length) {
          const l = lines[i]
          if (!l.trim()) {
            i++
            continue
          }
          const ind = getIndent(l)
          if (ind === 0) break
          const t = l.trimStart()
          if (t.startsWith('- ')) {
            arr.push(parseScalar(t.slice(2).trim()))
          }
          i++
        }
        result[key] = arr
      } else {
        // Вкладений об'єкт
        const childLines = []
        while (i < lines.length) {
          const l = lines[i]
          if (!l.trim()) {
            i++
            continue
          }
          if (getIndent(l) === 0) break
          // Нормалізуємо відступ (видаляємо перший рівень)
          childLines.push(l.slice(nextIndent))
          i++
        }
        result[key] = parseYamlBlock(childLines.join('\n'))
      }
    }
  }

  return result
}

/**
 * Повертає кількість пробілів на початку рядка.
 * @param {string} line рядок
 * @returns {number} кількість пробілів
 */
function getIndent(line) {
  let count = 0
  for (const ch of line) {
    if (ch === ' ') count++
    else break
  }
  return count
}

/**
 * Парсить скалярне значення: число, булеве, null, або рядок.
 * @param {string} s рядок-значення
 * @returns {unknown} розпарсене значення
 */
function parseScalar(s) {
  if (s === 'true') return true
  if (s === 'false') return false
  if (s === 'null' || s === '~') return null
  const n = Number(s)
  if (!Number.isNaN(n) && s.trim().length > 0) return n
  // Знімаємо лапки
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1)
  }
  return s
}

/**
 * Серіалізує об'єкт у YAML-рядок (для front-matter).
 * Підтримує прості scalar, масиви та вкладені об'єкти.
 * @param {Record<string, unknown>} obj об'єкт для серіалізації
 * @param {number} [indentLevel=0] рівень відступу
 * @returns {string} YAML-рядок (без --- маркерів)
 */
export function serializeYaml(obj, indentLevel = 0) {
  const indent = '  '.repeat(indentLevel)
  const lines = []

  for (const [key, val] of Object.entries(obj)) {
    if (val === null || val === undefined) {
      lines.push(`${indent}${key}:`)
    } else if (Array.isArray(val)) {
      lines.push(`${indent}${key}:`)
      for (const item of val) {
        lines.push(`${indent}  - ${serializeScalar(item)}`)
      }
    } else if (typeof val === 'object') {
      lines.push(`${indent}${key}:`)
      lines.push(serializeYaml(val, indentLevel + 1))
    } else {
      lines.push(`${indent}${key}: ${serializeScalar(val)}`)
    }
  }

  return lines.join('\n')
}

/**
 * Серіалізує скалярне значення у рядок.
 * @param {unknown} val значення
 * @returns {string} рядкове представлення
 */
function serializeScalar(val) {
  if (typeof val === 'string') {
    // Додаємо лапки якщо містить спецсимволи
    if (/[:#\[\]{},\n]/.test(val) || val.trim() !== val) {
      return `"${val.replace(/"/g, '\\"')}"`
    }
    return val
  }
  return String(val)
}

/**
 * Будує markdown-файл із front-matter і тілом.
 * @param {Record<string, unknown>} fm об'єкт front-matter
 * @param {string} [body=''] тіло документа
 * @returns {string} повний вміст файлу
 */
export function buildMarkdown(fm, body = '') {
  const yaml = serializeYaml(fm)
  return ['---', yaml, '---', '', body].join('\n')
}
