/** @see ./docs/fix-eslint.md */

/**
 * T0-autofix для `js/eslint` — детермінований прогін лінтерів у fix-режимі
 * (`oxlint --fix` + `eslint --fix`) на файлах, де детектор знайшов порушення.
 * Виправляє лише авто-fixable правила; решта лишається детектору на re-check
 * (далі — LLM-ладдер). Запис permanent (поза rollback).
 *
 * Межа CI: цей модуль — частина fix-фази (`lint` без `--no-fix`); сам по собі
 * detector-шлях його не вантажить. У CI (`--no-fix`) fix не запускається —
 * узгоджено із забороною `oxlint --fix`/`eslint --fix` у CI (js.mdc / lint_js_yml).
 */
import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { ESLint } from 'eslint'

import { filterJsFiles } from './main.mjs'

/**
 * Вміст файлу або null, якщо не читається (видалений/недоступний).
 * @param {string} abs абсолютний шлях
 * @returns {string|null} вміст або null
 */
function readOrNull(abs) {
  try {
    return readFileSync(abs, 'utf8')
  } catch {
    return null
  }
}

/**
 * Прогін `oxlint --fix` + `eslint --fix` по списку js-файлів. Повертає абсолютні
 * шляхи фактично змінених файлів (порівняння до/після).
 * @param {string[]} jsFiles posix-relative js-файли
 * @param {string} cwd корінь проєкту
 * @returns {Promise<string[]>} абсолютні шляхи змінених файлів
 */
async function runLinterFix(jsFiles, cwd) {
  const abs = jsFiles.map(f => resolve(cwd, f))
  const before = new Map(abs.map(a => [a, readOrNull(a)]))

  // oxlint --fix (CLI): авто-fixable oxc-правила.
  spawnSync('bunx', ['oxlint', '--fix', ...jsFiles], { cwd, encoding: 'utf8' })

  // eslint --fix (API): outputFixes пише виправлені файли на диск.
  const eslint = new ESLint({ cwd, fix: true })
  const results = await eslint.lintFiles(abs)
  await ESLint.outputFixes(results)

  /** @type {string[]} */
  const touched = []
  for (const a of abs) {
    if (readOrNull(a) !== before.get(a)) touched.push(a)
  }
  return touched
}

/**
 * Реєстр "механічних" правил `js/eslint`: `oxlint --fix`/`eslint --fix` (T0
 * `js-eslint-autofix` вище) їх НЕ покриває (suggestion-only у власній реалізації
 * інструментів — перевірено емпірично: лишаються порушеними після `--fix` на
 * реальних прогонах), але текстуальна заміна на позначеному рядку однозначна й
 * безпечна без повного AST-парсингу — проста заміна ідентифікатора/API-виклику.
 * `reasons` — обидва формати `reason` з `main.mjs` (`f.rule`): eslint (`ruleId`,
 * `"plugin/rule"`) і oxlint (`d.code`, `"plugin(rule)"`) — те саме правило різні
 * тули віддають по-різному.
 * @type {Array<{ reasons: string[], replace: (line: string) => string|null }>}
 */
const MECHANICAL_TEXT_FIXES = [
  {
    // Number.isInteger(x) не ловить x поза Number.MIN/MAX_SAFE_INTEGER — сама заміна
    // імені методу семантично точна для рядка, що ЛИШЕ так і викликає isInteger.
    reasons: ['unicorn/prefer-number-is-safe-integer', 'unicorn(prefer-number-is-safe-integer)'],
    replace: line =>
      line.includes('Number.isInteger') ? line.replaceAll('Number.isInteger', 'Number.isSafeInteger') : null
  }
]

/**
 * Знаходить механічний фікс для reason-у порушення (обидва формати tool-у).
 * @param {string} reason `violation.reason`
 * @returns {((line: string) => string|null)|null} replace-функція або null
 */
function mechanicalFixFor(reason) {
  return MECHANICAL_TEXT_FIXES.find(f => f.reasons.includes(reason))?.replace ?? null
}

/**
 * Застосовує механічні текстові заміни по конкретних рядках (`data.line`, 1-indexed)
 * файлу. Рядок без збігу очікуваного шаблону (файл змінився з моменту detect-у) —
 * пропускається, не гадаємо.
 * @param {string} content вміст файлу
 * @param {Array<{ line: number, replace: (line: string) => string|null }>} targets рядки й replace-функції
 * @returns {string|null} новий вміст або null, якщо жоден рядок не змінився
 */
function applyMechanicalLineFixes(content, targets) {
  const lines = content.split('\n')
  let changed = false
  for (const { line, replace } of targets) {
    const idx = line - 1
    if (idx < 0 || idx >= lines.length) continue
    const next = replace(lines[idx])
    if (next !== null && next !== lines[idx]) {
      lines[idx] = next
      changed = true
    }
  }
  return changed ? lines.join('\n') : null
}

/** @type {import('@7n/rules/scripts/lib/lint-surface/types.mjs').T0Pattern[]} */
export const patterns = [
  {
    id: 'js-eslint-autofix',
    test: violations => violations.some(v => v.file),
    apply: async (violations, ctx) => {
      const files = [...new Set(violations.map(v => v.file).filter(Boolean))]
      const jsFiles = filterJsFiles(files)
      if (jsFiles.length === 0) return { touchedFiles: [] }
      const touchedFiles = await runLinterFix(jsFiles, ctx.cwd)
      for (const a of touchedFiles) ctx.recordWrite?.(a)
      return touchedFiles.length > 0
        ? { touchedFiles, message: `oxlint/eslint --fix: ${touchedFiles.length} файл(ів)` }
        : { touchedFiles: [] }
    }
  },
  {
    id: 'js-eslint-mechanical-text-fix',
    test: violations => violations.some(v => v.file && v.data?.line && mechanicalFixFor(v.reason)),
    apply: (violations, ctx) => {
      /** @type {Map<string, Array<{ line: number, replace: (line: string) => string|null }>>} */
      const byFile = new Map()
      for (const v of violations) {
        const replace = v.file && v.data?.line ? mechanicalFixFor(v.reason) : null
        if (!replace) continue
        const arr = byFile.get(v.file)
        const target = { line: v.data.line, replace }
        if (arr) arr.push(target)
        else byFile.set(v.file, [target])
      }
      const touchedFiles = []
      for (const [rel, targets] of byFile) {
        const abs = resolve(ctx.cwd, rel)
        const content = readOrNull(abs)
        if (content === null) continue
        const next = applyMechanicalLineFixes(content, targets)
        if (next === null) continue
        ctx.recordWrite?.(abs)
        writeFileSync(abs, next)
        touchedFiles.push(abs)
      }
      return touchedFiles.length > 0
        ? { touchedFiles, message: `механічні текстові заміни: ${touchedFiles.length} файл(ів)` }
        : { touchedFiles: [] }
    }
  }
]
