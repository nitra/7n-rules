/**
 * Додані/змінені рядки на файл (vs HEAD) — для класифікації lint-findings на
 * introduced (рядок у diff) vs pre-existing (поза diff), беклог #6.
 *
 * Парсимо `git diff --unified=0 HEAD -- <files>`: hunk-заголовок `@@ -a,b +c,d @@`
 * дає додані рядки c..c+d-1. Untracked (нові, поза HEAD) — усі рядки introduced (маркер `ALL`).
 */
import { spawnSync } from 'node:child_process'

/** Маркер «усі рядки файлу introduced» (новий untracked-файл). */
export const ALL_LINES = 'ALL'

/** Шлях цільового файлу у рядку `+++ b/path` (або `/dev/null`). */
const PLUS_FILE_RE = /^\+\+\+ (?:b\/)?(.*)$/u
/** Діапазон доданих рядків у hunk-заголовку `@@ -a,b +c,d @@`. */
const HUNK_ADD_RE = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/u

/**
 * Парсить вивід `git diff --unified=0` у мапу доданих рядків на файл.
 * @param {string} diffText сирий вивід git diff
 * @returns {Map<string, Set<number>>} файл → множина доданих рядків
 */
export function parseAddedLines(diffText) {
  const byFile = new Map()
  let current = null
  for (const line of String(diffText).split('\n')) {
    const fileMatch = PLUS_FILE_RE.exec(line)
    if (fileMatch) {
      current = fileMatch[1] === '/dev/null' ? null : fileMatch[1]
      if (current && !byFile.has(current)) byFile.set(current, new Set())
      continue
    }
    const hunk = current && HUNK_ADD_RE.exec(line)
    if (hunk) {
      const start = Number(hunk[1])
      const count = hunk[2] === undefined ? 1 : Number(hunk[2])
      for (let i = 0; i < count; i++) byFile.get(current).add(start + i)
    }
  }
  return byFile
}

/**
 * Тихий git → stdout або `''`.
 * @param {string[]} args аргументи git
 * @param {string} cwd робочий каталог
 * @returns {string} stdout
 */
function git(args, cwd) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' })
  return r.status === 0 ? (r.stdout ?? '') : ''
}

/**
 * Додані рядки на файл (vs HEAD) для заданих файлів. Tracked → з diff;
 * untracked (нові) → маркер `ALL_LINES`.
 * @param {string[]} files відносні шляхи (від cwd)
 * @param {string} [cwd] корінь репо
 * @param {{ git?: (args: string[], cwd: string) => string }} [deps] ін'єкція git (тести)
 * @returns {Map<string, Set<number> | typeof ALL_LINES>} файл → додані рядки / `ALL`
 */
export function addedLinesByFile(files, cwd = process.cwd(), deps = {}) {
  if (!files || files.length === 0) return new Map()
  const run = deps.git ?? git
  const map = parseAddedLines(run(['diff', '--unified=0', 'HEAD', '--', ...files], cwd))
  const untracked = run(['ls-files', '--others', '--exclude-standard', '--', ...files], cwd)
  for (const f of untracked.split('\n').filter(Boolean)) {
    map.set(f, ALL_LINES)
  }
  return map
}

/**
 * Чи рядок `line` у файлі `file` — доданий (introduced).
 * @param {Map<string, Set<number> | typeof ALL_LINES>} addedLines результат `addedLinesByFile`
 * @param {string} file відносний шлях
 * @param {number} line номер рядка
 * @returns {boolean} результат
 */
export function isIntroducedLine(addedLines, file, line) {
  const entry = addedLines.get(file)
  if (entry === undefined) return false
  if (entry === ALL_LINES) return true
  return entry.has(line)
}
