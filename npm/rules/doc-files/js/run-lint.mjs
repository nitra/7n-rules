/**
 * CLI-обгортка канонічного `lint-doc-files` (doc-files.mdc): детермінований детектор
 * застарілості файлових док (`<dir>/docs/<stem>.md`) — 0 викликів LLM, працює будь-де.
 *
 * Режими (мапа команд у doc-files.mdc / спеці 2026-06-12):
 *  - (без прапорців) / `[paths…]` — повний або точковий детект; **exit 1**, якщо є stale.
 *  - `--missing-only`             — звужує до `missing` (без `crc-mismatch`); exit 1.
 *  - `--json`                     — JSON-лістинг усіх кандидатів зі станом (= старий `scan`); exit 0.
 *  - `--hook` / `--git` / `--degraded` — делегат у `runDocFilesCheckCli` (hook-протокол: exit 2/0).
 *
 * Серіалізація: повний прогін — через `runStandardLint` (ключ `lint-doc-files`,
 * виводиться зі шляху каталогу). Hook/git/degraded форми — **без локу** (швидкі точкові
 * перевірки в hook-протоколі потребують завжди-свіжого вердикту) — канон scripts.mdc.
 */
import { existsSync, statSync } from 'node:fs'
import { join, relative, resolve, sep, isAbsolute } from 'node:path'

import { isRunAsCli } from '../../../scripts/cli-entry.mjs'
import { runStandardLint } from '../../../scripts/lib/run-standard-lint.mjs'
import {
  describeFile,
  isDocCandidate,
  resolveRoot,
  runDocFilesCheckCli,
  runDocFilesScanCli,
  scanForDocFiles,
  scanOrphanedDocs
} from './docgen-scan.mjs'

/**
 * Нормалізує шлях-кандидат до posix-шляху від кореня (null поза деревом).
 * @param {string} root абсолютний корінь
 * @param {string} candidate шлях-кандидат
 * @returns {string|null} posix-шлях від кореня або null
 */
function toRelSource(root, candidate) {
  const rel = relative(root, resolve(root, candidate))
  if (rel.startsWith('..') || isAbsolute(rel)) return null
  return rel.split(sep).join('/')
}

/**
 * Витягує позиційні шляхи з argv (не прапорці й не значення `--root`).
 * @param {string[]} argv аргументи
 * @returns {string[]} позиційні шляхи
 */
function positionalPaths(argv) {
  const rootIdx = argv.indexOf('--root')
  const skip = rootIdx !== -1 ? rootIdx + 1 : -1
  return argv.filter((a, i) => !a.startsWith('--') && i !== skip)
}

/**
 * Реальна робота повного / точкового детекту. Exit 1 — є stale, 0 — все свіже.
 * @param {string[]} argv аргументи після назви команди
 * @returns {number} exit-код
 */
export function runLintDocFilesSteps(argv) {
  const root = resolveRoot(argv)
  if (!existsSync(root) || !statSync(root).isDirectory()) {
    console.error(`lint-doc-files: корінь не існує або не є директорією: ${root}`)
    return 1
  }
  const missingOnly = argv.includes('--missing-only')
  const paths = positionalPaths(argv)

  const described = paths.length
    ? paths
        .map(p => toRelSource(root, p))
        .filter(rel => rel && isDocCandidate(root, rel) && existsSync(join(root, rel)))
        .map(rel => describeFile(root, /** @type {string} */ (rel)))
    : scanForDocFiles(root)

  let stale = described.filter(f => f.stale)
  if (missingOnly) stale = stale.filter(f => f.reason === 'missing')

  // Orphan-детект лише при повному скані (без явних шляхів); точковий — не релевантно
  const orphans = paths.length === 0 ? scanOrphanedDocs(root) : []

  let exitCode = 0
  if (stale.length > 0) {
    const list = stale.map(f => `  - ${f.sourcePath} (${f.reason})`).join('\n')
    console.error(
      `✗ doc-files: документація застаріла/відсутня для ${stale.length} файл(ів):\n${list}\n→ перегенеруй: npx @nitra/cursor fix-doc-files`
    )
    exitCode = 1
  }
  if (orphans.length > 0) {
    const list = orphans.map(f => `  - ${f}`).join('\n')
    console.error(
      `✗ doc-files: сирітських доків (source видалено) ${orphans.length}:\n${list}\n→ очисти: npx @nitra/cursor fix-doc-files`
    )
    exitCode = 1
  }
  if (exitCode === 0) {
    console.log('✓ doc-files: усі файлові доки актуальні.')
  }
  return exitCode
}

/**
 * Публічна CLI-форма `lint-doc-files`. Hook/git/degraded — делегат без локу; `--json` —
 * scan; решта — повний/точковий детект під `runStandardLint` (ключ `lint-doc-files`).
 * @param {string[]} [argv] аргументи після назви команди
 * @returns {Promise<number>} exit-код
 */
export function runLintDocFilesCli(argv = process.argv.slice(3)) {
  if (argv.includes('--hook') || argv.includes('--git') || argv.includes('--degraded')) {
    return runDocFilesCheckCli(argv)
  }
  if (argv.includes('--json')) {
    return Promise.resolve(runDocFilesScanCli(argv))
  }
  return runStandardLint(import.meta.dirname, () => runLintDocFilesSteps(argv))
}

if (isRunAsCli(import.meta.url)) {
  process.exitCode = await runLintDocFilesCli(process.argv.slice(2))
}
