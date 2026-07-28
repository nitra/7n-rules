/**
 * T0-autofix для `image-compress/check` — стиснення image-файлів через
 * `bunx \@nitra/minify-image --src=. --write` (best-effort, mtime/tsv-cache вирішує ідемпотентність).
 * `bunx`, не `npx`: пакет v4 використовує `Bun.Image` (bun-only global), під Node мовчки
 * нічого не стискає — той самий фікс, що вже застосований у read-only детекторі `main.mjs`.
 * Detector лише ЗВІТУЄ `needsCompression` (read-only contract); мутація — тут, до LLM-ladder:
 * стиснення — бінарна трансформація, не текстовий diff, тож LLM-фікс тут апріорі недоречний.
 */
import { env } from 'node:process'

import { resolveCmd } from '../../../scripts/utils/resolve-cmd.mjs'
import { spawnAsync } from '../../../scripts/utils/spawn-async.mjs'

const MINIFY_PACKAGE_NAME = '@nitra/minify-image'
const JSON_MAX_BUFFER = 20 * 1024 * 1024

/**
 * Запускає `bunx \@nitra/minify-image --src=. --write` і повертає стиснуті файли з `--json`-звіту.
 * Best-effort: відсутній bunx / помилка / ненульовий код — лог-варн без падіння (re-detect
 * наступного кроку покаже справжній стан).
 * @param {string} cwd корінь репозиторію
 * @returns {Promise<string[]>} абсолютні шляхи стиснутих файлів (порожньо при помилці/no-op)
 */
async function runCompression(cwd) {
  const bunxPath = resolveCmd('bunx')
  if (!bunxPath) {
    console.log(`  ⚠️  'bunx' не знайдено в PATH — пропускаємо стиснення зображень`)
    return []
  }

  let writeResult
  try {
    writeResult = await spawnAsync(bunxPath, [MINIFY_PACKAGE_NAME, '--src=.', '--write'], {
      cwd,
      env,
      maxBuffer: JSON_MAX_BUFFER
    })
  } catch (error) {
    console.log(`  ⚠️  не вдалося запустити \`bunx ${MINIFY_PACKAGE_NAME} --write\`: ${error.message}`)
    return []
  }
  if (typeof writeResult.exitCode === 'number' && writeResult.exitCode !== 0) {
    console.log(`  ⚠️  \`bunx ${MINIFY_PACKAGE_NAME} --write\` завершився з кодом ${writeResult.exitCode}`)
    return []
  }

  let jsonResult
  try {
    jsonResult = await spawnAsync(bunxPath, [MINIFY_PACKAGE_NAME, '--src=.', '--json'], {
      cwd,
      env,
      maxBuffer: JSON_MAX_BUFFER
    })
  } catch {
    return []
  }
  if (jsonResult.exitCode !== 0) return []

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
    apply: async (violations, ctx) => {
      const compressed = await runCompression(ctx.cwd)
      if (compressed.length === 0) return { touchedFiles: [] }

      for (const absPath of compressed) ctx.recordWrite?.(absPath)
      return { touchedFiles: compressed, message: `image-compress: ${compressed.length} файл(ів) стиснуто` }
    }
  }
]
