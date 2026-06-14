/** @see ./docs/units-rs.md */

/**
 * Пропускає рядковий літерал `"..."` (з escape-послідовностями).
 * @param {string} src вміст файлу
 * @param {number} i позиція відкриваючого `"`
 * @returns {number} позиція ПІСЛЯ закриваючого `"`
 */
function skipString(src, i) {
  i++ // відкриваючий "
  while (i < src.length) {
    if (src[i] === '\\') {
      i += 2
      continue
    }
    if (src[i] === '"') return i + 1
    i++
  }
  return i
}

/**
 * Знаходить індекс закриваючої `}` для відкриваючої `{` на позиції `start`.
 * Правильно пропускає рядки/блочні коментарі та рядкові літерали.
 * @param {string} src вміст файлу
 * @param {number} start позиція відкриваючої `{`
 * @returns {number} індекс `}` або -1, якщо не знайдено
 */
function findClosingBrace(src, start) {
  let depth = 0
  let i = start
  while (i < src.length) {
    const ch = src[i]
    if (ch === '/' && src[i + 1] === '/') {
      const nl = src.indexOf('\n', i)
      i = nl === -1 ? src.length : nl + 1
      continue
    }
    if (ch === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2)
      i = end === -1 ? src.length : end + 2
      continue
    }
    if (ch === '"') {
      i = skipString(src, i)
      continue
    }
    if (ch === '{') {
      depth++
      i++
      continue
    }
    if (ch === '}') {
      depth--
      if (depth === 0) return i
      i++
      continue
    }
    i++
  }
  return -1
}

/**
 * Видобуває `///` doc-рядки безпосередньо перед рядком `lineIdx`.
 * Сканує назад через `///`, `#[...]` та пусті рядки.
 * @param {string[]} lines рядки файлу
 * @param {number} lineIdx рядок декларації
 * @returns {string} склеєний опис або ''
 */
function docBefore(lines, lineIdx) {
  const doc = []
  for (let i = lineIdx - 1; i >= 0; i--) {
    const t = lines[i].trim()
    if (t.startsWith('///')) {
      doc.unshift(t.slice(3).trim())
    } else if (t.startsWith('#[') || t.startsWith('#![') || t === '') {
      // пропустити атрибути та пусті рядки
    } else {
      break
    }
  }
  return doc.join(' ').trim()
}

// Pub-items матчаться у два кроки по trim-нутому рядку (прості регекспи без
// бектрекінгу): спершу опційний pub(...)-префікс, потім сама декларація.
// Також ловить fn без pub (для localSymbols і impl-методів)
const PUB_PREFIX_RE = /^pub(?:\([^)]*\))?\s+/
const ITEM_DECL_RE = /^(?:async\s+)?(?:unsafe\s+)?(fn|struct|enum|trait|type)\s+(\w+)/

// impl Type { або impl<T> Trait for Type { — теж двокроково: голова `impl<...>`,
// далі тип після `for` (trait-impl) або перше слово (inherent impl)
const IMPL_HEAD_RE = /^impl(?:<[^>]*>)?\s+/
const IMPL_FOR_TYPE_RE = /\bfor\s+(\w+)/
const TYPE_NAME_RE = /^(\w+)/

// Підозрілі exposure-атрибути, що роблять непуб-fn фактично публічними
const EXPOSURE_ATTR_RE = /#\[(?:tauri::command|wasm_bindgen|uniffi::export|pyo3::pyfunction|napi)/

