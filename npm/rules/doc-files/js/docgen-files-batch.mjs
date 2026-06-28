/** @see ./docs/docgen-files-batch.md */
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmdirSync,
  statSync,
  unlinkSync,
  writeFileSync
} from 'node:fs'
import { spawnSync } from 'node:child_process'
import { basename, dirname, join, relative } from 'node:path'

import { isRunAsCli } from '../../../scripts/cli-entry.mjs'
import { generateDoc, DEFAULT_LOCAL_MODEL } from './docgen-gen.mjs'

/**
 * Класифікує помилку генерації для batch-логіки (замінює `classifyOmlxError` після
 * pi-міграції — помилки приходять як винятки з generateDoc/pi-one-shot):
 *   - `permanent` — pre-send guard «Prompt too long» → skip (не ретраїти);
 *   - `systemic`  — модель/сервер/registry/RAM упали → circuit-breaker abort;
 *   - `transient` — таймаут (можна було б ретраїти);
 *   - `infra`     — інше (рахуємо як помилку, але без abort).
 * @param {string} msg повідомлення помилки
 * @returns {'permanent'|'systemic'|'transient'|'infra'} клас
 */
function classifyDocgenError(msg) {
  if (/prompt too long|pre-send guard|too long/i.test(msg)) return 'permanent'
  if (/registry:|session:|не знайдена|memory|enomem|connection refused|econnrefused/i.test(msg)) return 'systemic'
  if (/timeout|etimedout/i.test(msg)) return 'transient'
  return 'infra'
}
import { crc32, stampDoc, readDocQuality, readDocModel, QUALITY_THRESHOLD } from './docgen-crc.mjs'
import { resolveRoot, scanForDocFiles, scanOrphanedDocs } from './docgen-scan.mjs'

/**
 * Парсить `--limit N` / `--from N` / прапори режимів для дозапуску великого прогону.
 * @param {string[]} argv аргументи
 * @returns {{ from: number, limit: number, overwrite: boolean }} зріз і режими
 */
function parseGenArgs(argv) {
  const num = (flag, dflt) => {
    const i = argv.indexOf(flag)
    return i !== -1 && argv[i + 1] ? Number(argv[i + 1]) || dflt : dflt
  }
  return {
    from: num('--from', 0),
    limit: num('--limit', Infinity),
    overwrite: argv.includes('--overwrite')
  }
}

/**
 * Цілі генерації:
 *   - default      → застарілі (stale) АБО degraded-доки, які ще не доретраювали при цьому CRC;
 *   - `--overwrite` → усі.
 * Degraded-док отримує рівно ОДИН доретрай на версію джерела: після невдалого доретраю
 * (лишився degraded) штампується `retried: true` і його більше не чіпають до зміни джерела
 * (нова версія → CRC-mismatch → stale → лічильник скидається). Конвеєр сходиться без прапора.
 * @param {string} root абсолютний корінь
 * @param {Array<object>} all результат scanForDocFiles
 * @param {{ overwrite: boolean }} mode режими
 * @returns {Array<object>} відфільтровані цілі
 */
export function selectTargets(root, all, { overwrite }) {
  if (overwrite) return all
  return all.filter(f => {
    if (f.stale) return true
    const { score, retried } = readDocQuality(join(root, f.docPath))
    return score !== null && score < QUALITY_THRESHOLD && !retried
  })
}

/**
 * Текст-суфікс режиму для прогрес-рядка.
 * @param {{ overwrite: boolean }} mode режими
 * @returns {string} ` (--overwrite)` або порожній рядок
 */
function modeSuffix({ overwrite }) {
  return overwrite ? ' (--overwrite)' : ''
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
    // retried: НЕ stale (отже це доретрай при тому ж CRC) і лишився degraded → штампуємо,
    // щоб наступні `gen` його не чіпали до зміни джерела (сходимість без прапора).
    const retried = !file.stale && result.degraded
    const quality =
      result.score === null
        ? null
        : { score: result.score, issues: result.degraded ? result.issues : [], retried, judge: result.judge }
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
    const cls = classifyDocgenError(error.message)
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

/** Regex для витягу OKF-полів із frontmatter існуючої доки (швидкий, без YAML-парсера). */
const OKF_TITLE_RE = /^title: (.+)$/mu
const OKF_TYPE_RE = /^type: (.+)$/mu
const OKF_FRONTMATTER_RE = /^---\n([\s\S]*?)\n---\n?/u
const OKF_RESOURCE_RE = /^resource:[ \t]+(.+)$/mu

/**
 * Генерує/оновлює `index.md` у директорії `docs/` — OKF Directory Index із таблицею
 * всіх наявних doc-файлів у цій директорії. Не зачіпає `index.md` при відсутності
 * інших doc-файлів.
 * @param {string} docsAbsDir абсолютний шлях директорії `docs/`
 * @param {string} root абсолютний корінь проєкту
 * @returns {void}
 */
function generateDirIndex(docsAbsDir, root) {
  const allMd = readdirSync(docsAbsDir)
    .filter(f => f.endsWith('.md'))
    .sort()

  // Якщо index.md вже є дока для source-файлу (має docgen.source → index.*) — не чіпаємо
  if (allMd.includes('index.md')) {
    const existingFm = readFileSync(join(docsAbsDir, 'index.md'), 'utf8').match(OKF_FRONTMATTER_RE)?.[1] ?? ''
    const existingSource = existingFm.match(OKF_RESOURCE_RE)?.[1]?.trim() ?? ''
    const existingType = existingFm.match(OKF_TYPE_RE)?.[1]?.trim() ?? ''
    // Пропускаємо якщо це дока source-файлу, а не Directory Index
    if (existingSource && existingType !== 'Directory Index') return
  }

  const files = allMd.filter(f => f !== 'index.md')
  if (files.length === 0) return

  const sourceDirRel = relative(root, dirname(docsAbsDir)) || '.'

  const rows = files.map(f => {
    const md = readFileSync(join(docsAbsDir, f), 'utf8')
    const fm = md.match(OKF_FRONTMATTER_RE)?.[1] ?? ''
    const resource = fm.match(OKF_RESOURCE_RE)?.[1]?.trim()
    const title = fm.match(OKF_TITLE_RE)?.[1]?.trim() ?? (resource ? basename(resource) : f.replace(/\.md$/, ''))
    const type = fm.match(OKF_TYPE_RE)?.[1]?.trim() ?? 'Source File'
    return `| [${title}](${f}) | ${type} |`
  })

  const content = `---
type: Directory Index
title: ${sourceDirRel}
resource: ${sourceDirRel}/
---

# ${sourceDirRel}

| Файл | Тип |
|---|---|
${rows.join('\n')}
`
  const indexPath = join(docsAbsDir, 'index.md')
  writeFileSync(indexPath, content)
  spawnSync('oxfmt', [indexPath], { stdio: 'ignore' })
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
    console.log('Degraded-доки автоматично доретраюються наступним `gen` (один раз на версію джерела).')
  }
}

