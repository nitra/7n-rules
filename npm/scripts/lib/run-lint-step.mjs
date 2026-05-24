/**
 * Спільний хелпер для CLI-обгорток `lint-<rule>`: запускає один крок ланцюжка з логуванням
 * команди і прокидає stdout/stderr на користувацькі stream-и (`stdio: 'inherit'`), щоб виглядало
 * як прямий виклик у shell.
 *
 * Використовується з `n-cursor lint-ga`, `n-cursor lint-text` та інших підкоманд, щоб не дублювати
 * одну й ту саму обгортку у кожному `rules/<id>/js/lint.mjs` (jscpd-clone).
 */
import { spawnSync } from 'node:child_process'

import { resolveCmd } from '../utils/resolve-cmd.mjs'

/**
 * Запускає один крок lint-обгортки: резолвить `cmd` у PATH і `spawnSync` із успадкованим stdio.
 * @param {string} title заголовок для логу (наприклад `actionlint`)
 * @param {string} cmd ім'я команди (`bunx`, `uvx`, `npx`, …)
 * @param {string[]} args аргументи команди
 * @returns {number} код виходу дочірнього процесу: 0 — OK, 127 — команда відсутня в PATH, інше — помилка
 */
export function runLintStep(title, cmd, args) {
  console.log(`\n▶ ${title}: ${cmd} ${args.join(' ')}`)
  const resolved = resolveCmd(cmd)
  if (!resolved) {
    console.error(`❌ ${cmd} не знайдено в PATH (${title}).`)
    return 127
  }
  const r = spawnSync(resolved, args, { stdio: 'inherit', env: process.env })
  if (r.error) {
    console.error(`❌ Не вдалося запустити ${cmd}: ${r.error.message}`)
    return 1
  }
  return r.status ?? 1
}