// Базовий виклик fn-імені (для call-graph всередині юніта)
const CALL_RE = /\b([a-z_]\w*)\s*\(/g

/**
 * Юніт-екстрактор для `.rs` файлів.
 * Визначає top-level і impl-методи через підрахунок дужок по рядках.
 * Відомі обмеження: рядкові літерали з `{`/`}` всередині `{}` можуть дати
 * хибну глибину (рідкісно в реальному Rust-коді з rustfmt).
 * @param {string} src вміст файлу
 * @param {string} [_relPath] резервний (не використовується)
 * @returns {Array<{name:string, kind:string, exported:boolean, implName:string|null, span:{start:number,end:number}, body:string, calls:string[], doc:string}>|null} юніти файлу (fn та impl-методи) або `null`, якщо юнітів не знайдено
 */
export function extractUnitsRs(src, _relPath) {
  const lines = src.split('\n')
  const units = []
  let depth = 0
  let lineOffset = 0
  // Стек відкритих impl: { typeName, openDepth }
  const implStack = []
  // Флаг: наступний fn отримує exposure (через #[tauri::command] тощо)
  let nextFnExposed = false

  for (let li = 0; li < lines.length; li++) {
    const line = lines[li]
    const depthAtStart = depth

    // Підраховуємо `{` і `}` в рядку (пропускаємо рядкові коментарі та рядки)
    let j = 0
    while (j < line.length) {
      const ch = line[j]
      if (ch === '/' && line[j + 1] === '/') break
      if (ch === '"') {
        j++
        while (j < line.length && line[j] !== '"') {
          if (line[j] === '\\') j++
          j++
        }
        j++
        continue
      }
      if (ch === '{') depth++
      else if (ch === '}') depth--
      j++
    }

    // Закриті impl-блоки прибираємо зі стека
    while (implStack.length > 0 && implStack.at(-1).openDepth > depth) {
      implStack.pop()
    }

    const currentImpl = implStack.at(-1)?.typeName ?? null

    // Перевіряємо exposure-атрибути
    if (EXPOSURE_ATTR_RE.test(line)) {
      nextFnExposed = true
    }

    const trimmed = line.trimStart()

    // Impl-декларація (зазвичай глибина 0, але може бути в mod)
    if (depthAtStart <= 1) {
      const headM = trimmed.match(IMPL_HEAD_RE)
      if (headM && line.includes('{')) {
        const rest = trimmed.slice(headM[0].length)
        const typeM = rest.match(IMPL_FOR_TYPE_RE) ?? rest.match(TYPE_NAME_RE)
        if (typeM) implStack.push({ typeName: typeM[1], openDepth: depth })
      }
    }

    // Елементи на глибині 0 (top-level) і 1 (всередині impl)
    if (depthAtStart <= 1) {
      const pubM = trimmed.match(PUB_PREFIX_RE)
      const m = (pubM ? trimmed.slice(pubM[0].length) : trimmed).match(ITEM_DECL_RE)
      if (m) {
        const isPub = Boolean(pubM) || (m[1] === 'fn' && nextFnExposed)
        if (m[1] === 'fn') nextFnExposed = false
        const kind = m[1]
        const name = m[2]
        const doc = docBefore(lines, li)

        // Витягуємо тіло через findClosingBrace для fn/struct/enum/trait
        let body = ''
        let itemEnd = lineOffset + line.length
        if (kind !== 'type') {
          const openBraceIdx = src.indexOf('{', lineOffset)
          // Шукаємо `{` не далі ніж через 3 рядки від початку декларації
          const threeLines = lines.slice(li, li + 3).join('\n').length
          if (openBraceIdx !== -1 && openBraceIdx - lineOffset <= threeLines) {
            const closeIdx = findClosingBrace(src, openBraceIdx)
            if (closeIdx !== -1) {
              itemEnd = closeIdx + 1
              body = src.slice(lineOffset, itemEnd)
            }
          }
        }

        units.push({
          name,
          kind,
          exported: isPub,
          implName: depthAtStart === 1 ? currentImpl : null,
          span: { start: lineOffset, end: itemEnd },
          body,
          calls: [],
          doc
        })
      } else {
        // Рядок не є item — скидаємо exposure-флаг якщо не атрибут
        const t = line.trim()
        if (!t.startsWith('#[') && !t.startsWith('#![') && !t.startsWith('///') && t !== '') {
          nextFnExposed = false
        }
      }
    }

    lineOffset += line.length + 1 // +1 для '\n'
  }

  // Базовий call-graph: виклики інших юнітів цього файлу
  const unitNames = new Set(units.map(u => u.name))
  for (const u of units) {
    if (!u.body) continue
    const calls = new Set()
    let cm
    const re = new RegExp(CALL_RE.source, 'g')
    while ((cm = re.exec(u.body)) !== null) {
      if (unitNames.has(cm[1]) && cm[1] !== u.name) calls.add(cm[1])
    }
    u.calls = [...calls]
  }

  return units.length > 0 ? units : null
}
