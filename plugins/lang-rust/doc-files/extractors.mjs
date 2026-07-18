/** @see ./docs/extractors.md */
import { extractUnitsRs } from './units-rs.mjs'

/**
 * Мовний doc-files-екстрактор Rust для конвеєра `@7n/rules` (extension-point
 * `doc-files`, фаза 4 spec lang-plugins-extraction): факт-лист (`extractFacts`)
 * і юніти (`extractUnits`) для `.rs`-файлів. Розширення `.rs` → 'Rust Module'
 * декларується маніфестом плагіна (`contributes.docFiles.extensions`) — hot-path
 * ядра читає його синхронно; цей модуль вантажиться лише на шляху генерації.
 */

// ── Rust-екстрактор ──────────────────────────────────────────────────────────

// pub fn / pub struct / pub enum / pub trait (та fn із exposure-атрибутом)
// матчаться у два кроки по trim-нутому рядку — прості регекспи без бектрекінгу:
// спершу опційний pub(...)-префікс, потім сама декларація
const RS_PUB_PREFIX_RE = /^pub(?:\([^)]*\))?\s+/
const RS_ITEM_DECL_RE = /^(?:async\s+)?(?:unsafe\s+)?(fn|struct|enum|trait|type)\s+(\w+)/

// fn-декларація у trim-нутому рядку одразу після exposure-атрибута
const RS_FN_AFTER_ATTR_RE = /^(?:pub\s+)?(?:async\s+)?(?:unsafe\s+)?fn\s+/

// Будь-яка fn-декларація без pub (для приватних localSymbols)
const RS_PRIVATE_FN_RE = /^[ \t]*(?:async\s+)?(?:unsafe\s+)?fn\s+(\w+)/

// Exposure-атрибути (#[tauri::command] тощо)
const RS_EXPOSURE_ATTR_RE = /#\[(?:tauri::command|wasm_bindgen|uniffi::export|pyo3::pyfunction|napi)/gm

// use crate::module::{A, B}  або  use std::..;
const RS_USE_RE = /^[ \t]*use\s+([\w:]+(?:::\{[^}]+\})?(?:::\*)?(?:::\w+)?)\s*;/gm

