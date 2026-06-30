/**
 * T0-autofix для `image-avif/avif_generation` — AVIF-етап: генерація `.avif`-двійників
 * (`npx @nitra/minify-image --avif`), переписування raster-посилань у `.vue`/`.html` на
 * `<path>.avif` і прибирання `.avif`-сиріт. Логіку перенесено з detector-а (read-only
 * contract: detector лише ЗВІТУЄ rewrite/missing/orphan, мутації — тут).
 *
 * Unified lint surface: structured violations (test(violations)/apply(violations,ctx)).
 * Дії резолвимо повторним скануванням (`scanAvif`) ПІСЛЯ генерації — згенеровані
 * `.avif` стають видимими, missing → rewrite. Idempotent: clean-стан → 0 змін.
 * У тестах генерацію можна вимкнути через `NITRA_CURSOR_NO_AVIF_RUN=1`.
 */
import { unlink, writeFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { env } from 'node:process'

import { resolveCmd } from '../../../scripts/utils/resolve-cmd.mjs'

import { AVIF_MISSING, AVIF_NEEDS_REWRITE, AVIF_ORPHAN, MINIFY_PACKAGE_NAME, scanAvif } from './main.mjs'

const TRIGGER_REASONS = new Set([AVIF_NEEDS_REWRITE, AVIF_MISSING, AVIF_ORPHAN])

/**
 * Запускає `npx @nitra/minify-image --src=. --write --avif` для генерації AVIF-двійників.
 * Best-effort: відсутній npx / помилка / ненульовий код — лог-варн без падіння (rewrite/
 * missing з наступного скану покажуть, де `.avif` все ще бракує). `NITRA_CURSOR_NO_AVIF_RUN=1`
 * — no-op (тести й ізольовані середовища).
 * @param {string} cwd корінь репозиторію
 * @returns {void}
 */
function runAvifGeneration(cwd) {
  if (env.NITRA_CURSOR_NO_AVIF_RUN === '1') return
  const npxPath = resolveCmd('npx')
  if (!npxPath) {
    console.log(`  ⚠️  'npx' не знайдено в PATH — пропускаємо генерацію AVIF`)
    return
  }
  const result = spawnSync(npxPath, [MINIFY_PACKAGE_NAME, '--src=.', '--write', '--avif'], {
    stdio: 'inherit',
    cwd,
    env
  })
  if (result.error) {
    console.log(`  ⚠️  не вдалося запустити \`npx ${MINIFY_PACKAGE_NAME} --avif\`: ${result.error.message}`)
    return
  }
  if (typeof result.status === 'number' && result.status !== 0) {
    console.log(`  ⚠️  \`npx ${MINIFY_PACKAGE_NAME} --avif\` завершився з кодом ${result.status}`)
  }
}

/** @type {import('../../../scripts/lib/lint-surface/types.mjs').T0Pattern[]} */
export const patterns = [
  {
    id: 'image-avif-generation',
    test: violations => violations.some(v => TRIGGER_REASONS.has(v.reason)),
    apply: async (violations, ctx) => {
      const cwd = ctx.cwd
      // Генерація може створити `.avif`, яких бракувало → rescan бачить їх як rewrite.
      runAvifGeneration(cwd)
      const scan = await scanAvif(cwd)
      if (scan.skipped) return { touchedFiles: [] }

      const touchedFiles = []
      for (const r of scan.rewrites) {
        ctx.recordWrite?.(r.file)
        await writeFile(r.file, r.content, 'utf8')
        touchedFiles.push(r.file)
      }
      for (const orphan of scan.orphans) {
        ctx.recordWrite?.(orphan)
        await unlink(orphan)
        touchedFiles.push(orphan)
      }
      if (touchedFiles.length === 0) return { touchedFiles: [] }
      return {
        touchedFiles,
        message: `AVIF: rewrote ${scan.rewrites.length} file(s), deleted ${scan.orphans.length} orphan(s)`
      }
    }
  }
]
