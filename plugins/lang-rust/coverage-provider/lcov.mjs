/**
 * Парсинг lcov-виводу `cargo llvm-cov` для coverage-провайдера Rust:
 * агреговані totals (рядки/функції) і per-file розбивка. SF-шляхи у lcov
 * абсолютні — рібейзяться відносно кореня крейта на боці викликача.
 */

/**
 * Агрегує LF/LH/FNF/FNH по всіх записах lcov.
 * @param {string} text вміст lcov-файлу
 * @returns {{lines:{covered:number,total:number}, functions:{covered:number,total:number}}} totals
 */
export function parseLcovTotals(text) {
  const acc = { lines: { covered: 0, total: 0 }, functions: { covered: 0, total: 0 } }
  for (const line of text.split('\n')) {
    if (line.startsWith('LF:')) acc.lines.total += Number(line.slice(3))
    else if (line.startsWith('LH:')) acc.lines.covered += Number(line.slice(3))
    else if (line.startsWith('FNF:')) acc.functions.total += Number(line.slice(4))
    else if (line.startsWith('FNH:')) acc.functions.covered += Number(line.slice(4))
  }
  return acc
}

/**
 * Per-file рядкове покриття з lcov (`SF:`/`LF:`/`LH:`; шляхи — як у файлі).
 * @param {string} text вміст lcov-файлу
 * @returns {Array<{file: string, pct: number, linesFound: number, linesCovered: number}>} рядки по файлах
 */
export function parseLcovPerFile(text) {
  const files = []
  let currentFile = null
  let lf = 0
  let lh = 0
  for (const line of text.split('\n')) {
    if (line.startsWith('SF:')) {
      currentFile = line.slice(3).trim()
      lf = 0
      lh = 0
    } else if (line.startsWith('LF:')) {
      lf = Number(line.slice(3))
    } else if (line.startsWith('LH:')) {
      lh = Number(line.slice(3))
    } else if (line === 'end_of_record' && currentFile) {
      files.push({
        file: currentFile,
        pct: lf === 0 ? 100 : Math.round((lh / lf) * 10000) / 100,
        linesFound: lf,
        linesCovered: lh
      })
      currentFile = null
    }
  }
  return files
}
