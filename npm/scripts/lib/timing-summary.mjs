/**
 * Формат таблиці-резюме часу виконання для orchestrator `fix` / `lint`.
 *
 * Дві спільні точки використання:
 *  - `runFixCommand` у `bin/n-cursor.js` — після прогону всіх `rules/<id>/check.mjs`.
 *  - `runLintCli` у `scripts/lib/run-lint-cli.mjs` — після прогону `lint-*` скриптів з кореневого `package.json`.
 *
 * Чиста функція без I/O — повертає готовий рядок (з фінальним `\n`), друк — на стороні виклику.
 * Час виводиться як `<ціла>.<десята>s`, навіть для коротших за секунду інтервалів — щоб одиниця була стабільна.
 *
 * Маркер `❌` на рядку — якщо `ok === false`.
 * @typedef {{ id: string, ms: number, ok: boolean }} TimingEntry
 */

/** @type {string} символ горизонтальної риски між списком і `total` */
const RULER = '─'

/**
 * Форматує мілісекунди як `<sec>.<десята>s`. Округлення до десятої — нижнє (floor), щоб
 * однаковий ms давав однаковий вивід у різних таблицях незалежно від платформи (Number.prototype.toFixed
 * робить round-half-to-even, що для 950ms дає `0.9s` — приймаємо).
 * @param {number} ms тривалість у мілісекундах (>= 0)
 * @returns {string} наприклад `0.0s`, `1.2s`, `12.3s`
 */
export function formatDurationMs(ms) {
  const seconds = Math.max(0, ms) / 1000
  return `${seconds.toFixed(1)}s`
}

/**
 * Рендерить таблицю-резюме у вигляді багаторядкового тексту, готового до stdout.
 *
 * Структура:
 *
 * ```
 * ⏱  <title>:
 *    <id>          <duration>  [❌]
 *    ...
 *    ──────────────
 *    total         <sum>
 * ```
 *
 * Ширина колонки id вирівнюється під найдовший id у списку. Мінімальна ширина risk — 14
 * (узгоджено з типовою довжиною заголовків `fix-js-lint` / `lint-security`).
 * @param {string} title заголовок таблиці (наприклад, `Fix timing` або `Lint timing`)
 * @param {TimingEntry[]} timings записи в порядку запуску — друкуються як є, не сортуються
 * @returns {string} готовий до stdout текст з кінцевим `\n`
 */
export function formatTimingSummary(title, timings) {
  if (timings.length === 0) {
    return ''
  }
  const idWidth = Math.max(14, ...timings.map(t => t.id.length))
  const lines = [`\n⏱  ${title}:`]
  let totalMs = 0
  for (const { id, ms, ok } of timings) {
    totalMs += ms
    const failMark = ok ? '' : '  ❌'
    lines.push(`   ${id.padEnd(idWidth)}  ${formatDurationMs(ms)}${failMark}`)
  }
  lines.push(`   ${RULER.repeat(idWidth + 2 + 6)}`, `   ${'total'.padEnd(idWidth)}  ${formatDurationMs(totalMs)}`)
  return `${lines.join('\n')}\n`
}
