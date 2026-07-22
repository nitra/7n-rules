/** @see ./docs/main.md */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { globby } from 'globby'

/**
 * Концерн `rust/doc_comments`: рекомендовані вимоги до rustdoc-коментарів, з
 * яких doc-files будує документацію дослівно (Stage 1 гібрида, ADR 260719-2155):
 *   1) файл із `pub`-елементами має провідний `//!`-коментар (намір файлу);
 *   2) кожен top-level `pub`-елемент має `///`-опис.
 * Порушення `promotable` (звичайний `//`-блок впритул до елемента) виправляє T0
 * (`fix-doc_comments.mjs`) — `//` → `///` (над елементом) чи `//!` (header) без
 * вигадування тексту; решту дописує LLM-ladder (default-worker).
 */

const SOURCE_GLOBS = ['**/*.rs']
const IGNORE_GLOBS = ['**/target/**', '**/node_modules/**', '**/vendor/**', '**/.worktrees/**']
// Тести — поза вимогою: tests/-каталоги і файли *_test.rs / *_tests.rs.
const EXCLUDED_FILE_RE = /(?:(?:^|\/)tests?\/)|(?:_tests?\.rs$)/
const PUB_MODIFIERS = ['async ', 'unsafe ', 'const ']
const EXTERN_PREFIX_RE = /^extern\s+"[^"]*"\s+/
const KIND_NAME_RE = /^(fn|struct|enum|trait|mod|static|type|union|const)\s+(\w+)/
const DOC_LINE_RE = /^\s*\/\/\//
const PLAIN_COMMENT_RE = /^\s*\/\/(?![/!])/
const ATTR_LINE_RE = /^\s*#\[/
const CFG_TEST_RE = /^\s*#\[cfg\(test\)\]/

// Глобальний сенс порушення — для AI/агента, що бачить лише текст lint-помилки
// (без доступу до цього файлу чи ADR): doc-files НЕ перефразовує ці коментарі,
// а копіює дослівно у згенеровану документацію проєкту. Це не стилістична
// вимога — порожній/формальний коментар тут напряму псує публічну доку файлу.
const FILE_HEADER_HINT =
  'Глобальний сенс: конвеєр doc-files копіює цей коментар ДОСЛІВНО в секцію «Огляд» автоматично згенерованої документації файлу (0 LLM-токенів) — без нього «Огляд» вигадує LLM із самого коду.'
const PUB_DOC_HINT =
  'Глобальний сенс: конвеєр doc-files бере цей опис ДОСЛІВНО в секцію «Публічний API» автоматично згенерованої документації файлу (0 LLM-токенів) — без нього опис вигадує LLM.'

/**
 * Чи підпадає файл під вимогу doc-коментарів.
 * @param {string} relPosix posix-відносний шлях
 * @returns {boolean} true — файл сканується
 */
export function isDocCommentTarget(relPosix) {
  return relPosix.endsWith('.rs') && !EXCLUDED_FILE_RE.test(relPosix)
}

/**
 * Розбирає top-level `pub`-елемент з рядка (column 0; вкладені у mod/impl —
 * поза v1-обсягом). Модифікатори зрізаються ітеративно замість одного складного
 * regex (sonarjs/regex-complexity).
 * @param {string} line рядок файлу
 * @returns {{ kind: string, name: string }|null} елемент або null
 */
function parsePubItem(line) {
  if (!line.startsWith('pub')) return null
  let rest = line.startsWith('pub ') ? line.slice(4) : ''
  if (!rest) return null
  for (;;) {
    const mod = PUB_MODIFIERS.find(m => rest.startsWith(m))
    if (mod) {
      // `pub const NAME` — це kind, а `pub const fn` — модифікатор: зрізаємо
      // `const ` лише якщо далі йде `fn`.
      if (mod === 'const ' && !rest.slice(mod.length).startsWith('fn ')) break
      rest = rest.slice(mod.length)
      continue
    }
    const ext = rest.match(EXTERN_PREFIX_RE)
    if (ext) {
      rest = rest.slice(ext[0].length)
      continue
    }
    break
  }
  const m = rest.match(KIND_NAME_RE)
  return m ? { kind: m[1], name: m[2] } : null
}

