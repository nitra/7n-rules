/**
 * Спільна фабрика per-file mago detector-ів (`php/mago_fmt`, `php/mago_lint`): обидва
 * концерни мають ідентичну структуру — composer.json gate, per-file targets (`ctx.files`,
 * інакше `.`), `ensureToolAsync('mago')`, `spawnAsync`, fail на ненульовий exit код.
 * Розрізняються лише mago-підкомандою/аргументами, reason id і текстом кроку/mdc-посилання
 * у повідомленні. Rule-local (не `npm/scripts/lib/`) — поки лише `php` має два майже
 * ідентичні per-file mago-детектори; підняти вище, якщо з'явиться третій споживач за
 * межами `plugins/lang-php`.
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'

import { ensureToolAsync } from '@7n/rules/scripts/lib/ensure-tool.mjs'
import { createViolationReporter } from '@7n/rules/scripts/lib/lint-surface/violation-reporter.mjs'
import { spawnAsync } from '@7n/rules/scripts/utils/spawn-async.mjs'

/** Розширення `.php` — фільтр delta-списку файлів у `lint(ctx)`. */
const PHP_EXT_RE = /\.php$/u

/**
 * @typedef {object} MagoPerFileDetectorOptions
 * @property {string[]} magoArgs аргументи mago без цільових шляхів (напр. `['format', '--dry-run']`)
 * @property {string} reason machine-readable reason id порушення
 * @property {string} label людський опис кроку для повідомлення (напр. `mago format (dry-run) — потрібне форматування`)
 * @property {string} mdcName ім'я `.mdc`-файлу концерну для посилання у повідомленні (напр. `mago_fmt.mdc`)
 */

/**
 * Створює detector php/mago_* (read-only). Async — може виконуватись у parallel lane
 * `detectAll()` (ADR 260716-1354).
 * @param {MagoPerFileDetectorOptions} opts опис mago-виклику й тексту порушення
 * @returns {(ctx: import('@7n/rules/scripts/lib/lint-surface/types.mjs').LintContext) => Promise<import('@7n/rules/scripts/lib/lint-surface/types.mjs').LintResult>} lint-функція концерну
 */
export function createMagoPerFileDetector({ magoArgs, reason, label, mdcName }) {
  return async function lint(ctx) {
    const reporter = createViolationReporter(ctx)
    const { fail } = reporter
    const root = ctx.cwd

    if (!existsSync(join(root, 'composer.json'))) return reporter.result()

    const targets = ctx.files === undefined ? ['.'] : ctx.files.filter(f => PHP_EXT_RE.test(f))
    if (targets.length === 0) return reporter.result()

    const magoBin = await ensureToolAsync('mago')
    const r = await spawnAsync(magoBin, [...magoArgs, ...targets], { cwd: root })
    if (r.exitCode !== 0) {
      const code = typeof r.exitCode === 'number' ? r.exitCode : 1
      const out = `${r.stdout ?? ''}${r.stderr ?? ''}`.trim().slice(0, 2000)
      const outSuffix = out ? `\n${out}` : ''
      fail(`lint-php: ${label} (код ${code}, ${mdcName})${outSuffix}`, reason)
    }

    return reporter.result()
  }
}
