/**
 * Дешеві текстові сигнали JS/TS/Vue-джерел для збору фактів авто-детекту правил
 * (`auto-rules.mjs` кличе їх на кожному зміненому файлі — без AST, лише regex).
 * Живуть у ядрі (фаза 5c spec lang-plugins-extraction): рушій авто-детекту не
 * імпортує код плагінів, а правила `@7n/rules-lang-js` (js-bun-db, vue)
 * використовують ці ж функції через `@7n/rules/scripts/lib/…` — одне джерело
 * правди без дублювання regex-ів.
 */

const BUN_SQL_IMPORT_RE = /\bimport\s*\{[\s\S]*?\b(sql|SQL)\b[\s\S]*?\}\s*from\s*["']bun["']/u

/**
 * Чи містить текст джерела імпорт імені `sql` або `SQL` з `"bun"`.
 * Скан по сирому тексту — без AST, щоб бути дешевим: викликається на кожному
 * JS/TS-файлі при зборі ознак для авто-детекту правил.
 * @param {string} content вміст файлу
 * @returns {boolean} true, якщо є імпорт sql або SQL з модуля bun
 */
export function textHasBunSqlImport(content) {
  return BUN_SQL_IMPORT_RE.test(content)
}

/**
 * Витягує з SFC лише код усередині `<script>`, щоб не чіпати шаблон.
 * @param {string} sfc вміст .vue файлу
 * @returns {string} текст усередині тегів `<script>` (усі блоки поспіль)
 */
export function extractVueScriptBlocks(sfc) {
  const chunks = []
  const re = /<script\b[^>]*>([\s\S]*?)<\/script>/gi
  let m = re.exec(sfc)
  while (m) {
    chunks.push(m[1])
    m = re.exec(sfc)
  }
  return chunks.join('\n\n')
}

/**
 * Підбирає текст для сканування: для .vue — лише script-блоки, інакше — увесь вміст.
 * @param {string} content сирий вміст файлу
 * @param {string} filePath відносний шлях (для вибору режиму)
 * @returns {string} текст для парсера/regex-сканів
 */
export function contentForVueImportScan(content, filePath) {
  if (filePath.endsWith('.vue')) {
    return extractVueScriptBlocks(content)
  }
  return content
}