/**
 * Перевіряє один `.rs`-файл: `//!`-header + `///` над кожним top-level
 * pub-елементом. Сканування зупиняється на `#[cfg(test)]` (тест-модуль
 * конвенційно наприкінці файлу).
 * @param {string} src вміст файлу
 * @param {string} relPosix posix-відносний шлях (для violation.file)
 * @returns {import('@7n/rules/scripts/lib/lint-surface/types.mjs').LintViolation[]} порушення файлу
 */
export function checkFileDocComments(src, relPosix) {
  const lines = src.split('\n')
  const items = []
  for (const [i, line] of lines.entries()) {
    if (CFG_TEST_RE.test(line)) break
    const item = parsePubItem(line)
    if (item) items.push({ ...item, line: i })
  }
  if (items.length === 0) return []

  const violations = []
  if (!hasInnerDocHeader(lines)) {
    const block = leadingPlainCommentBlock(lines)
    violations.push({
      reason: 'missing-file-header',
      message: `${relPosix}: файл із pub-елементами без провідного //!-коментаря. ${FILE_HEADER_HINT}`,
      file: relPosix,
      data: block ? { promotable: true, ...block, header: true } : { header: true }
    })
  }
  for (const item of items) {
    const above = commentBlockAbove(lines, item.line)
    if (above?.doc) continue
    violations.push({
      reason: 'missing-pub-doc',
      message: `${relPosix}: pub ${item.kind} ${item.name} без ///-опису. ${PUB_DOC_HINT}`,
      file: relPosix,
      data: above
        ? { promotable: true, fromLine: above.fromLine, toLine: above.toLine, name: item.name }
        : { name: item.name }
    })
  }
  return violations
}

/**
 * Чи починається файл із `//!`-коментаря (перший непорожній рядок — `//!` або
 * inner-атрибут `#![`, за яким конвенційно стоїть header нижче не шукаємо).
 * @param {string[]} lines рядки файлу
 * @returns {boolean} true — header є
 */
function hasInnerDocHeader(lines) {
  for (const line of lines) {
    const t = line.trim()
    if (t === '') continue
    return t.startsWith('//!') || t.startsWith('#![')
  }
  return false
}

/**
 * Провідний суцільний `//`-блок на початку файлу — кандидат на T0 `//` → `//!`.
 * @param {string[]} lines рядки файлу
 * @returns {{ fromLine: number, toLine: number }|null} діапазон рядків або null
 */
function leadingPlainCommentBlock(lines) {
  let from = -1
  for (const [i, line] of lines.entries()) {
    if (line.trim() === '' && from === -1) continue
    if (PLAIN_COMMENT_RE.test(line)) {
      if (from === -1) from = i
      continue
    }
    return from === -1 ? null : { fromLine: from, toLine: i - 1 }
  }
  return from === -1 ? null : { fromLine: from, toLine: lines.length - 1 }
}

/**
 * Коментар-блок безпосередньо над елементом (атрибутні рядки `#[...]` між ними
 * пропускаються — rustdoc стоїть НАД атрибутами).
 * @param {string[]} lines рядки файлу
 * @param {number} itemLine індекс рядка елемента
 * @returns {{ doc: boolean, fromLine: number, toLine: number }|null} блок (doc=true — вже `///`) або null
 */
function commentBlockAbove(lines, itemLine) {
  let i = itemLine - 1
  while (i >= 0 && ATTR_LINE_RE.test(lines[i])) i--
  if (i < 0) return null
  if (DOC_LINE_RE.test(lines[i])) return { doc: true, fromLine: i, toLine: i }
  if (!PLAIN_COMMENT_RE.test(lines[i])) return null
  const to = i
  while (i >= 1 && PLAIN_COMMENT_RE.test(lines[i - 1])) i--
  return { doc: false, fromLine: i, toLine: to }
}

/**
 * Detector rust/doc_comments: per-file (дельта) або повний обхід.
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