/**
 * Видаляє сирітські доки (source-файл не існує) і оновлює/прибирає index.md.
 * Якщо після видалення в docs/-директорії лишились тільки index.md або нічого — очищує її.
 * @param {string} root абсолютний корінь
 * @returns {number} кількість видалених doc-файлів
 */
export function purgeOrphanedDocs(root) {
  const orphans = scanOrphanedDocs(root)
  if (orphans.length === 0) return 0
  let deleted = 0
  const docsDirs = new Set()
  for (const docRel of orphans) {
    try {
      unlinkSync(join(root, docRel))
      docsDirs.add(dirname(join(root, docRel)))
      deleted++
    } catch {
      // race condition або вже видалено — ігноруємо
    }
  }
  for (const docsAbsDir of docsDirs) {
    if (!existsSync(docsAbsDir)) continue
    const remaining = readdirSync(docsAbsDir)
    const docFiles = remaining.filter(f => f.endsWith('.md') && f !== 'index.md')
    if (docFiles.length === 0) {
      // Лише index.md або порожня директорія — прибираємо повністю
      const indexPath = join(docsAbsDir, 'index.md')
      if (existsSync(indexPath)) unlinkSync(indexPath)
      try {
        rmdirSync(docsAbsDir)
      } catch {
        /* не порожня — пропускаємо */
      }
    } else {
      generateDirIndex(docsAbsDir, root)
    }
  }
  return deleted
}

/**
 * `doc-files gen` — згенерувати документацію для застарілих/відсутніх док.
 * @param {string[]} argv аргументи після назви субкоманди
 * @returns {Promise<number>} exit-код: 0 — без помилок; 1 — помилки/фейл preflight; 2 — systemic-abort
 */
export async function runDocFilesGenCli(argv) {
  const root = resolveRoot(argv)
  const { from, limit, overwrite } = parseGenArgs(argv)

  // Видаляємо orphan-доки до генерації (незалежно від наявності stale)
  const deleted = purgeOrphanedDocs(root)
  if (deleted > 0) {
    console.log(`🗑 doc-files: видалено ${deleted} сирітських доки(ів)`)
  }

  const all = scanForDocFiles(root)
  const targets = selectTargets(root, all, { overwrite }).slice(from, from + limit)

  if (targets.length === 0) {
    if (deleted === 0) {
      console.log('✓ doc-files: усі файлові доки свіжі й не-degraded. Нічого генерувати.')
    }
    return 0
  }

  return runGenerationBatch(targets, root, {
    headline: `📋 doc-files: до генерації ${targets.length} файл(ів)${modeSuffix({ overwrite })}`
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
  if (!DEFAULT_LOCAL_MODEL) {
    console.error('✗ fix-doc-files: локальну модель не задано (N_LOCAL_MIN_MODEL)')
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

  // Оновлюємо index.md у кожній docs/-директорії, якої торкнувся цей батч
  const docsDirs = new Set(targets.map(f => dirname(join(root, f.docPath))))
  for (const docsAbsDir of docsDirs) {
    if (existsSync(docsAbsDir)) generateDirIndex(docsAbsDir, root)
  }

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

  // Після stamp — оновити index.md у всіх docs/-директоріях
  const docsDirs = new Set(
    scanForDocFiles(root)
      .map(f => dirname(join(root, f.docPath)))
      .filter(d => existsSync(d))
  )
  for (const docsAbsDir of docsDirs) generateDirIndex(docsAbsDir, root)

  return 0
}

if (isRunAsCli(import.meta.url)) {
  const [sub, ...rest] = process.argv.slice(2)
  const argv = sub === 'gen' || sub === 'stamp' ? rest : process.argv.slice(2)
  process.exitCode = sub === 'stamp' ? runDocFilesStampCli(argv) : await runDocFilesGenCli(argv)
}
