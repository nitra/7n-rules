/**
 * Чисті парсери текстового виводу mutmut 4.x (`mutmut results --all true` і
 * `mutmut show <name>`) у контракт CoverageRow. Форму звірено на живому
 * прогоні (проба 2026-07-23): результати — рядки `<ім'я мутанта>: <статус>`,
 * show — заголовок `# name: <статус>` і unified diff зміненого джерела.
 * Лічба score: caught = killed + timeout; знаменник = caught + survived;
 * suspicious/skipped/no tests — поза знаменником (аналог Unviable у Rust).
 */
// cspell:ignore mutmut — назва тулзи мутаційного тестування Python

/** Рядок результату mutmut: відступ, ім'я мутанта, двокрапка, статус. */
const RESULT_LINE_RE = /^\s+(\S+): ([^:\n]+)$/
/** Заголовок hunk-а unified diff: стартовий рядок старого файлу. */
const HUNK_HEADER_RE = /^@@ -(\d+)(?:,\d+)? \+\d+(?:,\d+)? @@/
/** Рядок `---` diff-а зі шляхом до джерела мутанта. */
const DIFF_SOURCE_RE = /^--- (\S+)/

/**
 * Розбирає вивід `mutmut results --all true` на лічильники score і список
 * імен survived-мутантів (для подальшого `mutmut show`).
 * @param {string} text stdout команди results
 * @returns {{caught: number, total: number, survivedNames: string[]}} caught/total і імена survived
 */
export function parseMutmutResults(text) {
  let caught = 0
  let total = 0
  const survivedNames = []
  for (const line of text.split('\n')) {
    const m = RESULT_LINE_RE.exec(line)
    if (!m) continue
    const [, name, status] = m
    if (status === 'killed' || status === 'timeout') {
      caught += 1
      total += 1
    } else if (status === 'survived') {
      total += 1
      survivedNames.push(name)
    }
    // suspicious / skipped / no tests — не входять у знаменник score.
  }
  return { caught, total, survivedNames }
}

/**
 * Розбирає вивід `mutmut show <name>`: шлях джерела з рядка `---`, позиція
 * зміненого рядка як старт hunk-а плюс індекс першого рядка тіла, що
 * починається з `-`, оригінал/заміна — вміст `-`/`+`-рядків без префікса.
 * @param {string} text stdout команди show
 * @returns {{file: string, line: number, original: string, replacement: string}|null} мутант або null, коли diff не розібрано
 */
export function parseMutantShow(text) {
  const lines = text.split('\n')
  const file = findDiffSource(lines)
  if (file === null) return null
  const hunk = findFirstHunk(lines)
  if (hunk === null) return null

  let line = null
  let original = ''
  let replacement = ''
  for (const [offset, raw] of lines.slice(hunk.bodyAt).entries()) {
    if (raw.startsWith('-')) {
      line ??= hunk.start + offset
      original ||= raw.slice(1).trim()
    } else if (raw.startsWith('+')) {
      replacement ||= raw.slice(1).trim()
    }
    if (original !== '' && replacement !== '') break
  }
  if (line === null) return null
  return { file, line, original, replacement }
}

/**
 * Шлях source-файлу з рядка `--- <шлях>` unified diff.
 * @param {string[]} lines рядки виводу `mutmut show`
 * @returns {string|null} шлях або null
 */
function findDiffSource(lines) {
  for (const raw of lines) {
    const src = DIFF_SOURCE_RE.exec(raw)
    if (src) return src[1]
  }
  return null
}

/**
 * Перший hunk-заголовок `@@ -N,M +N,M @@`: стартовий рядок і індекс тіла.
 * @param {string[]} lines рядки виводу `mutmut show`
 * @returns {{start: number, bodyAt: number}|null} параметри hunk-а або null
 */
function findFirstHunk(lines) {
  for (const [i, raw] of lines.entries()) {
    const hunk = HUNK_HEADER_RE.exec(raw)
    if (hunk) return { start: Number(hunk[1]), bodyAt: i + 1 }
  }
  return null
}
