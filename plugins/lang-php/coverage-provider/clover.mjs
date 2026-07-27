/**
 * Регексп-парс PHPUnit/Pest clover-звіту (`--coverage-clover`) без зовнішньої
 * XML-залежності: у репозиторії немає жодної (перевірено — `xml`/DOM-парсер
 * ніде не використовується), а clover-діалект стабільний і простий — кожен
 * `<file>` містить (опційно) class-рівня `<metrics>`, потім `<line>`-записи, і
 * завершується власним file-рівня `<metrics .../>` (self-closing, без
 * вкладеного тексту) — саме він дає file totals. Дзеркалить контракт
 * `lcov.mjs` ядра (`parseLcovTotals`/`parseLcovPerFile`), але лишається у
 * плагіні: спільна lib концерну coverage — не мандат цієї задачі (не чіпати
 * core).
 */

/** Блок одного файлу clover-звіту: ім'я + внутрішній вміст (class/line/metrics). */
const FILE_BLOCK_RE = /<file\s+name="([^"]+)">([\s\S]*?)<\/file>/g
/** Усі self-closing `<metrics .../>` у блоці файлу (class-рівня йдуть першими, file-рівня — останній). */
const METRICS_RE = /<metrics\b[^>]*>/g
// Литеральні регекспи на кожен потрібний атрибут `<metrics>` — без динамічного
// `new RegExp(...)` (security/detect-non-literal-regexp) і без chained
// unbounded-груп в одному регексі (sonarjs/super-linear-regex).
const STATEMENTS_RE = /\bstatements="(\d+)"/
const COVERED_STATEMENTS_RE = /\bcoveredstatements="(\d+)"/
const METHODS_RE = /\bmethods="(\d+)"/
const COVERED_METHODS_RE = /\bcoveredmethods="(\d+)"/

/**
 * Значення одного числового атрибута XML-тегу через литеральний регексп.
 * @param {string} tag XML-фрагмент тегу (напр. `<metrics .../>`)
 * @param {RegExp} re литеральний регексп атрибута (напр. `STATEMENTS_RE`)
 * @returns {number} значення атрибута або 0, якщо відсутній
 */
function readNumericAttr(tag, re) {
  const m = re.exec(tag)
  return m ? Number(m[1]) : 0
}

/**
 * Числові атрибути одного self-closing `<metrics .../>` тегу (лише потрібні
 * провайдеру: statements/coveredstatements — lines, methods/coveredmethods —
 * functions).
 * @param {string} tag XML-фрагмент `<metrics .../>`
 * @returns {{statements: number, coveredstatements: number, methods: number, coveredmethods: number}} атрибути
 */
function parseMetricsAttrs(tag) {
  return {
    statements: readNumericAttr(tag, STATEMENTS_RE),
    coveredstatements: readNumericAttr(tag, COVERED_STATEMENTS_RE),
    methods: readNumericAttr(tag, METHODS_RE),
    coveredmethods: readNumericAttr(tag, COVERED_METHODS_RE)
  }
}

/**
 * File-рівня `<metrics>` блоку — останній `<metrics.../>` у вмісті `<file>`
 * (після усіх class-рівня metrics і `<line>`-записів; canonical PHPUnit/Pest
 * clover діалект).
 * @param {string} fileBlockInner вміст між `<file name="...">` і `</file>`
 * @returns {Record<string, number>|null} атрибути file-рівня `<metrics>` або null, якщо відсутні
 */
function lastMetrics(fileBlockInner) {
  const matches = fileBlockInner.match(METRICS_RE)
  if (!matches || matches.length === 0) return null
  return parseMetricsAttrs(matches.at(-1))
}

/**
 * Сирі file-рівня метрики по кожному `<file>` clover-звіту (спільна основа
 * для `parseCloverTotals`/`parseCloverPerFile`).
 * @param {string} text вміст `clover.xml`
 * @returns {Array<{file: string} & Record<string, number>>} file + числові атрибути `<metrics>`
 */
function extractFileMetrics(text) {
  const out = []
  FILE_BLOCK_RE.lastIndex = 0
  let m
  while ((m = FILE_BLOCK_RE.exec(text))) {
    const [, file, inner] = m
    const metrics = lastMetrics(inner)
    if (!metrics) continue
    out.push({ file, ...metrics })
  }
  return out
}

/**
 * Агрегує lines/functions totals по всіх файлах clover-звіту: `statements`/
 * `coveredstatements` → lines, `methods`/`coveredmethods` → functions.
 * @param {string} text вміст `clover.xml`
 * @returns {{lines:{covered:number,total:number}, functions:{covered:number,total:number}}} totals
 */
export function parseCloverTotals(text) {
  const acc = { lines: { covered: 0, total: 0 }, functions: { covered: 0, total: 0 } }
  for (const f of extractFileMetrics(text)) {
    acc.lines.total += f.statements ?? 0
    acc.lines.covered += f.coveredstatements ?? 0
    acc.functions.total += f.methods ?? 0
    acc.functions.covered += f.coveredmethods ?? 0
  }
  return acc
}

/**
 * Per-file рядкове покриття з clover (`file`/`pct`/`linesFound`/`linesCovered`
 * — та сама форма, що `parseLcovPerFile` ядра; шляхи — як у `name`-атрибуті
 * clover, рібейзинг відносно cwd — на боці провайдера).
 * @param {string} text вміст `clover.xml`
 * @returns {Array<{file: string, pct: number, linesFound: number, linesCovered: number}>} рядки по файлах
 */
export function parseCloverPerFile(text) {
  return extractFileMetrics(text).map(({ file, statements = 0, coveredstatements = 0 }) => ({
    file,
    pct: statements === 0 ? 100 : Math.round((coveredstatements / statements) * 10000) / 100,
    linesFound: statements,
    linesCovered: coveredstatements
  }))
}
