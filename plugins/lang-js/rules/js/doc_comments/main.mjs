/** @see ./docs/main.md */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { globby } from 'globby'

import { parseProgramAndCommentsOrNull } from '@7n/rules/scripts/utils/ast-scan-utils.mjs'

import { jsDocCommentBefore } from '../../../doc-files/js-facts.mjs'

/**
 * Концерн `js/doc_comments`: рекомендовані вимоги до doc-коментарів, з яких
 * doc-files будує документацію дослівно (Stage 1 гібрида, ADR 260719-2155):
 *   1) файл із експортами має провідний header-JSDoc (намір файлу → «Огляд»);
 *   2) кожен експорт має JSDoc-опис (→ «Публічний API» без перефразування LLM).
 * Порушення `promotable` (звичайний `//`-блок впритул до символу) виправляє T0
 * (`fix-doc_comments.mjs`) — механічне підвищення до `/** … *​/` без вигадування
 * тексту; решту дописує LLM-ladder (default-worker).
 */

const SOURCE_GLOBS = ['**/*.{js,mjs,cjs,ts}']
const IGNORE_GLOBS = [
  '**/node_modules/**',
  '**/dist/**',
  '**/coverage/**',
  '**/vendor/**',
  '**/.worktrees/**',
  '**/docs/**'
]
// Тести/фікстури/декларації — поза вимогою (як і в doc-files-сканера).
const EXCLUDED_FILE_RE = /(\.test\.|\.spec\.|\.d\.ts$)|(^|\/)(tests|fixtures|__mocks__)\//
const SOURCE_EXT_RE = /\.(js|mjs|cjs|ts)$/
const SHEBANG_RE = /^#!.*$/m

// Глобальний сенс порушення — для AI/агента, що бачить лише текст lint-помилки
// (без доступу до цього файлу чи ADR): doc-files НЕ перефразовує ці коментарі,
// а копіює дослівно у згенеровану документацію проєкту. Це не стилістична
// вимога — порожній/формальний коментар тут напряму псує публічну доку файлу.
const FILE_HEADER_HINT =
  'Глобальний сенс: конвеєр doc-files копіює цей коментар ДОСЛІВНО в секцію «Огляд» автоматично згенерованої документації файлу (0 LLM-токенів) — без нього «Огляд» вигадує LLM із самого коду.'
const EXPORT_DOC_HINT =
  'Глобальний сенс: конвеєр doc-files бере цей опис ДОСЛІВНО в секцію «Публічний API» автоматично згенерованої документації файлу (0 LLM-токенів, isApiGap/renderApiLine) — без нього опис вигадує LLM.'

/**
 * Чи підпадає файл під вимогу doc-коментарів.
 * @param {string} relPosix posix-відносний шлях
 * @returns {boolean} true — файл сканується
 */
export function isDocCommentTarget(relPosix) {
  if (EXCLUDED_FILE_RE.test(relPosix)) return false
  return SOURCE_EXT_RE.test(relPosix)
}

/**
 * Імена й позиції експортованих декларацій програми (named/default із declaration).
 * `export { a, b }`-специфікатори пропускаються: символ оголошено інде, JSDoc
 * вимагатиметься біля самої декларації, якщо її теж експортовано.
 * @param {{ body?: unknown[] }} program AST-корінь
 * @returns {{ name: string, start: number }[]} експорти з офсетом для пошуку JSDoc
 */
function collectExports(program) {
  const out = []
  for (const node of program.body ?? []) {
    const isNamed = node.type === 'ExportNamedDeclaration' && node.declaration
    const isDefault = node.type === 'ExportDefaultDeclaration' && node.declaration
    if (!isNamed && !isDefault) continue
    const decl = node.declaration
    if (decl.type === 'FunctionDeclaration' || decl.type === 'ClassDeclaration') {
      out.push({ name: decl.id?.name ?? 'default', start: node.start })
    } else if (decl.type === 'VariableDeclaration') {
      for (const d of decl.declarations ?? []) {
        if (d.id?.type === 'Identifier') out.push({ name: d.id.name, start: node.start })
      }
    } else if (isDefault) {
      out.push({ name: 'default', start: node.start })
    }
  }
  return out
}

/**
 * Суцільний блок `//`-коментарів, що стоїть ВПРИТУЛ над позицією `pos`
 * (між блоком і декларацією — лише пробіли/переводи рядка; всередині блоку —
 * теж). Це кандидат на T0-підвищення до JSDoc.
 * @param {{ type: string, start: number, end: number }[]} comments список коментарів парсера
 * @param {string} src вміст файлу
 * @param {number} pos позиція декларації
 * @returns {{ start: number, end: number }|null} межі блоку або null
 */
