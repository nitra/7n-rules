/** @see ./docs/js-facts.md */

/**
 * Низькорівневі regex-хелпери факт-листа для JS-родини (header/exports/imports/
 * markers), спільні для `.js`/`.mjs`/`.ts` (`extractors.mjs`) і для script-блоку
 * Vue SFC (`vue.mjs`). Винесені в окремий модуль без залежностей на `extractors.mjs`/
 * `vue.mjs`, щоб уникнути циклічного імпорту між ними.
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
const FILE_HEADER_RE = /^\s*\/\*\*(?!\/)([\s\S]*?)\*\//
// `(?!\/)` одразу після відкриття — без нього glob-рядок на кшталт `'src/**/linux.rs'`
// (символи `/`,`*`,`*`,`/`) читається як порожній коментар-відкриття `/**/`, і жадібний
// пошук найближчого `*/` «протікає» аж до наступного РЕАЛЬНОГО закриття JSDoc, змішуючи
// код між ними у `desc`. Справжній JSDoc ніколи не має `/` одразу після `/**`.
const PRECEDING_JSDOC_RE = /\/\*\*(?!\/)(?:(?!\*\/)[\s\S])*\*\/\s*$/
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

// Заголовок `\@param`/`\@returns` із незакритим на тому ж рядку типом (`\@param {{`
// на початку багаторядкового object-type). `.*` без `s`-прапора — навмисно: `l`
// уже без `\n` (рядки з `text.split('\n')`), тож `.` природно зупиняється на межі рядка.
const TAG_HEAD_RE = /^@(param|returns?)\b[ \t]*(\{.*)?$/

/**
 * @param {string} s текст
 * @param {string} ch односимвольний рядок для підрахунку
 * @returns {number} кількість входжень `ch` у `s`
 */
function countOccurrences(s, ch) {
  return s.split(ch).length - 1
}

/**
 * Просуває стан пропуску багаторядкового object-type (`\@param {{ ... }}`) на один
 * рядок: рахує баланс дужок, і коли він сходиться в 0 — домальовує рядок як
 * звичайний `\@param name опис`/`\@returns опис` (текст після останньої `}`).
 * @param {{tag:'param'|'returns', depth:number}} braceSkip стан пропуску (мутується)
 * @param {string} l поточний рядок
 * @returns {{line:string|null}} `line:null` — рядок ще всередині типу (пропустити); інакше — реконструйований рядок
 */
function advanceBraceSkip(braceSkip, l) {
  braceSkip.depth += countOccurrences(l, '{') - countOccurrences(l, '}')
  if (braceSkip.depth > 0) return { line: null }
  return { line: `@${braceSkip.tag} ${l.slice(l.lastIndexOf('}') + 1).trim()}` }
}

/**
 * Виявляє старт багаторядкового `\@param {{`/`\@returns {{` (тип не закрився на
 * цьому ж рядку — більше `{`, ніж `}`).
 * @param {string} l поточний рядок
 * @returns {{tag:'param'|'returns', depth:number}|null} стан пропуску або null, якщо не старт
 */
function detectMultilineTagStart(l) {
  const tagHead = l.match(TAG_HEAD_RE)
  if (!tagHead?.[2]) return null
  const opens = countOccurrences(tagHead[2], '{')
  const closes = countOccurrences(tagHead[2], '}')
  if (opens <= closes) return null
  return { tag: tagHead[1].startsWith('return') ? 'returns' : 'param', depth: opens - closes }
}

/**
 * Дописує continuation-рядок (обгорнутий хвіст) до відповідного \@param/\@returns.
 * @param {'returns'|{kind:'param', idx:number}} continuation активний тег
 * @param {Array<{name:string, desc:string}>} params накопичені параметри (мутуються)
 * @param {string} ret поточний текст `@returns`
 * @param {string} tail новий текст для дописування
 * @returns {string} оновлений `ret` (для `returns`; для `param` — вхідний `ret` без змін)
 */
function appendContinuation(continuation, params, ret, tail) {
  if (continuation === 'returns') return `${ret} ${tail}`.trim()
  params[continuation.idx].desc = `${params[continuation.idx].desc} ${tail}`.trim()
  return ret
}

/**
 * Опис (без @-тегів) + параметри з `@param` як «name — опис».
 * @param {string} raw сирий JSDoc-блок
 * @returns {{desc:string, params:Array<{name:string, desc:string}>, ret:string}} розпарсений опис, параметри й опис повернення
 */
export function parseJsDoc(raw) {
  const text = cleanJsDoc(raw)
  const lines = text.split('\n')
  const descLines = []
  const params = []
  let ret = ''
  // Рядок без `@` на початку — це або (до першого тегу) частина `desc`, або (після
  // @param/@returns) обгорнутий на новий рядок «хвіст» ЦЬОГО тегу. Без відстеження
  // continuation такий хвіст мовчки падав у `descLines`, змішуючи текст @returns/
  // @param у загальний опис (напр. довге `@returns` на 2 рядки).
  let continuation = null // null | 'desc' | 'returns' | { kind: 'param', idx: number }
  // Багаторядковий `@param {{ ... }}`/`@returns {{ ... }}` (складний object-type,
  // не закритий на тому ж рядку): тіло типу пропускаємо (не тягнемо в desc/params/ret),
  // рахуючи баланс дужок по рядках через `advanceBraceSkip`.
  let braceSkip = null // null | { tag: 'param'|'returns', depth: number }
  for (const rawLine of lines) {
    let l = rawLine
    if (braceSkip) {
      const advanced = advanceBraceSkip(braceSkip, l)
      if (advanced.line === null) continue
      l = advanced.line
      braceSkip = null
    }
    const pm = l.match(PARAM_LINE_RE)
    if (pm) {
      const desc = pm[2].trim()
      // «опис.» — JSDoc-заглушка без сенсу; не тягнемо її як факт
      params.push({ name: pm[1], desc: desc === 'опис.' ? '' : desc })
      continuation = { kind: 'param', idx: params.length - 1 }
      continue
    }
    const rm = l.match(RETURNS_LINE_RE)
    if (rm) {
      ret = rm[1].trim()
      continuation = 'returns'
      continue
    }
    const multilineStart = detectMultilineTagStart(l)
    if (multilineStart) {
      braceSkip = multilineStart
      continuation = null
      continue
    }
    if (l.startsWith('@')) {
      continuation = null // невідомий/непідтримуваний тег — не продовжуємо в нього
      continue
    }
    if (continuation && continuation !== 'desc' && l.trim()) {
      ret = appendContinuation(continuation, params, ret, l.trim())
      continue
    }
    continuation = 'desc'
    descLines.push(l)
  }
  return { desc: descLines.join('\n').trim(), params, ret }
}

/**
 * JSDoc-коментар (Block, `/** ... *​/`), що стоїть ВПРИТУЛ перед позицією (лише
 * пробіли між ними) — з реального списку коментарів парсера (`comments` від
 * `parseProgramAndCommentsOrNull`), не regex по сирому тексту. Усуває клас
 * false positive, де "/**"-подібний текст трапляється всередині `//`-коментаря
 * чи рядкового літералу (напр. glob `'src/**​/x.rs'` чи `// приклад: /** ... *​/`)
 * — токенізатор там уже коректно визначив межі справжніх коментарів, а
 * regex-сканер такого тексту не бачить окремо і жадібно «протікає» до
 * наступного реального `*​/`, змішуючи проміжний код в опис.
 * @param {Array<{type:string, value:string, start:number, end:number}>} comments список коментарів парсера (у порядку файлу)
 * @param {string} src вміст файлу (для перевірки, що проміжок — лише пробіли)
 * @param {number} pos позиція, перед якою шукаємо коментар
 * @returns {string|null} дослівний `/** ... *​/`-текст або null, якщо немає
 */
export function jsDocCommentBefore(comments, src, pos) {
  let best = null
  for (const c of comments) {
    if (c.type !== 'Block' || !c.value.startsWith('*') || c.end > pos) continue
    if (!best || c.end > best.end) best = c
  }
  if (!best || src.slice(best.end, pos).trim() !== '') return null
  return src.slice(best.start, best.end)
}

/**
 * Провідний блок-коментар файлу (намір), якщо він перед першим import/кодом.
 * `comments` (з парсера) — точний шлях: перший коментар файлу має бути саме
 * ним. Без `comments` (парсинг не вдався) — regex-фолбек на сирому тексті.
 * @param {string} src вміст файлу
 * @param {Array<{type:string, value:string, start:number, end:number}>|null} [comments] список коментарів парсера або null
 * @returns {string} текст header-коментаря або порожній рядок
 */
export function extractFileHeader(src, comments = null) {
  if (comments) {
    const first = comments[0]
    const isLeadingJsDoc = first?.type === 'Block' && first.value.startsWith('*')
    if (isLeadingJsDoc && src.slice(0, first.start).trim() === '')
      return parseJsDoc(src.slice(first.start, first.end)).desc
    return ''
  }
  const m = src.match(FILE_HEADER_RE)
  if (!m) return ''
  // має бути на самому початку (до import/код)
  if (src.slice(0, m.index).trim() !== '') return ''
  return parseJsDoc(m[0]).desc
}

/**
 * Блок-коментар, що стоїть ВПРИТУЛ перед позицією (лише пробіли між ними).
 * Regex-фолбек для випадків без `comments` від парсера (див. `jsDocCommentBefore`
 * — надійніший шлях, коли парсинг вдався). `(?:(?!\*​/)[\s\S])*` гарантує, що тіло
 * не містить `*​/`, тож захоплюється рівно один найближчий блок — без жадібного
 * «перестрибування» через імпорти/код (окрім залишкового класу false positive
 * усередині `//`-коментарів, який і закриває `jsDocCommentBefore`).
 * @param {string} prefix вміст файлу до позиції експорту
 * @returns {string|null} JSDoc-блок або null якщо немає
 */
export function precedingJsDoc(prefix) {
  const m = prefix.match(PRECEDING_JSDOC_RE)
  return m ? m[0] : null
}

/**
 * Експорти + JSDoc, що безпосередньо передує кожному. З `comments` (парсер) —
 * точна AST-based атрибуція (`jsDocCommentBefore`); без них (парсинг не вдався)
 * — regex-фолбек (`precedingJsDoc`).
 * @param {string} src вміст файлу
 * @param {Array<{type:string, value:string, start:number, end:number}>|null} [comments] список коментарів парсера або null
 * @returns {Array<object>} список експортів із метаданими
 */
export function extractExports(src, comments = null) {
  const out = []
  for (const m of src.matchAll(EXPORT_DECL_RE)) {
    const [, kind, name] = m
    const jsdocRaw = comments ? jsDocCommentBefore(comments, src, m.index) : precedingJsDoc(src.slice(0, m.index))
    out.push({ name, kind, ...(jsdocRaw ? parseJsDoc(jsdocRaw) : { desc: '', params: [], ret: '' }) })
  }
  return out
}

/**
 * Імпорти, класифіковані на stdlib / npm / internal.
 * @param {string} src вміст файлу
 * @returns {{stdlib:Array<string>, npm:Array<string>, internal:Array<string>}} розкласифіковані шляхи імпортів
 */
export function extractImports(src) {
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
export function extractInternalSymbols(src) {
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
export function extractLocalSymbols(src) {
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
export function extractMarkers(src) {
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

/** Regex для JS-родини (`export function|const|class NAME`) — спільний для факт-листа і для `extractLocalSymbols`. */
export { EXPORT_DECL_RE }
