/**
 * JS-оркестрація генерації файлових док (local-only, ADR 260610-2228).
 *
 * Уся черга/батчинг/CRC-штамп живуть тут, а не в контексті моделі — тому
 * масовий перший прогін на сотні файлів не «заморює» агента. Конвеєр суто
 * локальний: жодних cloud-ескалацій; якщо det-score нижче порогу — дока все
 * одно пишеться з degraded-маркером (`score`/`issues` у frontmatter), а
 * `gen --retry-degraded` адресно переганяє лише такі доки пізніше.
 *
 * Перед масовим прогоном — health-check omlx: memory-guard зайнятої 8GB машини
 * означає «відклади прогін», а не сотні хибних «✗» у звіті.
 */
import { readFileSync, mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { isRunAsCli } from '../../../scripts/cli-entry.mjs'
import { omlxHealthCheck, pickBackend } from '../../../lib/llm.mjs'
import { generateDoc, DEFAULT_LOCAL_MODEL } from './docgen-gen.mjs'
import { crc32, stampDoc, readDocQuality, QUALITY_THRESHOLD } from './docgen-crc.mjs'
import { resolveRoot, scanForDocFiles } from './docgen-scan.mjs'

/**
 * Парсить `--limit N` / `--from N` / прапори режимів для дозапуску великого прогону.
 * @param {string[]} argv аргументи
 * @returns {{ from: number, limit: number, overwrite: boolean, retryDegraded: boolean }} зріз і режими
 */
function parseGenArgs(argv) {
  const num = (flag, dflt) => {
    const i = argv.indexOf(flag)
    return i !== -1 && argv[i + 1] ? Number(argv[i + 1]) || dflt : dflt
  }
  return {
    from: num('--from', 0),
    limit: num('--limit', Infinity),
    overwrite: argv.includes('--overwrite'),
    retryDegraded: argv.includes('--retry-degraded')
  }
}

/**
 * Цілі генерації за режимом:
 *   - default          → застарілі (stale);
 *   - `--overwrite`     → усі;
 *   - `--retry-degraded` → свіжі за CRC, але зі `score < QUALITY_THRESHOLD`.
 * @param {string} root абсолютний корінь
 * @param {Array<object>} all результат scanForDocFiles
 * @param {{ overwrite: boolean, retryDegraded: boolean }} mode режими
 * @returns {Array<object>} відфільтровані цілі
 */
function selectTargets(root, all, { overwrite, retryDegraded }) {
  if (retryDegraded) {
    return all.filter(f => {
      if (f.stale) return false
      const { score } = readDocQuality(join(root, f.docPath))
      return score !== null && score < QUALITY_THRESHOLD
    })
  }
  if (overwrite) return all
  return all.filter(f => f.stale)
}

/**
 * Preflight локального бекенда: для omlx-моделі — мінімальний chat-виклик.
 * @returns {string|null} текст фатальної проблеми або null якщо можна генерувати
 */
function preflightProblem() {
  if (pickBackend(DEFAULT_LOCAL_MODEL) !== 'omlx') return null
  const hc = omlxHealthCheck({ model: DEFAULT_LOCAL_MODEL })
  if (hc.ok) return null
  if (hc.reason === 'memory-guard') {
    return `omlx memory-guard: модель не влазить у динамічну стелю пам'яті (машина зайнята).\n  Звільни пам'ять або повтори прогін пізніше.\n  ${hc.detail}`
  }
  if (hc.reason === 'down') {
    return `omlx-сервер не відповідає. Запусти \`omlx serve\` і повтори.\n  ${hc.detail}`
  }
  if (hc.reason === 'auth') {
    return `omlx вимагає API-ключ. Вистав N_CURSOR_OMLX_KEY (auth.api_key з ~/.omlx/settings.json).\n  ${hc.detail}`
  }
  return `omlx помилка: ${hc.detail}`
}

/**
 * Текст-суфікс режиму для прогрес-рядка.
 * @param {{ overwrite: boolean, retryDegraded: boolean }} mode режими
 * @returns {string} ` (--overwrite)` / ` (--retry-degraded)` / порожній рядок
 */
function modeSuffix({ overwrite, retryDegraded }) {
  if (overwrite) return ' (--overwrite)'
  if (retryDegraded) return ' (--retry-degraded)'
  return ''
}

/**
 * Генерує й штампує доку для одного файлу, оновлюючи лічильники й прогрес.
 * @param {object} file елемент scanForDocFiles
 * @param {string} root абсолютний корінь
 * @param {{ done: number, total: number }} progress позиція у прогресі
 * @param {{ ok: number, degraded: number, err: number, errors: string[] }} stats акумулятор статистики
 * @returns {Promise<void>}
 */
async function generateOne(file, root, progress, stats) {
  const sourceAbs = join(root, file.sourcePath)
  process.stdout.write(`  [${progress.done}/${progress.total}] ${file.sourcePath} … `)
  try {
    const docAbs = join(root, file.docPath)
    // Варіант B: передаємо наявну доку, щоб зберегти захищену секцію «Призначення»
    const existingMd = existsSync(docAbs) ? readFileSync(docAbs, 'utf8') : null
    const result = await generateDoc(sourceAbs, { existingMd })
    const crc = crc32(readFileSync(sourceAbs))
    mkdirSync(dirname(docAbs), { recursive: true })
    const quality =
      result.score === null ? null : { score: result.score, issues: result.degraded ? result.issues : [] }
    writeFileSync(docAbs, stampDoc(result.md, file.sourcePath, crc, quality))
    stats.ok++
    if (result.degraded) {
      stats.degraded++
      process.stdout.write(`⚠ degraded score=${result.score} crc=${crc}\n`)
    } else {
      process.stdout.write(`✓ score=${result.score ?? '—'} crc=${crc}\n`)
    }
  } catch (error) {
    stats.err++
    stats.errors.push(file.sourcePath)
    process.stdout.write(`✗ ${error.message}\n`)
  }
}

/**
 * Підсумковий звіт прогону у stdout.
 * @param {{ ok: number, degraded: number, err: number, errors: string[] }} stats статистика
 * @returns {void}
 */
function reportStats(stats) {
  console.log(`\n${'─'.repeat(50)}\n✓ OK: ${stats.ok}  ⚠ degraded: ${stats.degraded}  ✗ Err: ${stats.err}`)
  if (stats.errors.length > 0) {
    console.log('Помилки:')
    for (const e of stats.errors) console.log(`  - ${e}`)
  }
  if (stats.degraded > 0) {
    console.log(`Degraded-доки перегенеровуються пізніше: npx @nitra/cursor doc-files gen --retry-degraded`)
  }
}

/**
 * `doc-files gen` — згенерувати документацію для застарілих/відсутніх док.
 * @param {string[]} argv аргументи після назви субкоманди
 * @returns {Promise<number>} exit-код: 0 — без помилок, 1 — хоча б одна помилка або фейл preflight
 */
export async function runDocFilesGenCli(argv) {
  const root = resolveRoot(argv)
  const { from, limit, overwrite, retryDegraded } = parseGenArgs(argv)

  const all = scanForDocFiles(root)
  const targets = selectTargets(root, all, { overwrite, retryDegraded }).slice(from, from + limit)

  if (targets.length === 0) {
    console.log(
      retryDegraded
        ? '✓ doc-files: degraded-док немає. Нічого переганяти.'
        : '✓ doc-files: усі файлові доки свіжі. Нічого генерувати.'
    )
    return 0
  }

  const problem = preflightProblem()
  if (problem) {
    console.error(`✗ doc-files gen: ${problem}`)
    return 1
  }

  console.log(`📋 doc-files: до генерації ${targets.length} файл(ів)${modeSuffix({ overwrite, retryDegraded })}`)
  const stats = { ok: 0, degraded: 0, err: 0, errors: [] }

  let done = 0
  for (const file of targets) {
    done++
    await generateOne(file, root, { done, total: targets.length }, stats)
  }

  reportStats(stats)
  return stats.err > 0 ? 1 : 0
}

/**
 * `doc-files stamp` — детерміновано (пере)штампувати frontmatter `source`+`crc`
 * у НАЯВНИХ доках без виклику LLM. Для міграції док, які ще не мають CRC.
 * Поля якості (`score`/`issues`) при цьому зберігаються з наявного frontmatter.
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
    const md = readFileSync(docAbs, 'utf8')
    const { score, issues } = readDocQuality(docAbs)
    writeFileSync(docAbs, stampDoc(md, file.sourcePath, crc, score === null ? null : { score, issues }))
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
