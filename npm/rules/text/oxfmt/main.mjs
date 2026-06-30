/** @see ./docs/main.md */

/**
 * lint-поверхня `text/oxfmt`: read-only detector форматування через `oxfmt --list-different`.
 * oxfmt — мандатний форматер проєкту (Prettier заборонено, text/forbidden-prettier); конфіг —
 * `.oxfmtrc.json` (включно з `ignorePatterns`). Автофікс (`oxfmt --write`) — окремий T0
 * `fix-oxfmt.mjs`, не в detector-і. Тул відсутній у PATH → SKIP (не violation), як інші зовнішні.
 */
import { spawnSync } from 'node:child_process'
import { relative, resolve } from 'node:path'

import { createViolationReporter } from '../../../scripts/lib/lint-surface/violation-reporter.mjs'
import { resolveCmd } from '../../../scripts/utils/resolve-cmd.mjs'

const JSON_MAX_BUFFER = 64 * 1024 * 1024
const FMT_EXT_RE = /\.(?:m?[jt]s|c[jt]s|jsx|tsx|vue|css|scss)$/u
// Безконфліктна formatter-домена: oxfmt-типи, що їх не форматує інше тулінг (md/json/yaml — поза).
const FMT_GLOB = '**/*.{js,mjs,cjs,jsx,ts,tsx,mts,cts,vue,css,scss}'

/**
 * Detector: повертає по одному violation на кожен неформатований файл.
 * @param {import('../../../scripts/lib/lint-surface/types.mjs').LintContext} ctx
 * @returns {import('../../../scripts/lib/lint-surface/types.mjs').LintResult}
 */
export function lint(ctx) {
  const { cwd, files } = ctx
  const reporter = createViolationReporter(ctx)
  const oxfmt = resolveCmd('oxfmt')
  if (!oxfmt) return reporter.result() // тул відсутній → skip

  const targets = files === undefined ? [FMT_GLOB] : files.filter(f => FMT_EXT_RE.test(f))
  if (targets.length === 0) return reporter.result()

  const r = spawnSync(oxfmt, ['--list-different', ...targets], { cwd, encoding: 'utf8', maxBuffer: JSON_MAX_BUFFER })
  const unformatted = (r.stdout ?? '')
    .split('\n')
    .map(s => s.trim())
    .filter(Boolean)
  for (const f of unformatted) {
    const rel = relative(cwd, resolve(cwd, f)).split('\\').join('/')
    reporter.fail(`${rel}: не відформатовано (oxfmt --write виправить; text.mdc)`, {
      reason: 'oxfmt-unformatted',
      file: rel,
      data: { kind: 'oxfmt-unformatted' }
    })
  }
  return reporter.result()
}
