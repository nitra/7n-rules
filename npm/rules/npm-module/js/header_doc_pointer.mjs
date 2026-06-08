/** Контракт: ./docs/header_doc_pointer.md */
import { existsSync } from 'node:fs'
import { readFile, readdir } from 'node:fs/promises'
import { basename, join } from 'node:path'

import { createCheckReporter } from '../../../scripts/lib/check-reporter.mjs'

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
    .filter(l => NON_WHITESPACE_RE.test(l.replace(STAR_INDENT_RE, '')))
    .length
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
 * Сканує `npm/rules/*\/js/*.mjs` і `npm/skills/*\/js/*.mjs`.
 * Якщо поряд існує `docs/<stem>.md` — module-level JSDoc має бути pointer (≤1 рядок),
 * а не наратив; якщо docs немає — без обмежень.
 * @param {string} [cwd] корінь репозиторію
 * @returns {Promise<number>} 0 — OK, 1 — порушення
 */
export async function check(cwd = process.cwd()) {
  const reporter = createCheckReporter()

  for (const baseSegment of ['npm/rules', 'npm/skills']) {
    const absBase = join(cwd, baseSegment)
    if (!existsSync(absBase)) continue

    for (const ruleEntry of await readdir(absBase, { withFileTypes: true })) {
      if (!ruleEntry.isDirectory() || ruleEntry.name.startsWith('.')) continue

      const jsDir = join(absBase, ruleEntry.name, 'js')
      if (!existsSync(jsDir)) continue

      for (const fileEntry of await readdir(jsDir, { withFileTypes: true })) {
        if (
          !fileEntry.isFile() ||
          !fileEntry.name.endsWith('.mjs') ||
          fileEntry.name.endsWith('.test.mjs')
        )
          continue

        const stem = basename(fileEntry.name, '.mjs')
        const docsPath = join(jsDir, 'docs', `${stem}.md`)
        if (!existsSync(docsPath)) continue

        const filePath = join(jsDir, fileEntry.name)
        const source = await readFile(filePath, 'utf8')
        const block = moduleJsDoc(source)
        if (!block) continue

        const count = contentLineCount(block)
        if (count > 1) {
          reporter.fail(
            `${filePath.slice(cwd.length + 1)}: docs/${stem}.md вже описує поведінку — module-level JSDoc має бути pointer (≤1 рядок, зараз ${count})`
          )
        }
      }
    }
  }

  return reporter.getExitCode()
}