export function promotableLineBlockBefore(comments, src, pos) {
  const lines = comments.filter(c => c.type === 'Line' && c.end <= pos).toSorted((a, b) => a.start - b.start)
  let end = -1
  let start = -1
  for (let i = lines.length - 1; i >= 0; i--) {
    const c = lines[i]
    const gapAfter = src.slice(c.end, end === -1 ? pos : start)
    // «Впритул» = між рядками нема ні коду, ні порожнього рядка: порожній рядок
    // (>1 переводу) відділяє коментар від декларації — він не про неї.
    if (gapAfter.trim() !== '' || gapAfter.split('\n').length > 2) break
    if (end === -1) end = c.end
    start = c.start
  }
  if (start === -1) return null
  return { start, end }
}

/**
 * Провідний суцільний `//`-блок на самому початку файлу (перед будь-яким кодом)
 * — кандидат на T0-підвищення до header-JSDoc.
 * @param {{ type: string, start: number, end: number }[]} comments список коментарів парсера
 * @param {string} src вміст файлу
 * @returns {{ start: number, end: number }|null} межі блоку або null
 */
export function promotableHeaderBlock(comments, src) {
  const first = comments[0]
  if (!first || first.type !== 'Line') return null
  if (src.slice(0, first.start).replace(SHEBANG_RE, '').trim() !== '') return null
  let end = first.end
  for (let i = 1; i < comments.length; i++) {
    const c = comments[i]
    if (c.type !== 'Line') break
    const gap = src.slice(end, c.start)
    if (gap.trim() !== '' || gap.split('\n').length > 2) break
    end = c.end
  }
  return { start: first.start, end }
}

/**
 * Header-JSDoc файлу: перший коментар — Block `*`, перед ним лише
 * пробіли/shebang.
 * @param {{ type: string, value: string, start: number }[]} comments список коментарів
 * @param {string} src вміст файлу
 * @returns {boolean} true — header є
 */
function hasFileHeader(comments, src) {
  const first = comments[0]
  if (!first || first.type !== 'Block' || !first.value.startsWith('*')) return false
  const before = src.slice(0, first.start)
  return before.replace(SHEBANG_RE, '').trim() === ''
}

/**
 * Перевіряє один файл: header + JSDoc над кожним експортом.
 * @param {string} src вміст файлу
 * @param {string} relPosix posix-відносний шлях (для violation.file)
 * @returns {import('@7n/rules/scripts/lib/lint-surface/types.mjs').LintViolation[]} порушення файлу
 */
export function checkFileDocComments(src, relPosix) {
  const parsed = parseProgramAndCommentsOrNull(src, relPosix)
  if (!parsed) return [] // синтаксис ловлять інші концерни
  const { program, comments } = parsed
  const exports = collectExports(program)
  if (exports.length === 0) return [] // файл без публічного контракту — поза вимогою

  const violations = []
  if (!hasFileHeader(comments, src)) {
    const block = promotableHeaderBlock(comments, src)
    violations.push({
      reason: 'missing-file-header',
      message: `${relPosix}: файл з експортами без провідного header-JSDoc. ${FILE_HEADER_HINT}`,
      file: relPosix,
      data: block ? { promotable: true, start: block.start, end: block.end } : {}
    })
  }
  for (const exp of exports) {
    if (jsDocCommentBefore(comments, src, exp.start)) continue
    const block = promotableLineBlockBefore(comments, src, exp.start)
    violations.push({
      reason: 'missing-export-doc',
      message: `${relPosix}: export ${exp.name} без JSDoc-опису. ${EXPORT_DOC_HINT}`,
      file: relPosix,
      data: block ? { promotable: true, start: block.start, end: block.end, name: exp.name } : { name: exp.name }
    })
  }
  return violations
}

/**
 * Detector js/doc_comments: per-file (дельта) або повний обхід.
 * @param {import('@7n/rules/scripts/lib/lint-surface/types.mjs').LintContext} ctx контекст лінту
 * @returns {Promise<import('@7n/rules/scripts/lib/lint-surface/types.mjs').LintResult>} перелік порушень
 */
export async function lint(ctx) {
  const { cwd, files } = ctx
  const targets =
    files === undefined
      ? await globby(SOURCE_GLOBS, { cwd, gitignore: true, ignore: IGNORE_GLOBS })
      : files.filter(f => isDocCommentTarget(f))

  const violations = []
  for (const rel of targets) {
    if (files === undefined && !isDocCommentTarget(rel)) continue
    const src = await readFile(join(cwd, rel), 'utf8')
    violations.push(...checkFileDocComments(src, rel))
  }
  return { violations }
}
