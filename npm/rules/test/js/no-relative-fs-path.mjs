/**
 * Заборона **relative-path** аргументів у FS-функціях усередині тестів.
 *
 * Контекст (test.mdc, секція "Заборона `process.chdir` у тестах"):
 * Після видалення `withTmpCwd` усі тести отримують `dir` параметром і мають
 * будувати **абсолютні** шляхи через `join(dir, …)`. Якщо хтось забуде префікс
 * і напише `writeFile('foo.json', …)` чи `copyFile(src, 'foo.json')` —
 * relative-path резолвиться у `process.cwd()` (= `npm/`), що зливає тестову
 * фікстуру у production tree. Інцидент v1.28.0: `tests/check-rule-fixtures.test.mjs`
 * залишив `copyFile(src, 'values-dev.ini')` і `copyFile(src, 'default.conf.template')` —
 * створило файли `npm/values-dev.ini` і `npm/default.conf.template`.
 *
 * Сканер AST-based (oxc-parser): знаходить виклики `node:fs`/`node:fs/promises`
 * функцій із **string literal** аргументом-шляхом, який НЕ починається з:
 *   - `/`, `\\` — POSIX/Windows absolute;
 *   - `file:`/`http`/`data:` — URL-схема (передається до `new URL(...)`);
 *   - `${…}` (template-literal з виразом) і `\`…\${dir}\`` патерни — обчислений шлях;
 *   - `:` для Windows-літер диску `C:\…` (рідко в тестах, але legit).
 * Виклики, чий path-аргумент — НЕ literal (CallExpression `join(...)`, BinaryExpression,
 * Identifier, MemberExpression) — пропускаємо: припускаємо що це абсолютний шлях.
 *
 * Скани: `**\/*.test.{js,mjs}` з загальними `walkDir` skip + `.n-cursor.json#ignore`.
 */
import { readFile } from 'node:fs/promises'
import { basename, relative } from 'node:path'

import { createCheckReporter } from '../../../scripts/lib/check-reporter.mjs'
import { loadCursorIgnorePaths } from '../../../scripts/lib/load-cursor-config.mjs'
import { parseProgramOrNull, walkAstWithAncestors } from '../../../scripts/utils/ast-scan-utils.mjs'
import { walkDir } from '../../../scripts/utils/walkDir.mjs'

/**
 * FS-функції з `node:fs` / `node:fs/promises` / sync-API, які приймають path
 * у фіксованих позиціях. Map: ім'я функції → масив 0-індексованих позицій
 * path-аргументів (1-й, 2-й, або обидва — як у `copyFile/rename/symlink/link`).
 */
const FS_PATH_ARG_POSITIONS = new Map([
  ['writeFile', [0]],
  ['writeFileSync', [0]],
  ['readFile', [0]],
  ['readFileSync', [0]],
  ['appendFile', [0]],
  ['appendFileSync', [0]],
  ['mkdir', [0]],
  ['mkdirSync', [0]],
  ['rmdir', [0]],
  ['rmdirSync', [0]],
  ['rm', [0]],
  ['rmSync', [0]],
  ['unlink', [0]],
  ['unlinkSync', [0]],
  ['access', [0]],
  ['accessSync', [0]],
  ['stat', [0]],
  ['statSync', [0]],
  ['lstat', [0]],
  ['lstatSync', [0]],
  ['chmod', [0]],
  ['chmodSync', [0]],
  ['chown', [0]],
  ['chownSync', [0]],
  ['truncate', [0]],
  ['truncateSync', [0]],
  ['existsSync', [0]],
  ['readdir', [0]],
  ['readdirSync', [0]],
  ['copyFile', [0, 1]],
  ['copyFileSync', [0, 1]],
  ['rename', [0, 1]],
  ['renameSync', [0, 1]],
  ['symlink', [0, 1]],
  ['symlinkSync', [0, 1]],
  ['link', [0, 1]],
  ['linkSync', [0, 1]],
  ['cp', [0, 1]],
  ['cpSync', [0, 1]],
  // test-helpers абсолютні-only форми (зайвий захист)
  ['writeJson', [0]],
  ['ensureDir', [0]]
])

/**
 * Префікси абсолютних шляхів або очевидно-обчислених. Якщо literal починається з
 * одного з них — це OK (тест свідомо передає absolute чи URL).
 */
const ABSOLUTE_PREFIXES = ['/', '\\', 'file:', 'http:', 'https:', 'data:']

/**
 * Чи string literal — relative path (тобто баг). Перевіряє лише string-літерали
 * та template literals без виразів. Виклики `join(...)` / `resolve(...)` /
 * перемінні з ${} — пропускаємо (припускаємо absolute).
 * @param {object} arg AST node аргументу
 * @returns {string|null} relative-path значення (для меседжа), або null якщо OK
 */
function extractRelativeLiteralPath(arg) {
  if (!arg) return null
  if (arg.type === 'Literal' && typeof arg.value === 'string') {
    return isRelativeString(arg.value) ? arg.value : null
  }
  if (arg.type === 'TemplateLiteral' && arg.expressions.length === 0) {
    const raw = arg.quasis.map(q => q.value.cooked).join('')
    return isRelativeString(raw) ? raw : null
  }
  // Не string-literal — не аналізуємо (припускаємо обчислений absolute через join/resolve).
  return null
}