// Файловий запис: fs::write / File::create / remove_file / create_dir / write_all
const RS_WRITE_RE = /fs::write|File::create|remove_file|create_dir|BufWriter::new|OpenOptions[^;]*\.write\s*\(\s*true/

// Raw-SQL запис через sqlx-подібні макро/виклики (query!/query/execute) — DML-
// keyword одразу після відкриваючої лапки рядкового літералу (той самий
// мінімальний тег+вміст сигнал, що й для JS tagged-template, SQL_TAGGED_MUTATION_RE)
const RS_SQL_WRITE_RE = /\b(?:query!?|execute)\s*\(\s*"\s*(?:UPDATE|INSERT|MERGE\s+INTO|DELETE\s+FROM|UPSERT)\b/i

// Обробка помилок (але не просто `?`): прості маркери; випадок
// «match … з Err(-гілкою» — віконним обходом рядків у rsHasMatchWithErrArm
const RS_CATCH_SIMPLE_RES = [/\.unwrap_or(?:_else|_default)?/, /if\s+let\s+Err\s*\(/, /\.map_err\s*\(/, /\.ok\s*\(\)/]
const RS_MATCH_KW_RE = /\bmatch\s/
const RS_ERR_ARM_RE = /\bErr\s*\(/

// Функції, що повертають Result або Option
const RS_RESULT_RE = /->\s*(?:Result|Option)\s*</

// Мережа
const RS_NETWORK_RE = /reqwest|hyper::|TcpStream|UdpSocket|tokio::net/

// Кешування
const RS_CACHE_RE = /\bcache\b|\bCache\b|lazy_static!|OnceCell|OnceLock|DashMap/i

/**
 * Чи містить джерело `match`-вираз із `Err(`-гілкою неподалік (вікно 12 рядків).
 * Замінює бектрекінг-вразливу регулярку детермінованим обходом рядків.
 * @param {string[]} srcLines рядки файлу
 * @returns {boolean} true, якщо за `match` слідує `Err(`
 */
function rsHasMatchWithErrArm(srcLines) {
  for (let i = 0; i < srcLines.length; i++) {
    if (!RS_MATCH_KW_RE.test(srcLines[i])) continue
    const end = Math.min(i + 12, srcLines.length)
    for (let j = i; j < end; j++) if (RS_ERR_ARM_RE.test(srcLines[j])) return true
  }
  return false
}

/**
 * Видобуває `///` doc-рядки перед рядком `lineIdx` (назад через `#[...]` та пусті рядки).
 * @param {string[]} lines рядки файлу
 * @param {number} lineIdx індекс рядка декларації
 * @returns {string} опис або ''
 */
function rsDocBefore(lines, lineIdx) {
  const doc = []
  for (let i = lineIdx - 1; i >= 0; i--) {
    const t = lines[i].trim()
    if (t.startsWith('///')) doc.unshift(t.slice(3).trim())
    else if (t.startsWith('#[') || t.startsWith('#![') || t === '') {
      /* skip */
    } else break
  }
  return doc.join(' ').trim()
}

/**
 * Витягує module-level doc (`//!`) із голови `.rs` файлу.
 * @param {string} src вміст файлу
 * @returns {string} злитий header-текст
 */
function rsExtractHeader(src) {
  const headerLines = []
  for (const line of src.split('\n')) {
    const t = line.trim()
    if (t.startsWith('//!')) headerLines.push(t.slice(3).trim())
    else if (t === '' || t.startsWith('//')) continue
    else break
  }
  return headerLines.join(' ').trim()
}

/**
 * Обчислює номери рядків із `fn`, які стають фактично `pub` через exposure-атрибути.
 * @param {string} src вміст файлу
 * @param {string[]} srcLines рядки файлу
 * @returns {Set<number>} індекси exposure-exposed fn-рядків
 */
function rsExposedLineSet(src, srcLines) {
  const exposedLineSet = new Set()
  for (const m of src.matchAll(RS_EXPOSURE_ATTR_RE)) {
    // Знаходимо, який рядок містить цей атрибут
    let pos = 0
    for (let li = 0; li < srcLines.length; li++) {
      if (pos + srcLines[li].length >= m.index) {
        // Шукаємо наступний не-атрибутний рядок з fn
        for (let nli = li + 1; nli < Math.min(li + 5, srcLines.length); nli++) {
          const t = srcLines[nli].trim()
          if (t.startsWith('#[') || t === '') continue
          if (RS_FN_AFTER_ATTR_RE.test(t)) exposedLineSet.add(nli)
          break
        }
        break
      }
      pos += srcLines[li].length + 1
    }
  }
  return exposedLineSet
}

/**
 * Збирає публічні items (`pub` + exposure-exposed) `.rs` файлу.
 * @param {string[]} srcLines рядки файлу
 * @param {Set<number>} exposedLineSet індекси exposure-exposed fn-рядків
 * @returns {Array<{name:string, kind:string, desc:string}>} перелік exports
 */
function rsCollectExports(srcLines, exposedLineSet) {
  const exports = []
  for (let li = 0; li < srcLines.length; li++) {
    const trimmed = srcLines[li].trimStart()
    const pubM = trimmed.match(RS_PUB_PREFIX_RE)
    const m = (pubM ? trimmed.slice(pubM[0].length) : trimmed).match(RS_ITEM_DECL_RE)
    if (m) {
      const isPub = Boolean(pubM) || exposedLineSet.has(li)
      if (isPub) {
        const desc = rsDocBefore(srcLines, li)
        exports.push({ name: m[2], kind: m[1], desc })
      }
    }
  }
  return exports
}

/**
 * Класифікує `use`-рядки `.rs` файлу на std / external / internal.
 * @param {string} src вміст файлу
 * @returns {{stdlib:string[], external:string[], internal:string[]}} згруповані imports
 */
function rsExtractImports(src) {
  const stdlib = new Set()
  const external = new Set()
  for (const m of src.matchAll(RS_USE_RE)) {
    const path = m[1]
    const root = path.split('::', 1)[0]
    if (root === 'std' || root === 'core' || root === 'alloc') stdlib.add(path)
    else external.add(path)
  }
  return { stdlib: [...stdlib], external: [...external], internal: [] }
}

/**
 * Витягує факт-лист для `.rs` файлу.
 * @param {string} src вміст файлу
 * @param {string} relPath відносний шлях
 * @returns {object} факт-лист без `unsupported`
 */
export function extractFactsRust(src, relPath) {
  const header = rsExtractHeader(src)
  const srcLines = src.split('\n')
  const exposedLineSet = rsExposedLineSet(src, srcLines)
  const exports = rsCollectExports(srcLines, exposedLineSet)

  // localSymbols — приватні fn (не pub і не exposed) — не документуємо як публічний API
  const localSymbols = []
  for (const line of srcLines) {
    const m = line.match(RS_PRIVATE_FN_RE)
    if (m && exports.every(e => e.name !== m[1])) localSymbols.push(m[1])
  }

  const imports = rsExtractImports(src)

  // markers
  const markers = {
    readOnly: !RS_WRITE_RE.test(src) && !RS_SQL_WRITE_RE.test(src),
    catchesErrors: RS_CATCH_SIMPLE_RES.some(re => re.test(src)) || rsHasMatchWithErrArm(srcLines),
    returnsFalsyOnFail: RS_RESULT_RE.test(src),
    network: RS_NETWORK_RE.test(src),
    caches: RS_CACHE_RE.test(src),
    skips: []
  }

  return { relPath, lang: 'rs', header, exports, imports, internalSymbols: [], localSymbols, markers }
}

/**
 * Default-експорт для handler-модуля extension-point `doc-files`.
 * @type {{ id: string, extensions: string[], extractFacts: typeof extractFactsRust, extractUnits: typeof extractUnitsRs }}
 */
const rustDocFilesExtractor = {
  id: 'rust',
  extensions: ['.rs'],
  extractFacts: extractFactsRust,
  extractUnits: extractUnitsRs
}

export default rustDocFilesExtractor
