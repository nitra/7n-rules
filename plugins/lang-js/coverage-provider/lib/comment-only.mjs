/**
 * Детекція comment-only змін JS/TS-файлу відносно merge-base делти: делта-гейт
 * покриття не має гейтити файли, де змінились лише коментарі/форматування
 * (rollout doc-коментарів затягував у гейт десятки файлів без зміни коду).
 * Порівняння — через oxc-AST без коментарів (JSON-серіалізація програм):
 * стійке до лапок/рядкових літералів, на відміну від регекс-стрипу. Будь-яка
 * невизначеність (нема base-версії, синтакс-помилка) → «не comment-only» —
 * консервативно лишає файл у гейті.
 */
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { resolveChangedBase } from '@7n/rules/scripts/lib/changed-files.mjs'
import { parseAst } from './parse-ast.mjs'

/**
 * Канонічне серіалізоване AST без span-полів: позиції вузлів зсуваються від
 * доданих коментарів, тож для порівняння «той самий код» їх треба прибрати.
 * @param {string} source джерело
 * @param {string} filename імʼя файлу (діалект парсера)
 * @returns {string|null} канонічний JSON або null (синтакс-помилка)
 */
function canonicalAst(source, filename) {
  try {
    return JSON.stringify(parseAst(source, filename), (key, value) => (key === 'start' || key === 'end' ? 0 : value))
  } catch {
    return null
  }
}

/**
 * Чи зміна файлу vs base — лише коментарі/пробіли (код ідентичний).
 * @param {string} cwd корінь проєкту
 * @param {string} relFile шлях файлу relative до cwd
 * @param {{base?: string|null, spawn?: typeof spawnSync}} [opts] base-ref (дефолт — merge-base делти) і spawn-інʼєкція
 * @returns {boolean} true — файл можна пропустити в делта-гейті
 */
export function isCommentOnlyChange(cwd, relFile, opts = {}) {
  const spawn = opts.spawn ?? spawnSync
  const base = opts.base ?? resolveChangedBase(cwd)
  if (!base) return false

  const shown = spawn('git', ['show', `${base}:${relFile}`], { cwd, encoding: 'utf8' })
  if (shown.status !== 0 || shown.error) return false

  let current
  try {
    current = readFileSync(join(cwd, relFile), 'utf8')
  } catch {
    return false
  }

  const before = canonicalAst(shown.stdout, relFile)
  if (before === null) return false
  const after = canonicalAst(current, relFile)
  if (after === null) return false
  return before === after
}
