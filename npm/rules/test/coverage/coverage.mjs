/**
 * Канонічна команда `n-cursor coverage`: збирає метрики покриття + мутаційного
 * тестування з усіх провайдерів, чиє правило активне в `.n-cursor.json#rules`,
 * агрегує та записує COVERAGE.md у корінь проєкту.
 *
 * Discovery провайдерів — за `.n-cursor.json#rules`: для кожного `ruleId` зі
 * списку шукаємо `npm/rules/<ruleId>/coverage/coverage.mjs` і динамічно
 * імпортуємо. Якщо файлу немає — провайдер для цього правила відсутній (skip
 * silently, не помилка).
 *
 * Лок — прямий виклик `withLock('coverage', steps)`. Один CLI-консумер, один
 * callsite — спільна точка входу не виноситься (YAGNI, див. C4 у
 * specs/2026-05-24-coverage-rule-design.md).
 */
import { existsSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { readNCursorConfigLite } from '../../../scripts/lib/read-n-cursor-config-lite.mjs'
import { withLock } from '../../../scripts/utils/with-lock.mjs'

/** Корінь `npm/rules/` — `<rules>/test/coverage` → `<rules>` */
const RULES_DIR = dirname(dirname(dirname(fileURLToPath(import.meta.url))))

/**
 * Сума двох coverage-totals.
 * @param {{lines:{covered:number,total:number}, functions:{covered:number,total:number}}} a перший subtotal
 * @param {{lines:{covered:number,total:number}, functions:{covered:number,total:number}}} b другий subtotal
 * @returns {{lines:{covered:number,total:number}, functions:{covered:number,total:number}}} сумарні lines/functions
 */
export function addCoverage(a, b) {
  return {
    lines: { covered: a.lines.covered + b.lines.covered, total: a.lines.total + b.lines.total },
    functions: {
      covered: a.functions.covered + b.functions.covered,
      total: a.functions.total + b.functions.total
    }
  }
}

/**
 * Сума двох mutation-counts.
 * @param {{caught:number,total:number}} a перший subtotal
 * @param {{caught:number,total:number}} b другий subtotal
 * @returns {{caught:number,total:number}} сумарні caught/total
 */
export function addMutation(a, b) {
  return { caught: a.caught + b.caught, total: a.total + b.total }
}

/**
 * Форматує covered/total як `XX.XX% (covered/total)`.
 * @param {{covered:number,total:number}} metric метрика lines або functions
 * @returns {string} відформатований рядок для таблиці COVERAGE.md
 */
export function formatCoverage({ covered, total }) {
  const percent = total === 0 ? '—' : `${((covered / total) * 100).toFixed(2)}%`
  return `${percent} (${covered}/${total})`
}

/**
 * Форматує мутаційний score як `XX.XX%`.
 * @param {{caught:number,total:number}} metric агрегований mutation score
 * @returns {string} відформатований score або прочерк
 */
export function formatScore({ caught, total }) {
  return total === 0 ? '—' : `${((caught / total) * 100).toFixed(2)}%`
}

/**
 * Рендерить таблицю покриття + мутаційного тестування як Markdown.
 * Без timestamp, щоб git diff рухався лише при зміні метрик.
 * @param {Array<{area:string, coverage:{lines:{covered:number,total:number},functions:{covered:number,total:number}}, mutation:{caught:number,total:number}}>} rows рядки провайдерів
 * @returns {string} Markdown-таблиця з заголовком `# Coverage`
 */
export function renderMarkdown(rows) {
  const lines = [
    '# Coverage',
    '',
    '| Область | Рядки | Функції | Вбито мутацій | Score |',
    '| --- | --- | --- | --- | --- |'
  ]
  for (const row of rows) {
    lines.push(
      `| ${row.area} | ${formatCoverage(row.coverage.lines)} | ${formatCoverage(row.coverage.functions)} | ` +
        `${row.mutation.caught}/${row.mutation.total} | ${formatScore(row.mutation)} |`
    )
  }
  return `${lines.join('\n')}\n`
}

/**
 * Завантажує provider-модуль з `<rulesDir>/<ruleId>/coverage/coverage.mjs`.
 * Повертає null коли:
 *   - файлу немає (rule без coverage-провайдера),
 *   - файл існує, але не експортує `detect` + `collect` як функції (наприклад,
 *     `rules/test/coverage/coverage.mjs` — сам оркестратор, не провайдер).
 * @param {string} rulesDir корінь `npm/rules/`
 * @param {string} ruleId id правила з `.n-cursor.json#rules`
 * @returns {Promise<{detect:Function, collect:Function}|null>} provider-модуль або null
 */
async function loadProvider(rulesDir, ruleId) {
  const providerPath = join(rulesDir, ruleId, 'coverage', 'coverage.mjs')
  if (!existsSync(providerPath)) return null
  const mod = await import(providerPath)
  if (typeof mod.detect !== 'function' || typeof mod.collect !== 'function') return null
  return mod
}

/**
 * Будує підсумковий рядок «Разом» через сумування всіх coverage/mutation.
 * @param {Array<{area:string, coverage:object, mutation:object}>} rows рядки провайдерів без totals
 * @returns {{area:string, coverage:object, mutation:{caught:number,total:number}}} агрегований рядок «Разом»
 */
function buildTotalsRow(rows) {
  let totalCoverage = { lines: { covered: 0, total: 0 }, functions: { covered: 0, total: 0 } }
  let totalMutation = { caught: 0, total: 0 }
  for (const row of rows) {
    totalCoverage = addCoverage(totalCoverage, row.coverage)
    totalMutation = addMutation(totalMutation, row.mutation)
  }
  return { area: '**Разом**', coverage: totalCoverage, mutation: totalMutation }
}

/**
 * Виконує coverage-pipeline: discovery провайдерів за `.n-cursor.json#rules`,
 * detect+collect для кожного, агрегація, запис COVERAGE.md.
 * @param {{cwd?:string, rulesDir?:string}} [opts] ін'єкція cwd/rulesDir для тестів
 * @returns {Promise<number>} exit code (0 OK, 1 коли жоден провайдер не дав даних)
 */
export async function runCoverageSteps(opts = {}) {
  const cwd = opts.cwd ?? process.cwd()
  const rulesDir = opts.rulesDir ?? RULES_DIR
  const config = await readNCursorConfigLite(cwd)
  const rows = []

  for (const ruleId of config.rules) {
    if (config.disableRules.includes(ruleId)) continue
    const provider = await loadProvider(rulesDir, ruleId)
    if (!provider) continue
    if (!(await provider.detect(cwd))) continue
    console.log(`→ ${ruleId} coverage…`)
    rows.push(...(await provider.collect(cwd)))
  }

  if (rows.length === 0) {
    console.error('✗ Жодного провайдера покриття не знайдено для активних правил у .n-cursor.json#rules')
    return 1
  }

  rows.push(buildTotalsRow(rows))
  const md = renderMarkdown(rows)
  await writeFile(join(cwd, 'COVERAGE.md'), md, 'utf8')
  console.log('✓ COVERAGE.md')
  return 0
}

// Один оркестратор, один callsite — `withLock` викликається напряму, без спільної
// точки входу. Канонічне обмеження «не імпортуй withLock у lint.mjs/fix.mjs напряму»
// (scripts.mdc § withLock) націлене на дедуплікацію preamble серед багатьох файлів —
// для одного coverage-консумера не релевантне (див. C4 у
// specs/2026-05-24-coverage-rule-design.md).
export const runCoverageCli = () => withLock('coverage', runCoverageSteps)
