/**
 * Спільний хелпер для CLI-обгорток `lint-<rule>`: запускає один крок ланцюжка з логуванням
 * команди. У `verbose` прокидає stdout/stderr на користувацькі stream-и (`stdio: 'inherit'`),
 * щоб виглядало як прямий виклик у shell; без `verbose` — тихо (captured stdio), щоб не
 * засмічувати прогрес-бар `lint --full`, і друкує captured вивід лише при реальному
 * порушенні (для контексту `fail()`).
 *
 * Використовується з rule-адаптерів `n-cursor lint <rule>`, щоб не дублювати
 * одну й ту саму обгортку у кожному `rules/<id>/js/lint.mjs` (jscpd-clone).
 */
import { spawnSync } from 'node:child_process'

import { resolveCmd } from '../utils/resolve-cmd.mjs'

/**
 * Запускає один крок lint-обгортки: визначає `cmd` у PATH і `spawnSync`.
 * @param {string} title заголовок для логу (наприклад `actionlint`)
 * @param {string} cmd ім'я команди (`bunx`, `uvx`, `npx`, …)
 * @param {string[]} args аргументи команди
 * @param {{ verbose?: boolean }} [opts] опції: `verbose` — повний вивід тулу (заголовок + inherited stdio)
 * @returns {number} код виходу дочірнього процесу: 0 — OK, 127 — команда відсутня в PATH, інше — помилка
 */
export function runLintStep(title, cmd, args, opts = {}) {
  const verbose = opts.verbose === true
  const header = `\n▶ ${title}: ${cmd} ${args.join(' ')}`
  if (verbose) console.log(header)
  const resolved = resolveCmd(cmd)
  if (!resolved) {
    console.error(`❌ ${cmd} не знайдено в PATH (${title}).`)
    return 127
  }
  const r = spawnSync(resolved, args, { stdio: verbose ? 'inherit' : 'pipe', env: process.env })
  if (r.error) {
    console.error(`❌ Не вдалося запустити ${cmd}: ${r.error.message}`)
    return 1
  }
  const code = r.status ?? 1
  if (!verbose && code !== 0 && code !== 127) {
    console.log(header)
    if (r.stdout) process.stdout.write(r.stdout)
    if (r.stderr) process.stderr.write(r.stderr)
  }
  return code
}
