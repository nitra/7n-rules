/**
 * lint-поверхня image-compress/check: read-only detector синхронності image-файлів із
 * `.n-minify-image.tsv` (`@nitra/minify-image --json`, запущений через `bunx` — пакет
 * використовує `Bun.Image`, bun-only global). Стиснення (`--write`) — окремий fix, не
 * в detector-і.
 */
import { createViolationReporter } from '../../../scripts/lib/lint-surface/violation-reporter.mjs'
import { resolveCmd } from '../../../scripts/utils/resolve-cmd.mjs'
import { spawnAsync } from '../../../scripts/utils/spawn-async.mjs'

const JSON_MAX_BUFFER = 20 * 1024 * 1024

/**
 * @param {string} stdout stdout
 * @returns {{ summary?: { needsCompression?: unknown, total?: unknown } }} розпарсений JSON `--json`
 */
function parseMinifyJson(stdout) {
  return JSON.parse(stdout)
}

/**
 * Detector image-compress/check: \@nitra/minify-image --json (read-only).
 * @param {import('../../../scripts/lib/lint-surface/types.mjs').LintContext} ctx контекст lint-прогону
 * @returns {Promise<import('../../../scripts/lib/lint-surface/types.mjs').LintResult>} результат detector-а
 */
export async function lint(ctx) {
  const reporter = createViolationReporter(ctx)
  const { fail } = reporter
  const cwd = ctx.cwd

  // `@nitra/minify-image` v4 використовує `Bun.Image` (bun-only global) — запуск через
  // `npx` (Node) мовчки провалює компресію (Bun.Image відсутній) і детектор хибно репортує
  // майже всі файли як такі, що потребують стиснення. Тому запускаємо через `bunx`
  // (резолвиться через resolveCmd — абсолютний шлях, той самий патерн, що й js/eslint).
  // Якщо bunx відсутній у PATH (CI-образ лише з Node) — пропускаємо detector з info-діагностикою,
  // як security/scan пропускає скан за відсутності trufflehog.
  const bunx = resolveCmd('bunx')
  if (!bunx) {
    return {
      violations: [],
      diagnostics: [{ level: 'info', message: 'image-compress: `bunx` не знайдено в PATH — перевірку пропущено' }]
    }
  }

  let r
  try {
    r = await spawnAsync(bunx, ['@nitra/minify-image', '--src=.', '--json'], {
      cwd,
      env: process.env,
      maxBuffer: JSON_MAX_BUFFER
    })
  } catch (error) {
    fail(`image-compress: не вдалося запустити bunx @nitra/minify-image --json: ${error.message}`, 'tool-error')
    return reporter.result()
  }
  if (r.exitCode !== 0) {
    const detail = [r.stdout, r.stderr].filter(Boolean).join('\n').trim()
    const detailSuffix = detail ? `:\n${detail}` : ''
    fail(`image-compress: @nitra/minify-image --json завершився з кодом ${r.exitCode}${detailSuffix}`, 'tool-error')
    return reporter.result()
  }

  let report
  try {
    report = parseMinifyJson(r.stdout)
  } catch {
    fail('image-compress: @nitra/minify-image --json повернув невалідний JSON', 'tool-error')
    return reporter.result()
  }

  const needsCompression = Number(report.summary?.needsCompression ?? 0)
  const total = Number(report.summary?.total ?? 0)
  if (needsCompression > 0) {
    fail(
      `image-compress: ${needsCompression}/${total} image-файлів потребують стиснення — запусти \`n-rules lint image-compress\` локально`,
      'needs-compression'
    )
  }
  return reporter.result()
}
