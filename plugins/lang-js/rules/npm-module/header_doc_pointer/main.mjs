/** Контракт: ./docs/header_doc_pointer.md */
import { existsSync } from 'node:fs'
import { readFile, readdir } from 'node:fs/promises'
import { basename, join } from 'node:path'

import { createViolationReporter } from '@7n/rules/scripts/lib/lint-surface/violation-reporter.mjs'

/** Перший JSDoc-блок у файлі (не-жадібний). */
const MODULE_JSDOC_RE = /\/\*\*[\s\S]*?\*\//

/**
 * `import` або `export` на початку рядка — межа між module-level і body.
 * Regex, не AST: нас цікавить тільки текстова позиція, не семантика JS.
 */
const CODE_START_RE = /^(?:import|export)\b/m

const NON_WHITESPACE_RE = /\S/
const STAR_INDENT_RE = /^\s*\*\s?/

/**
 * Кількість непорожніх рядків між `/**` і `*\/` (після зрізання `*`-відступу).
 * @param {string} block повний текст JSDoc-блоку з обрамленням
 * @returns {number} кількість непорожніх рядків у тілі
 */
function contentLineCount(block) {
  return block
    .split('\n')
    .slice(1, -1)
    .filter(l => NON_WHITESPACE_RE.test(l.replace(STAR_INDENT_RE, ''))).length
}

/**
 * Повертає module-level JSDoc або `null`, якщо його немає.
 * @param {string} source вміст mjs-файлу
 * @returns {string|null} текст module-level JSDoc-блоку або null
 */
function moduleJsDoc(source) {
  const codeStart = CODE_START_RE.exec(source)
  const prefix = codeStart ? source.slice(0, codeStart.index) : source
  const m = MODULE_JSDOC_RE.exec(prefix)
  return m ? m[0] : null
}

/**
 * Чи `.mjs`-файл, що не є тестом (`*.test.mjs`).
 * @param {import('node:fs').Dirent} fileEntry запис каталогу
 * @returns {boolean} true для звичайних source-файлів
 */
function isSourceMjs(fileEntry) {
  return fileEntry.isFile() && fileEntry.name.endsWith('.mjs') && !fileEntry.name.endsWith('.test.mjs')
}

/**
 * Перевіряє один source-файл: якщо поряд є `docs/<stem>.md` і module-level JSDoc
 * містить >1 непорожній рядок — репортить порушення.
 * @param {string} jsDir каталог `js/`
 * @param {import('node:fs').Dirent} fileEntry запис файлу
 * @param {string} cwd корінь репозиторію
 * @param {ReturnType<typeof createViolationReporter>} reporter репортер
 * @returns {Promise<void>}
 */
async function checkSourceFile(jsDir, fileEntry, cwd, reporter) {
  const stem = basename(fileEntry.name, '.mjs')
  const docsPath = join(jsDir, 'docs', `${stem}.md`)
  if (!existsSync(docsPath)) return

  const filePath = join(jsDir, fileEntry.name)
  const source = await readFile(filePath, 'utf8')
  const block = moduleJsDoc(source)
  if (!block) return

  const count = contentLineCount(block)
  if (count > 1) {
    reporter.fail(
      `${filePath.slice(cwd.length + 1)}: docs/${stem}.md вже описує поведінку — module-level JSDoc має бути pointer (≤1 рядок, зараз ${count})`
    )
  }
}

/**
 * Перевіряє всі source-файли в одному `js/`-каталозі правила/скіла.
 * @param {string} jsDir каталог `js/`
 * @param {string} cwd корінь репозиторію
 * @param {ReturnType<typeof createViolationReporter>} reporter репортер
 * @returns {Promise<void>}
 */
async function checkJsDir(jsDir, cwd, reporter) {
  for (const fileEntry of await readdir(jsDir, { withFileTypes: true })) {
    if (!isSourceMjs(fileEntry)) continue
    await checkSourceFile(jsDir, fileEntry, cwd, reporter)
  }
}

/**
 * Перевіряє один base-сегмент (`npm/rules` чи `npm/skills`): обходить піддиректорії
 * правил/скілів і їхні `js/`-каталоги.
 * @param {string} absBase абсолютний шлях до base-сегмента
 * @param {string} cwd корінь репозиторію
 * @param {ReturnType<typeof createViolationReporter>} reporter репортер
 * @returns {Promise<void>}
 */
async function checkBaseSegment(absBase, cwd, reporter) {
  for (const ruleEntry of await readdir(absBase, { withFileTypes: true })) {
    if (!ruleEntry.isDirectory() || ruleEntry.name.startsWith('.')) continue

    const jsDir = join(absBase, ruleEntry.name, 'js')
    if (!existsSync(jsDir)) continue

    await checkJsDir(jsDir, cwd, reporter)
  }
}

/**
 * Сканує `npm/rules/*\/js/*.mjs` і `npm/skills/*\/js/*.mjs`.
 * Якщо поряд існує `docs/<stem>.md` — module-level JSDoc має бути pointer (≤1 рядок),
 * а не наратив; якщо docs немає — без обмежень.
 * @param {import('@7n/rules/scripts/lib/lint-surface/types.mjs').LintContext} ctx контекст лінту (cwd, репортер).
 * @returns {Promise<import('@7n/rules/scripts/lib/lint-surface/types.mjs').LintResult>} результат перевірки з pass/fail.
 */
export async function lint(ctx) {
  const cwd = ctx.cwd
  const reporter = createViolationReporter(ctx)

  for (const baseSegment of ['npm/rules', 'npm/skills']) {
    const absBase = join(cwd, baseSegment)
    if (!existsSync(absBase)) continue
    await checkBaseSegment(absBase, cwd, reporter)
  }

  return reporter.result()
}
