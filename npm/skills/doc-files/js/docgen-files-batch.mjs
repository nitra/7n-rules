/**
 * JS-оркестрація генерації файлових док (Tier 1).
 *
 * Уся черга/батчинг/роутинг/CRC-штамп живуть тут, а не в контексті моделі — тому
 * масовий перший прогін на сотні файлів не «заморює» агента. `generateDoc` сам
 * маршрутизує файл за складністю: прості (sym<threshold) → локальна модель,
 * складні → cloud-модель. Після генерації JS детерміновано штампує frontmatter
 * `source`+`crc`, тож наступний `doc-files check` бачить доку свіжою.
 */
import { readFileSync, mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { isRunAsCli } from '../../../scripts/cli-entry.mjs'
import { generateDoc } from './docgen-gen.mjs'
import { crc32, stampDoc } from './docgen-crc.mjs'
import { resolveRoot, scanForDocFiles } from './docgen-scan.mjs'

/**
 * Парсить `--limit N` / `--from N` для дозапуску великого прогону.
 * @param {string[]} argv аргументи
 * @returns {{ from: number, limit: number, overwrite: boolean }} зріз і прапор перегенерації
 */
function parseGenArgs(argv) {
  const num = (flag, dflt) => {
    const i = argv.indexOf(flag)
    return i !== -1 && argv[i + 1] ? Number(argv[i + 1]) || dflt : dflt
  }
  return { from: num('--from', 0), limit: num('--limit', Infinity), overwrite: argv.includes('--overwrite') }
}

/**
 * `doc-files gen` — згенерувати документацію для застарілих/відсутніх файлів.
 * @param {string[]} argv аргументи після назви субкоманди
 * @returns {Promise<number>} exit-код: 0 — без помилок, 1 — хоча б одна помилка
 */
export async function runDocFilesGenCli(argv) {
  const root = resolveRoot(argv)
  const { from, limit, overwrite } = parseGenArgs(argv)

  const all = scanForDocFiles(root)
  const targets = (overwrite ? all : all.filter(f => f.stale)).slice(from, from + limit)

  if (targets.length === 0) {
    console.log('✓ doc-files: усі файлові доки свіжі. Нічого генерувати.')
    return 0
  }

  console.log(`📋 doc-files: до генерації ${targets.length} файл(ів)${overwrite ? ' (--overwrite)' : ''}`)
  const stats = { ok: 0, err: 0, errors: [] }

  let done = 0
  for (const file of targets) {
    done++
    const sourceAbs = join(root, file.sourcePath)
    process.stdout.write(`  [${done}/${targets.length}] ${file.sourcePath} … `)
    try {
      const result = await generateDoc(sourceAbs)
      const crc = crc32(readFileSync(sourceAbs))
      const docAbs = join(root, file.docPath)
      mkdirSync(dirname(docAbs), { recursive: true })
      writeFileSync(docAbs, stampDoc(result.md, file.sourcePath, crc))
      stats.ok++
      process.stdout.write(`✓ tier${result.tier} crc=${crc}\n`)
    } catch (error) {
      stats.err++
      stats.errors.push(file.sourcePath)
      process.stdout.write(`✗ ${error.message}\n`)
    }
  }

  console.log(`\n${'─'.repeat(50)}\n✓ OK: ${stats.ok}  ✗ Err: ${stats.err}`)
  if (stats.errors.length > 0) {
    console.log('Помилки:')
    for (const e of stats.errors) console.log(`  - ${e}`)
  }
  return stats.err > 0 ? 1 : 0
}

/**
 * `doc-files stamp` — детерміновано (пере)штампувати frontmatter `source`+`crc`
 * у НАЯВНИХ доках без виклику LLM. Для міграції док, які ще не мають CRC.
 * @param {string[]} argv аргументи після назви субкоманди
 * @returns {number} exit-код: 0 — успіх
 */
export function runDocFilesStampCli(argv) {
  const root = resolveRoot(argv)
  let stamped = 0
  for (const file of scanForDocFiles(root)) {
    const docAbs = join(root, file.docPath)
    if (!existsSync(docAbs)) continue
    const sourceAbs = join(root, file.sourcePath)
    const crc = crc32(readFileSync(sourceAbs))
    writeFileSync(docAbs, stampDoc(readFileSync(docAbs, 'utf8'), file.sourcePath, crc))
    stamped++
  }
  console.log(`✓ doc-files stamp: оновлено frontmatter у ${stamped} доці(ах).`)
  return 0
}

if (isRunAsCli(import.meta.url)) {
  const [sub, ...rest] = process.argv.slice(2)
  const argv = sub === 'gen' || sub === 'stamp' ? rest : process.argv.slice(2)
  process.exitCode = sub === 'stamp' ? runDocFilesStampCli(argv) : await runDocFilesGenCli(argv)
}
