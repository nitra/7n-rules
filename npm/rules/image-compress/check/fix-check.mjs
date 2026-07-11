/**
 * T0-autofix для `image-compress/check` — стиснення image-файлів через
 * `npx \@nitra/minify-image --src=. --write` (best-effort, mtime/tsv-cache вирішує ідемпотентність).
 * Detector лише ЗВІТУЄ `needsCompression` (read-only contract); мутація — тут, до LLM-ladder:
 * стиснення — бінарна трансформація, не текстовий diff, тож LLM-фікс тут апріорі недоречний.
 */
import { spawnSync } from 'node:child_process'
import { env } from 'node:process'

import { resolveCmd } from '../../../scripts/utils/resolve-cmd.mjs'

const MINIFY_PACKAGE_NAME = '@nitra/minify-image'
const JSON_MAX_BUFFER = 20 * 1024 * 1024

/**
 * Запускає `npx \@nitra/minify-image --src=. --write` і повертає стиснуті файли з `--json`-звіту.
 * Best-effort: відсутній npx / помилка / ненульовий код — лог-варн без падіння (re-detect
 * наступного кроку покаже справжній стан).
 * @param {string} cwd корінь репозиторію
 * @returns {string[]} абсолютні шляхи стиснутих файлів (порожньо при помилці/no-op)
 */
function runCompression(cwd) {
  const npxPath = resolveCmd('npx')
  if (!npxPath) {
    console.log(`  ⚠️  'npx' не знайдено в PATH — пропускаємо стиснення зображень`)
    return []
  }

  const writeResult = spawnSync(npxPath, [MINIFY_PACKAGE_NAME, '--src=.', '--write'], {
    cwd,
    encoding: 'utf8',
    env,
    maxBuffer: JSON_MAX_BUFFER
  })
  if (writeResult.error) {
    console.log(`  ⚠️  не вдалося запустити \`npx ${MINIFY_PACKAGE_NAME} --write\`: ${writeResult.error.message}`)
    return []
  }
  if (typeof writeResult.status === 'number' && writeResult.status !== 0) {
    console.log(`  ⚠️  \`npx ${MINIFY_PACKAGE_NAME} --write\` завершився з кодом ${writeResult.status}`)
    return []
  }

  const jsonResult = spawnSync(npxPath, [MINIFY_PACKAGE_NAME, '--src=.', '--json'], {
    cwd,
    encoding: 'utf8',
    env,
    maxBuffer: JSON_MAX_BUFFER
  })
  if (jsonResult.error || jsonResult.status !== 0) return []

  try {
    const report = JSON.parse(jsonResult.stdout)
    const files = Array.isArray(report.compressed) ? report.compressed : []
    return files.filter(f => typeof f === 'string')
  } catch {
    return []
  }
}

/** @type {import('../../../scripts/lib/lint-surface/types.mjs').T0Pattern[]} */
export const patterns = [
  {
    id: 'image-compress-write',
    test: violations => violations.some(v => v.reason === 'needs-compression'),
    apply: (violations, ctx) => {
      const compressed = runCompression(ctx.cwd)
      if (compressed.length === 0) return { touchedFiles: [] }

      for (const absPath of compressed) ctx.recordWrite?.(absPath)
      return { touchedFiles: compressed, message: `image-compress: ${compressed.length} файл(ів) стиснуто` }
    }
  }
]