/**
 * Чи рядок виглядає як relative path. Порожній рядок — false (це не path).
 * Windows-disk-letter `C:\…` — absolute, бо містить `:` між літерою і `\`.
 * @param {string} s рядок-шлях
 * @returns {boolean} true якщо relative
 */
function isRelativeString(s) {
  if (!s) return false
  for (const prefix of ABSOLUTE_PREFIXES) {
    if (s.startsWith(prefix)) return false
  }
  // Windows drive letter, наприклад `C:\foo` або `C:/foo`.
  if (/^[A-Za-z]:[\\/]/u.test(s)) return false
  return true
}

/**
 * Витягує ім'я FS-функції з callee:
 *   - `writeFile(…)` → "writeFile" (Identifier callee)
 *   - `fs.writeFile(…)` чи `fsp.writeFile(…)` → "writeFile" (MemberExpression)
 *   - `await fs.promises.writeFile(…)` → "writeFile"
 * Повертає null для будь-якого іншого виклику.
 * @param {object} callee AST callee node
 * @returns {string|null} ім'я FS-функції або null
 */
function extractFsFunctionName(callee) {
  if (!callee) return null
  if (callee.type === 'Identifier') {
    return FS_PATH_ARG_POSITIONS.has(callee.name) ? callee.name : null
  }
  if (callee.type === 'MemberExpression' && !callee.computed && callee.property?.type === 'Identifier') {
    const name = callee.property.name
    return FS_PATH_ARG_POSITIONS.has(name) ? name : null
  }
  return null
}

/**
 * Чи файл — JS-тест (`*.test.mjs` / `*.test.js`).
 * @param {string} absPath абсолютний шлях
 * @returns {boolean} true якщо файл є тестом
 */
function isTestFile(absPath) {
  const name = basename(absPath)
  return name.endsWith('.test.mjs') || name.endsWith('.test.js')
}

/**
 * Знаходить порушення у одному тестовому файлі.
 * @param {string} body вміст тесту
 * @returns {Array<{line: number, fn: string, path: string, argPos: number}>} порушення
 */
function findOffendersInBody(body) {
  const program = parseProgramOrNull(body, 'test.mjs')
  if (!program) return []
  const offenders = []
  const lineOffsets = computeLineOffsets(body)
  walkAstWithAncestors(program, [], node => {
    if (node?.type !== 'CallExpression') return
    const fnName = extractFsFunctionName(node.callee)
    if (!fnName) return
    const positions = FS_PATH_ARG_POSITIONS.get(fnName)
    for (const pos of positions) {
      const arg = node.arguments?.[pos]
      const relPath = extractRelativeLiteralPath(arg)
      if (relPath !== null) {
        const start = arg?.start ?? node.start ?? 0
        const line = offsetToLineFromCache(lineOffsets, start)
        offenders.push({ line, fn: fnName, path: relPath, argPos: pos })
      }
    }
  })
  return offenders
}

/**
 * Кешований offset→line: бінарний пошук по newline-offsets.
 * @param {string} body source
 * @returns {number[]} offsets newline char positions
 */
function computeLineOffsets(body) {
  const offsets = [0]
  for (const [i, element] of body.entries()) {
    if (element === '\n') offsets.push(i + 1)
  }
  return offsets
}

/**
 * @param {number[]} offsets newline-offsets
 * @param {number} offset 0-індекс символу
 * @returns {number} 1-індексований рядок
 */
function offsetToLineFromCache(offsets, offset) {
  let lo = 0
  let hi = offsets.length - 1
  while (lo < hi) {
    const mid = Math.floor((lo + hi + 1) / 2)
    if (offsets[mid] <= offset) lo = mid
    else hi = mid - 1
  }
  return lo + 1
}

/**
 * Перевіряє, що жоден `*.test.{mjs,js}` файл не передає relative-path як 1-й
 * (або для `copyFile`/`rename`/`symlink`/`link`/`cp` — 1-й і 2-й) аргумент
 * у FS-функцію з `node:fs` / `node:fs/promises`.
 * @param {string} [cwdParam] корінь репозиторію
 * @returns {Promise<number>} 0 — чисто, 1 — є порушення
 */
export async function check(cwdParam = process.cwd()) {
  const reporter = createCheckReporter()
  const { pass, fail } = reporter

  const cwd = cwdParam
  const ignorePaths = await loadCursorIgnorePaths(cwd)

  /** @type {string[]} */
  const testFiles = []
  await walkDir(
    cwd,
    absPath => {
      if (isTestFile(absPath)) testFiles.push(absPath)
    },
    ignorePaths
  )

  /** @type {Array<{file: string, line: number, fn: string, path: string, argPos: number}>} */
  const offenders = []
  for (const absPath of testFiles) {
    const body = await readFile(absPath, 'utf8')
    const found = findOffendersInBody(body)
    for (const o of found) {
      offenders.push({ file: relative(cwd, absPath), ...o })
    }
  }

  if (offenders.length === 0) {
    pass(`Жоден з ${testFiles.length} тестових файлів не передає relative-path у FS-функції (test.mdc)`)
    return reporter.getExitCode()
  }

  for (const { file, line, fn, path, argPos } of offenders) {
    const which = argPos === 0 ? '1-й аргумент' : `${argPos + 1}-й аргумент`
    fail(
      `${file}:${line}: ${fn}() — ${which} '${path}' relative; використовуй join(dir, …) (test.mdc, no-relative-fs-path)`
    )
  }

  return reporter.getExitCode()
}
