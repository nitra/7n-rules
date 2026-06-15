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
import { readFileSync, mkdirSync, writeFileSync, existsSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { isRunAsCli } from '../../../scripts/cli-entry.mjs'
import { omlxHealthCheck, pickBackend, classifyOmlxError } from '../../../lib/llm.mjs'
import { generateDoc, DEFAULT_LOCAL_MODEL } from './docgen-gen.mjs'
import { crc32, stampDoc, readDocQuality, readDocModel, QUALITY_THRESHOLD } from './docgen-crc.mjs'
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
export function preflightProblem() {
  if (!DEFAULT_LOCAL_MODEL) {
    return 'модель не задано. Вистав N_LOCAL_MIN_MODEL (напр. omlx/mlx-community--gemma-4-e4b-it-OptiQ-4bit) і повтори.'
  }
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
 * Рядок таймінгу одного файлу: загальний час, час у LLM (і кількість викликів)
 * та залишок — оркестрація (екстракт фактів, скоринг, парсинг, IO). Дає зрозуміти,
 * скільки коштує сама модель проти JS-оркестрації.
 * @param {{ ms: number, llmMs?: number, llmCalls?: number }} r результат generateDoc
 * @returns {string} напр. `12.3s (llm 11.8s/7 calls, orch 0.5s)`
 */
function fmtTiming(r) {
  const s = ms => `${(ms / 1000).toFixed(1)}s`
  const llmMs = r.llmMs ?? 0
  return `${s(r.ms)} (llm ${s(llmMs)}/${r.llmCalls ?? 0} calls, orch ${s(r.ms - llmMs)})`
}

/** Скільки systemic-збоїв підряд → негайний abort батчу (fail-fast, без cooldown). */
const SYSTEMIC_ABORT_STREAK = 3

/**
 * Діагностика розміру джерела (для дослідження, що роздуває контекст):
 * байти + груба оцінка токенів (~bytes/4). Без size-guard-гейта — лише вивід.
 * @param {number} bytes розмір файлу в байтах
 * @returns {string} напр. `12.3KB ~3.1k tok`
 */
function fmtSize(bytes) {
  return `${(bytes / 1024).toFixed(1)}KB ~${(bytes / 4 / 1000).toFixed(1)}k tok`
}

/**
 * Генерує й штампує доку для одного файлу, оновлюючи лічильники й прогрес.
 * Помилку класифікує (`classifyOmlxError`): `permanent` → skip (не «помилка для
 * перегону»), `systemic`/`transient` → у `errors`. Повертає клас для циклу
 * (circuit-breaker рахує systemic-підряд).
 * @param {object} file елемент scanForDocFiles
 * @param {string} root абсолютний корінь
 * @param {{ done: number, total: number }} progress позиція у прогресі
 * @param {{ ok: number, degraded: number, err: number, errors: string[], skipped: string[] }} stats акумулятор
 * @returns {Promise<'ok'|'permanent'|'systemic'|'transient'>} результат для керування циклом
 */
async function generateOne(file, root, progress, stats) {
  const sourceAbs = join(root, file.sourcePath)
  let size = 0
  try {
    size = statSync(sourceAbs).size
  } catch {
    // файл зник між скануванням і генерацією — лишаємо розмір 0
  }
  process.stdout.write(`  [${progress.done}/${progress.total}] ${file.sourcePath} [${fmtSize(size)}] … `)
  try {
    const docAbs = join(root, file.docPath)
    // Варіант B: передаємо наявну доку, щоб зберегти захищену секцію «Призначення»
    const existingMd = existsSync(docAbs) ? readFileSync(docAbs, 'utf8') : null
    const result = await generateDoc(sourceAbs, { existingMd })
    const crc = crc32(readFileSync(sourceAbs))
    mkdirSync(dirname(docAbs), { recursive: true })
    const quality =
      result.score === null ? null : { score: result.score, issues: result.degraded ? result.issues : [] }
    writeFileSync(docAbs, stampDoc(result.md, file.sourcePath, crc, quality, result.model))
    stats.ok++
    if (result.degraded) {
      stats.degraded++
      process.stdout.write(`⚠ degraded score=${result.score} crc=${crc}  ${fmtTiming(result)}\n`)
    } else {
      process.stdout.write(`✓ score=${result.score ?? '—'} crc=${crc}  ${fmtTiming(result)}\n`)
    }
    return 'ok'
  } catch (error) {
    const cls = classifyOmlxError(error.message)
    if (cls === 'permanent') {
      stats.skipped.push(file.sourcePath)
      process.stdout.write(`⊘ skip (permanent): ${error.message}\n`)
    } else {
      stats.err++
      stats.errors.push(file.sourcePath)
      process.stdout.write(`✗ ${cls}: ${error.message}\n`)
    }
    return cls
  }
}

/**
 * Підсумковий звіт прогону у stdout.
 * @param {{ ok: number, degraded: number, err: number, errors: string[], skipped: string[] }} stats статистика
 * @returns {void}
 */
function reportStats(stats) {
  console.log(
    `\n${'─'.repeat(50)}\n✓ OK: ${stats.ok}  ⚠ degraded: ${stats.degraded}  ✗ Err: ${stats.err}  ⊘ Skip: ${stats.skipped.length}`
  )
  if (stats.errors.length > 0) {
    console.log('Помилки:')
    for (const e of stats.errors) console.log(`  - ${e}`)
  }
  if (stats.skipped.length > 0) {
    console.log('Пропущено (permanent — завеликий контекст / модель відсутня):')
    for (const e of stats.skipped) console.log(`  - ${e}`)
  }
  if (stats.degraded > 0) {
    console.log(`Degraded-доки перегенеровуються пізніше: npx @nitra/cursor fix-doc-files --retry-degraded`)
  }
}

/**
 * `doc-files gen` — згенерувати документацію для застарілих/відсутніх док.
 * @param {string[]} argv аргументи після назви субкоманди
 * @returns {Promise<number>} exit-код: 0 — без помилок; 1 — помилки/фейл preflight; 2 — systemic-abort
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

  return runGenerationBatch(targets, root, {
    headline: `📋 doc-files: до генерації ${targets.length} файл(ів)${modeSuffix({ overwrite, retryDegraded })}`
  })
}

/**
 * Спільне ядро генерації: preflight локального бекенда → послідовний прогін
 * `targets` через `generateOne` з circuit-breaker'ом (K systemic-збоїв підряд →
 * abort) → підсумковий звіт. Перевикористовують і батч-CLI (`runDocFilesGenCli`),
 * і opportunistic lint-крок doc-files (scoped-набір змінених файлів).
 * @param {Array<object>} targets елементи scanForDocFiles (sourcePath/docPath)
 * @param {string} root абсолютний корінь
 * @param {{ headline?: string }} [opts] headline — рядок-шапка прогону у stdout
 * @returns {Promise<number>} 0 — без помилок; 1 — фейл preflight або є помилки; 2 — systemic-abort
 */
export async function runGenerationBatch(targets, root, { headline } = {}) {
  const problem = preflightProblem()
  if (problem) {
    console.error(`✗ fix-doc-files: ${problem}`)
    return 1
  }

  if (headline) console.log(headline)
  const stats = { ok: 0, degraded: 0, err: 0, errors: [], skipped: [] }

  let done = 0
  let systemicStreak = 0
  let aborted = false
  for (const file of targets) {
    done++
    const status = await generateOne(file, root, { done, total: targets.length }, stats)
    // Circuit-breaker: K systemic-збоїв підряд → негайний abort (середовище впало,
    // решта файлів так само згорить). Будь-який не-systemic результат скидає лічильник.
    if (status === 'systemic') {
      if (++systemicStreak >= SYSTEMIC_ABORT_STREAK) {
        aborted = true
        console.error(
          `\n✗ doc-files: ${SYSTEMIC_ABORT_STREAK} systemic-збої підряд (omlx memory-guard / сервер) — abort на ${done}/${targets.length}.\n  Звільни RAM або перезапусти omlx і повтори — зроблене лишилось, решта підбереться за CRC.`
        )
        break
      }
    } else {
      systemicStreak = 0
    }
  }

  reportStats(stats)
  if (aborted) return 2
  return stats.err > 0 ? 1 : 0
}

/**
 * `doc-files stamp` — детерміновано (пере)штампувати frontmatter `source`+`crc`
 * у НАЯВНИХ доках без виклику LLM. Для міграції док, які ще не мають CRC.
 * Поля `model` та якості (`score`/`issues`) при цьому зберігаються з наявного frontmatter.
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
    const model = readDocModel(docAbs)
    writeFileSync(docAbs, stampDoc(md, file.sourcePath, crc, score === null ? null : { score, issues }, model))
    stamped++
  }
  console.log(`✓ fix-doc-files --stamp: оновлено frontmatter у ${stamped} доці(ах).`)
  return 0
}

if (isRunAsCli(import.meta.url)) {
  const [sub, ...rest] = process.argv.slice(2)
  const argv = sub === 'gen' || sub === 'stamp' ? rest : process.argv.slice(2)
  process.exitCode = sub === 'stamp' ? runDocFilesStampCli(argv) : await runDocFilesGenCli(argv)
}
