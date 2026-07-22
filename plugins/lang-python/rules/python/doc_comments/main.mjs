/** @see ./docs/main.md */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { globby } from 'globby'

/**
 * Концерн `python/doc_comments`: рекомендовані вимоги до docstring-ів, з яких
 * майбутній doc-files-екстрактор python будуватиме документацію дослівно (той
 * самий принцип, що lang-js/lang-rust; гібрид ADR 260719-2155):
 *   1) модуль із публічними def/class має module-docstring (намір файлу);
 *   2) кожен top-level публічний def/class (без `_`-префікса) має docstring.
 * Порушення `promotable` (суцільний `#`-блок впритул над def/class) виправляє
 * T0 (`fix-doc_comments.mjs`) — коментар стає docstring-ом дослівно; решту
 * дописує LLM-ladder (default-worker).
 */

const SOURCE_GLOBS = ['**/*.py']
const IGNORE_GLOBS = ['**/node_modules/**', '**/.venv/**', '**/venv/**', '**/__pycache__/**', '**/.worktrees/**']
// Тести — поза вимогою: tests/-каталоги, test_*.py, *_test.py, conftest.py.
const EXCLUDED_FILE_RE = /(?:(?:^|\/)tests?\/)|(?:(?:^|\/)test_[^/]*\.py$)|(?:_test\.py$)|(?:(?:^|\/)conftest\.py$)/
// Top-level публічний def/class (column 0, імʼя без «_»-префікса).
const PUBLIC_DEF_RE = /^(?:async\s+)?(def|class)\s+([A-Za-z]\w*)/
// Docstring: перший непорожній рядок тіла — потрійні лапки, опційно з
// string-префіксами (raw/f-string/bytes/unicode у будь-якому регістрі).
const DOCSTRING_START_RE = /^\s*[bB]?[fF]?[rR]?[uU]?("""|''')/
const COMMENT_LINE_RE = /^#/
const HEADER_SKIP_RE = /^(?:#|\s*$)/
const FUTURE_IMPORT_RE = /^from\s+__future__\s+import\s/

// Глобальний сенс порушення — для AI/агента, що бачить лише текст lint-помилки
// (без доступу до цього файлу чи ADR): doc-files НЕ перефразовує ці коментарі,
// а копіює дослівно у згенеровану документацію проєкту. Це не стилістична
// вимога — порожній/формальний коментар тут напряму псує публічну доку файлу.
const MODULE_DOC_HINT =
  'Глобальний сенс: конвеєр doc-files копіює цей docstring ДОСЛІВНО в секцію «Огляд» автоматично згенерованої документації файлу (0 LLM-токенів) — без нього «Огляд» вигадує LLM із самого коду.'
const DEF_DOC_HINT =
  'Глобальний сенс: конвеєр doc-files бере цей docstring ДОСЛІВНО в секцію «Публічний API» автоматично згенерованої документації файлу (0 LLM-токенів) — без нього опис вигадує LLM.'

/**
 * Чи підпадає файл під вимогу docstring-ів.
 * @param {string} relPosix posix-відносний шлях
 * @returns {boolean} true — файл сканується
 */
export function isDocCommentTarget(relPosix) {
  return relPosix.endsWith('.py') && !EXCLUDED_FILE_RE.test(relPosix)
}

/**
 * Індекс рядка, де закінчується заголовок def/class (рядок із завершальним
 * `:`), у межах 20 рядків від старту (багаторядкові сигнатури).
 * @param {string[]} lines рядки файлу
 * @param {number} startLine індекс рядка def/class
 * @returns {number} індекс рядка з `:` або -1
 */
function headerEndLine(lines, startLine) {
  for (let i = startLine; i < Math.min(startLine + 20, lines.length); i++) {
    const noComment = lines[i].split('#', 1)[0].trimEnd()
    if (noComment.endsWith(':')) return i
  }
  return -1
}

/**
 * Чи має def/class docstring: перший непорожній рядок після заголовка.
 * @param {string[]} lines рядки файлу
 * @param {number} headerEnd індекс рядка з `:`
 * @returns {boolean} true — docstring є
 */
function hasDocstringAfter(lines, headerEnd) {
  for (let i = headerEnd + 1; i < lines.length; i++) {
    if (lines[i].trim() === '') continue
    return DOCSTRING_START_RE.test(lines[i])
  }
  return false
}

/**
 * Чи має модуль docstring: перший значущий рядок (після shebang/encoding/
 * коментарів/порожніх/`from __future__`) — потрійні лапки.
 * @param {string[]} lines рядки файлу
 * @returns {boolean} true — module-docstring є
 */
function hasModuleDocstring(lines) {
  for (const line of lines) {
    if (HEADER_SKIP_RE.test(line) || FUTURE_IMPORT_RE.test(line)) continue
    return DOCSTRING_START_RE.test(line)
  }
  return false
}

/**
 * Суцільний `#`-блок (column 0) впритул над рядком `line` — кандидат на T0.
 * @param {string[]} lines рядки файлу
 * @param {number} line індекс рядка def/class
 * @returns {{ fromLine: number, toLine: number }|null} діапазон або null
 */
function commentBlockAbove(lines, line) {
  let i = line - 1
  // декоратори між коментарем і def пропускаємо (@decorator)
  while (i >= 0 && lines[i].startsWith('@')) i--
  if (i < 0 || !COMMENT_LINE_RE.test(lines[i])) return null
  const to = i
  while (i >= 1 && COMMENT_LINE_RE.test(lines[i - 1])) i--
  return { fromLine: i, toLine: to }
}

/**
 * Перевіряє один `.py`-файл: module-docstring + docstring над кожним top-level
 * публічним def/class.
 * @param {string} src вміст файлу
 * @param {string} relPosix posix-відносний шлях (для violation.file)
 * @returns {import('@7n/rules/scripts/lib/lint-surface/types.mjs').LintViolation[]} порушення файлу
 */
export function checkFileDocComments(src, relPosix) {
  const lines = src.split('\n')
  const defs = []
  for (const [i, line] of lines.entries()) {
    const m = line.match(PUBLIC_DEF_RE)
    if (m) defs.push({ line: i, kind: m[1], name: m[2] })
  }
  if (defs.length === 0) return []

  const violations = []
  if (!hasModuleDocstring(lines)) {
    violations.push({
      reason: 'missing-module-docstring',
      message: `${relPosix}: модуль із публічними def/class без module-docstring. ${MODULE_DOC_HINT}`,
      file: relPosix,
      data: {}
    })
  }
  for (const def of defs) {
    const headerEnd = headerEndLine(lines, def.line)
    if (headerEnd === -1) continue // незвично довга сигнатура — не ризикуємо
    if (hasDocstringAfter(lines, headerEnd)) continue
    const block = commentBlockAbove(lines, def.line)
    violations.push({
      reason: 'missing-def-docstring',
      message: `${relPosix}: ${def.kind} ${def.name} без docstring. ${DEF_DOC_HINT}`,
      file: relPosix,
      data: block
        ? { promotable: true, fromLine: block.fromLine, toLine: block.toLine, headerEnd, name: def.name }
        : { name: def.name }
    })
  }
  return violations
}

/**
 * Detector python/doc_comments: per-file (дельта) або повний обхід.
 * @param {import('@7n/rules/scripts/lib/lint-surface/types.mjs').LintContext} ctx контекст лінту
 * @returns {Promise<import('@7n/rules/scripts/lib/lint-surface/types.mjs').LintResult>} перелік порушень
 */
export async function lint(ctx) {
  const { cwd, files } = ctx
  let targets
  if (files === undefined) {
    const found = await globby(SOURCE_GLOBS, { cwd, gitignore: true, ignore: IGNORE_GLOBS })
    targets = found.filter(f => isDocCommentTarget(f))
  } else {
    targets = files.filter(f => isDocCommentTarget(f))
  }

  const violations = []
  for (const rel of targets) {
    const src = await readFile(join(cwd, rel), 'utf8')
    violations.push(...checkFileDocComments(src, rel))
  }
  return { violations }
}
