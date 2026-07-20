/** @see ./docs/extractors.md */
import { extractUnitsJs } from './units-js.mjs'
import { extractFactsVue, extractUnitsVue } from './vue.mjs'

/**
 * Мовний doc-files-екстрактор JS-екосистеми для конвеєра `@7n/rules`
 * (extension-point `doc-files`, фаза 5b spec lang-plugins-extraction: ядро —
 * двигун без мовної специфіки): факт-лист (`extractFacts`) для js/mjs/ts і
 * юніти (`extractUnits`) через oxc AST. Розширення `.js`/`.mjs`/`.ts`/`.vue`
 * та їхні OKF-типи декларуються маніфестом плагіна
 * (`contributes.docFiles.extensions`) — hot-path ядра читає їх синхронно;
 * цей модуль вантажиться лише на шляху генерації.
 */

const BUILTIN_MODULES = new Set([
  'fs',
  'path',
  'crypto',
  'os',
  'util',
  'stream',
  'events',
  'http',
  'https',
  'url',
  'child_process',
  'process',
  'assert',
  'buffer',
  'zlib',
  'readline'
])

const JSDOC_OPEN_RE = /^\s*\/\*\*?/
const JSDOC_CLOSE_RE = /\*\/\s*$/
const STAR_PREFIX_RE = /^\s*\*?\s?/
const PARAM_LINE_RE = /^@param[ \t]{1,8}(?:\{[^}]{0,200}\}[ \t]{1,8})?\[?([\w.]{1,80})\]?[ \t]{0,8}(.{0,400})$/
const RETURNS_LINE_RE = /^@returns?[ \t]{1,8}(?:\{[^}]{0,200}\}[ \t]{1,8})?(.{0,400})$/
const FILE_HEADER_RE = /^\s*\/\*\*([\s\S]*?)\*\//
const PRECEDING_JSDOC_RE = /\/\*\*(?:(?!\*\/)[\s\S])*\*\/\s*$/
const EXPORT_DECL_RE = /export\s+(?:async\s+)?(function|const|class)\s+(\w+)/g
// Top-level function/class декларації (колонка 0) — для R6: службові функції,
// які не експортуються, не мають протікати у Поведінку/API як «публічні».
const TOP_FN_DECL_RE = /^(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:function\*?|class)\s+(\w+)/gm
const IMPORT_FROM_RE = /^import[ \t]{1,8}[\s\S]{0,300}?from\s{1,8}['"]([^'"]+)['"]/gm
const NODE_PREFIX_RE = /^node:/
const INTERNAL_IMPORT_RE = /import[ \t]{1,8}([^'"]{0,300}?)from[ \t]{1,8}['"]\.[^'"]{1,300}['"]/g
const NAMED_BRACES_RE = /\{([^}]{1,400})\}/
const IDENT_RE = /^[\w$]{1,80}$/
const IMPORT_AS_RE = /[ \t]{1,8}as[ \t]{1,8}.{0,200}/
const WRITE_FS_RE = /\b(writeFile|mkdir|rmdir|unlink|appendFile|createWriteStream|rm\()/
const CATCH_RE = /catch\s*\(/
const TRY_RE = /\btry\s*\{/
// Falsy-return як «fail-safe» — лише коли воно в catch/error-гілці (інакше це
// звичайний guard `if (!x) return null`, не обробка помилки). Уникає over-claim.
const FALSY_RETURN_RE = /catch[\s\S]{0,400}?return\s+(false|null|''|"")/
// Мережа: окрім явного fetch/http, ловимо абстраговані клієнти (graphql/db/rpc/
// octokit/.request/.query). Хибний false-negative тут = небезпечна гарантія
// «без мережі», тож свідомо схиляємось до over-detection (м'якший бік помилки).
const NETWORK_RE =
  /\bfetch\(|https?:\/\/|\bhttps?\.|axios|\bgot\(|graphql|\.request\(|\.query\(|\.mutate\(|octokit|node-fetch|undici|\bgrpc\b|websocket/i
// Будь-який `throw` назовні → НЕ можна гарантувати «fail-safe / без винятків».
const THROW_RE = /\bthrow\s/
// Запис у БД / зовнішню мутацію → НЕ read-only (навіть якщо нема ФС-запису).
// Розбито на кілька простіших патернів (та сама семантика через OR у `isMutation`),
// щоб уникнути надмірної складності одного великого regex.
const MUTATION_CALL_RE = /\b(insert|update|delete|upsert|drop|destroy|save)[A-Za-z]*\s*[(,]/
const MUTATION_NAME_RE = /[Mm]utation\b|\bmut[A-Z]\w*/
const MUTATION_METHOD_RE = /\.(save|create|update|delete|insert|destroy|mutate)\(/
// Raw-SQL tagged-template виклики (напр. `pgWrite\`UPDATE ...\``) — DML-ключове
// слово стоїть на початку тіла шаблону, не перед `(`, тож JS-орієнтовані
// патерни вище його не ловлять. Сигнал мінімальний, але навмисний: тег-функція
// (ідентифікатор впритул перед `` ` ``) + DML-keyword одразу після відкриття —
// уникає false positive на звичайних рядках/коментарях, де немає теg-виклику.
const SQL_TAGGED_MUTATION_RE = /\b\w+`\s*(?:UPDATE|INSERT|MERGE\s+INTO|DELETE\s+FROM|UPSERT)\b/i
/**
 * @param {string} src вміст файлу
 * @returns {boolean} чи є ознаки мутації БД / зовнішнього стану
 */
const isMutation = src =>
  MUTATION_CALL_RE.test(src) ||
  MUTATION_NAME_RE.test(src) ||
  MUTATION_METHOD_RE.test(src) ||
  SQL_TAGGED_MUTATION_RE.test(src)
// Кеш — лише за ІМЕНОВАНИМ маркером (`cache`/`Cache`/`memoize`), не за будь-яким
// `new Map()`: акумулятор (напр. `byPath = new Map()`) — не кеш, а хибна гарантія
// «Кешує результати» гірша за пропуск (фабрикація > мовчання).
const CACHE_RE = /cache|memoi[sz]e/i

/**
 * Прибирає `/** *​/`-обрамлення й `*`-префікси, повертає чистий текст рядками.
 * @param {string} raw сирий JSDoc-блок з обрамленням
 * @returns {string} очищений текст без обрамлення й префіксів
 */
function cleanJsDoc(raw) {
  return raw
    .replace(JSDOC_OPEN_RE, '')
    .replace(JSDOC_CLOSE_RE, '')
    .split('\n')
    .map(l => l.replace(STAR_PREFIX_RE, '').trimEnd())
    .join('\n')
    .trim()
}

/**
 * Опис (без @-тегів) + параметри з `@param` як «name — опис».
 * @param {string} raw сирий JSDoc-блок
 * @returns {{desc:string, params:Array<{name:string, desc:string}>, ret:string}} розпарсений опис, параметри й опис повернення
 */
function parseJsDoc(raw) {
  const text = cleanJsDoc(raw)
  const lines = text.split('\n')
  const descLines = []
  const params = []
  let ret = ''
  for (const l of lines) {
    const pm = l.match(PARAM_LINE_RE)
    if (pm) {
      const desc = pm[2].trim()
      // «опис.» — JSDoc-заглушка без сенсу; не тягнемо її як факт
      params.push({ name: pm[1], desc: desc === 'опис.' ? '' : desc })
      continue
    }
    const rm = l.match(RETURNS_LINE_RE)
    if (rm) {
      ret = rm[1].trim()
      continue
    }
    if (l.startsWith('@')) continue
    descLines.push(l)
  }
  return { desc: descLines.join('\n').trim(), params, ret }
}

/**
 * Провідний блок-коментар файлу (намір), якщо він перед першим import/кодом.
 * @param {string} src вміст файлу
 * @returns {string} текст header-коментаря або порожній рядок
 */
function extractFileHeader(src) {
  const m = src.match(FILE_HEADER_RE)
  if (!m) return ''
  // має бути на самому початку (до import/код)
  if (src.slice(0, m.index).trim() !== '') return ''
  return parseJsDoc(m[0]).desc
}

/**
 * Блок-коментар, що стоїть ВПРИТУЛ перед позицією (лише пробіли між ними).
 * `(?:(?!\*​/)[\s\S])*` гарантує, що тіло не містить `*​/`, тож захоплюється рівно один
 * найближчий блок — без жадібного «перестрибування» через імпорти/код.
 * @param {string} prefix вміст файлу до позиції експорту
 * @returns {string|null} JSDoc-блок або null якщо немає
 */
function precedingJsDoc(prefix) {
  const m = prefix.match(PRECEDING_JSDOC_RE)
  return m ? m[0] : null
}

/**
 * Експорти + JSDoc, що безпосередньо передує кожному.
 * @param {string} src вміст файлу
 * @returns {Array<object>} список експортів із метаданими
 */
function extractExports(src) {
  const out = []
  for (const m of src.matchAll(EXPORT_DECL_RE)) {
    const [, kind, name] = m
    const jsdocRaw = precedingJsDoc(src.slice(0, m.index))
    out.push({ name, kind, ...(jsdocRaw ? parseJsDoc(jsdocRaw) : { desc: '', params: [], ret: '' }) })
  }
  return out
}

/**
 * Імпорти, класифіковані на stdlib / npm / internal.
 * @param {string} src вміст файлу
 * @returns {{stdlib:Array<string>, npm:Array<string>, internal:Array<string>}} розкласифіковані шляхи імпортів
 */
function extractImports(src) {
  const internal = new Set(),
    npm = new Set(),
    stdlib = new Set()
  for (const m of src.matchAll(IMPORT_FROM_RE)) {
    const s = m[1]
    if (s.startsWith('node:') || BUILTIN_MODULES.has(s.split('/', 1)[0])) stdlib.add(s.replace(NODE_PREFIX_RE, ''))
    else if (s.startsWith('.') || s.startsWith('/')) internal.add(s)
    else npm.add(s)
  }
  return { stdlib: [...stdlib], npm: [...npm], internal: [...internal] }
}

/**
 * Імена символів, імпортованих із внутрішніх модулів — їх модель не має згадувати.
 * @param {string} src вміст файлу
 * @returns {Array<string>} список імен внутрішніх символів
 */
function extractInternalSymbols(src) {
  const out = new Set()
  for (const m of src.matchAll(INTERNAL_IMPORT_RE)) {
    const clause = m[1]
    const named = clause.match(NAMED_BRACES_RE)
    if (named) {
      for (const n of named[1].split(',')) {
        const name = n.replace(IMPORT_AS_RE, '').trim()
        if (name) out.add(name)
      }
    }
    const defName = clause.replace(NAMED_BRACES_RE, '').replaceAll(',', ' ').trim().split(' ', 1)[0]
    if (defName && IDENT_RE.test(defName)) out.add(defName)
  }
  return [...out]
}

/**
 * Імена top-level функцій/класів, які НЕ експортуються (службові помічники).
 * Модель не має подавати їх як «публічні функції» у Поведінці/API (R6).
 * Const-стрілки свідомо не ловимо — менше false-positive на змістовних константах.
 * @param {string} src вміст файлу
 * @returns {Array<string>} список імен неекспортованих функцій/класів
 */
function extractLocalSymbols(src) {
  const exported = new Set(Array.from(src.matchAll(EXPORT_DECL_RE), m => m[2]))
  const out = new Set()
  for (const m of src.matchAll(TOP_FN_DECL_RE)) {
    if (!exported.has(m[1])) out.add(m[1])
  }
  return [...out]
}

/**
 * Поведінкові маркери — евристики регулярками.
 * @param {string} src вміст файлу
 * @returns {object} набір прапорців-евристик
 */
function extractMarkers(src) {
  // помітні «пропуски»: dir/segment-літерали у фільтрах
  const skips = new Set()
  for (const lit of ['.github', '.git', 'node_modules', 'base/', 'ua/', '.firebase']) {
    if (src.includes(`'${lit}`) || src.includes(`"${lit}`) || src.includes(`/${lit}`)) skips.add(lit)
  }
  return {
    // «Фабрикація > мовчання»: прапорець true лише за high-confidence; інакше
    // guaranteesFromMarkers/factsSummary його ОПУСКАЮТЬ (не стверджують протилежне).
    readOnly: !WRITE_FS_RE.test(src) && !isMutation(src), // ні ФС-запису, ні DB-мутацій
    catchesErrors: (CATCH_RE.test(src) || TRY_RE.test(src)) && !THROW_RE.test(src), // fail-safe лише якщо НЕ кидає
    returnsFalsyOnFail: FALSY_RETURN_RE.test(src) && !THROW_RE.test(src),
    network: NETWORK_RE.test(src),
    caches: CACHE_RE.test(src),
    skips: [...skips]
  }
}
/** JS-хелпери, які Vue-екстрактор переюзає над текстом script-блоку SFC. */
const VUE_HELPERS = {
  extractFileHeader,
  extractExports,
  extractImports,
  extractInternalSymbols,
  extractLocalSymbols,
  extractMarkers,
  parseJsDoc
}

/**
 * Головний екстрактор: код файлу → факт-лист.
 * @param {string} src вміст файлу
 * @param {string} relPath шлях (для контексту/мови екстрактора)
 * @returns {{relPath:string, lang:string, header:string, exports:Array, imports:object, markers:object}} структура фактів про файл
 */
export function extractFacts(src, relPath) {
  const lang = relPath.split('.').pop()
  if (lang === 'vue') return extractFactsVue(src, relPath, VUE_HELPERS)
  if (!['js', 'mjs', 'ts'].includes(lang)) {
    return { relPath, lang, unsupported: true, header: '', exports: [], imports: {}, markers: {} }
  }
  return {
    relPath,
    lang,
    header: extractFileHeader(src),
    exports: extractExports(src),
    imports: extractImports(src),
    internalSymbols: extractInternalSymbols(src),
    localSymbols: extractLocalSymbols(src),
    markers: extractMarkers(src)
  }
}

/**
 * Юніти: `.vue` — зі script-блоку SFC (span-и в координатах файлу), решта — oxc AST.
 * @param {string} src вміст файлу
 * @param {string} relPath шлях (вибір мови)
 * @returns {Array<object>|null} юніти або null
 */
function extractUnits(src, relPath) {
  if (relPath.toLowerCase().endsWith('.vue')) return extractUnitsVue(src, relPath, extractUnitsJs)
  return extractUnitsJs(src, relPath)
}

/**
 * Default-експорт для handler-модуля extension-point `doc-files`.
 * `.vue` (SFC зі `<script setup>`) парситься через optional peer `vue/compiler-sfc`
 * (ADR 260719-2155): props/emits/expose/слоти → факт-лист; без peer чи script-блоку —
 * fallback `unsupported` (whole-file шлях, як до впровадження).
 * @type {{ id: string, extensions: string[], extractFacts: typeof extractFacts, extractUnits: typeof extractUnits }}
 */
const jsDocFilesExtractor = {
  id: 'js',
  extensions: ['.js', '.mjs', '.ts', '.vue'],
  extractFacts,
  extractUnits
}

export default jsDocFilesExtractor
