/**
 * Fix-шлях survived-мутантів концерну `coverage` правила `test`
 * (\`npx \@7n/rules lint test\`): агентні fix-сесії `runAgentFix`
 * (`\@7n/llm-lib/agent-fix`) пишуть тести, що вбивають вцілілі мутанти Stryker.
 * Агент отримує список мутантів з контекстом (file, line, оригінальний код,
 * вцілілий варіант, тип мутації) і самостійно знаходить/створює test-файли;
 * записи реєструються write-guard-ом через `recordWrite` (central rollback
 * ladder-а). Survived приходять in-memory з violations — читання COVERAGE.md
 * (колишній coverage-fix-extract) померло разом із файлом.
 *
 * Модель: `ctx.model` ladder-а, fallback CLOUD_MAX або N_CURSOR_COVERAGE_FIX_MODEL.
 */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { env } from 'node:process'

// `@7n/llm-lib` — dependency ядра `@7n/rules`, не плагіна: динамічний import
// (top-level await) — той самий патерн, що `rules/js/eslint/fix-worker.mjs`.
const { CLOUD_AVG, CLOUD_MAX } = await import('@7n/llm-lib/model-tiers')

// `||`, не `??`: тир-константи — порожні рядки, коли N_CLOUD_*_MODEL env не задані
// (поза ladder-ом, що завжди передає ctx.model) — падало «модель не знайдена: <порожньо>».
const MODEL = env.N_CURSOR_COVERAGE_FIX_MODEL || CLOUD_MAX || CLOUD_AVG

/**
 * Дефолтна стеля мутантів на один batch (один агентний виклик зі своїм таймаут-вікном).
 * Один величезний промпт на весь проєкт (сотні мутантів) впирався у таймаут агентного
 * виклику — поділ на батчі тримає кожен виклик у розумних часових межах і дозволяє
 * прогресу бути інкрементальним: провал одного batch не блокує решту файлів.
 * Override: `N_CURSOR_COVERAGE_FIX_BATCH_MUTANTS`.
 */
const DEFAULT_BATCH_MUTANT_BUDGET = 40
/**
 * Великий source-файл дробиться на окремі test-generation групи. Їх не
 * пакуємо назад разом: один файл із 82 mutants не повинен знову дати prompt на 40+.
 */
const OVERSIZED_FILE_SUB_BATCH_MUTANTS = 20
const TEST_FILE_RE = /(?:^|\/)[^/]+\.(?:test|spec)\.[^/]+$/

/**
 * @typedef {{line:number, col:number, mutantType:string, original:string, replacement:string}} MutantDetail
 * @typedef {{file:string, mutants:MutantDetail[], exampleTest:{testFile:string,code:string|null}|null, recommendationText:string|null, sourceMutantCount?:number}} SurvivedFileGroup
 */

/**
 * Читає стелю мутантів на batch з env (з дефолтом) для конфігурації на великих проєктах.
 * @returns {number} стеля мутантів на один batch
 */
function resolveBatchBudget() {
  const n = Number(env.N_CURSOR_COVERAGE_FIX_BATCH_MUTANTS)
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_BATCH_MUTANT_BUDGET
}

/**
 * Ділить групи вцілілих мутантів на batches у межах `budget` мутантів сумарно — жадібне
 * пакування у порядку вхідного масиву. Звичайний файл не ріжеться, але source-файл, що
 * сам перевищує budget, ділиться на ізольовані групи по 20 mutants (або менше, якщо
 * budget нижчий). Групи не пакуються назад разом, щоб не відтворити oversized prompt.
 * @param {SurvivedFileGroup[]} survived вцілілі мутанти, згруповані по файлах
 * @param {number} budget стеля мутантів на batch
 * @returns {SurvivedFileGroup[][]} batches (кожен — підмножина `survived`)
 */
export function batchSurvived(survived, budget) {
  const batches = []
  let current = []
  let currentCount = 0
  for (const group of survived) {
    if (group.mutants.length > budget) {
      if (current.length > 0) batches.push(current)
      current = []
      currentCount = 0
      const sourceMutantCount = group.sourceMutantCount ?? group.mutants.length
      const subBatchSize = Math.min(OVERSIZED_FILE_SUB_BATCH_MUTANTS, budget)
      for (let start = 0; start < group.mutants.length; start += subBatchSize) {
        batches.push([{ ...group, mutants: group.mutants.slice(start, start + subBatchSize), sourceMutantCount }])
      }
      continue
    }
    if (current.length > 0 && currentCount + group.mutants.length > budget) {
      batches.push(current)
      current = []
      currentCount = 0
    }
    current.push(group)
    currentCount += group.mutants.length
  }
  if (current.length > 0) batches.push(current)
  return batches
}

/**
 * @typedef {object} FixSurvivedOptions
 * @property {string} [model] "provider/model-id" ladder-а (ctx.model); без нього — MODEL-фолбек
 * @property {string} [tier] поточний rung ladder-а (ctx.tier) — thinking-level і caller-мітка
 * @property {number} [timeoutMs] бюджет часу на ВЕСЬ прогін — кожен batch отримує залишок
 * @property {{requestedMs:number|null,workerDeadlineMs:number|null,effectiveHookTimeoutMs:number|null,survivedBatchesPerRung?:number}} [coverageTimeout]
 *   timeout-и worker-а та policy кількості survived batch-ів на rung
 * @property {(absPath: string) => void} [recordWrite] реєстрація записів агента для central rollback
 * @property {object} [chain] chain handle concern-а — кожен batch стає кроком ланцюжка
 * @property {object} [feedback] structured diagnosis попереднього rung-а
 * @property {typeof import('@7n/llm-lib/agent-fix').runAgentFix} [runAgentFix] інʼєкція для тестів
 */

/**
 * Запускає агентні fix-сесії для написання тестів по вцілілих мутантах — по batches,
 * кожен своїм `runAgentFix`-викликом. Помилка одного batch (напр. timeout) не зупиняє
 * решту: логується з переліком файлів batch (частковий прогрес реєструється через
 * recordWrite — rollback вирішує ladder, не цей модуль), і прогін продовжується.
 * Власних retry-циклів немає — конвергенцію жене ladder ядра повторними rung-ами.
 * @param {SurvivedFileGroup[]} survived вцілілі мутанти, згруповані по файлах
 * @param {string} projectRoot абсолютний шлях до кореня проєкту
 * @param {FixSurvivedOptions} [opts] ctx-поля ladder-а + інʼєкції для тестів
 * @returns {Promise<{fixed: string[], failed: {files: string[], error: string, diagnosis: object}[], deferred: object[], touchedFiles: string[], batches: object[]}>} фактично змінені test-файли, failed/deferred batch-и та діагностика
 */
export async function fixSurvivedMutants(survived, projectRoot, opts = {}) {
  const totalMutants = survived.reduce((s, g) => s + g.mutants.length, 0)
  if (totalMutants === 0) {
    console.log('✓ Всі мутанти вбиті — доповнення тестів не потрібне')
    return { fixed: [], failed: [], deferred: [], touchedFiles: [], batches: [] }
  }

  const runFix = await resolveRunFix(opts)
  const budget = resolveBatchBudget()
  const batches = batchSurvived(survived, budget)
  const deadlineAt = opts.timeoutMs ? Date.now() + opts.timeoutMs : null
  console.log(
    `\n🤖 coverage fix: ${totalMutants} вцілілих мутантів, ${survived.length} файл(ів) → ${batches.length} batch(ів)...\n`
  )

  const fixed = []
  const failed = []
  const deferred = []
  const touchedFiles = []
  const batchDiagnostics = []
  const maxBatches = opts.coverageTimeout?.survivedBatchesPerRung ?? batches.length
  for (const [i, batch] of batches.entries()) {
    const files = batch.map(g => g.file)
    const batchMutants = batch.reduce((s, g) => s + g.mutants.length, 0)
    const oversizedFiles = batch.filter(g => (g.sourceMutantCount ?? g.mutants.length) > budget).map(g => g.file)
    const oversizedSubBatch = batch.some(g => g.sourceMutantCount && g.mutants.length < g.sourceMutantCount)
    if (i >= maxBatches) {
      const deferredBatch = {
        batch: i + 1,
        batchCount: batches.length,
        files,
        mutantCount: batchMutants,
        reason: 'one survived-mutant batch per rung'
      }
      deferred.push(deferredBatch)
      console.log(`  ⏭ batch ${i + 1}/${batches.length} deferred: ${deferredBatch.reason}`)
      continue
    }
    console.log(
      `\n🤖 batch ${i + 1}/${batches.length}: ${files.length} файл(ів), ${batchMutants} мутантів, budget=${budget}, oversizedSourceFile=${oversizedFiles.length > 0}, oversizedSubBatch=${oversizedSubBatch} — ${files.join(', ')}\n`
    )

    const prompt = await buildFixPrompt(batch, projectRoot)
    const requestedTimeoutMs = opts.coverageTimeout?.requestedMs ?? opts.timeoutMs ?? null
    const workerDeadlineMs = opts.coverageTimeout?.workerDeadlineMs ?? null
    const effectiveTimeoutMs = deadlineAt ? Math.max(1000, deadlineAt - Date.now()) : (opts.timeoutMs ?? null)
    const startedAt = Date.now()
    const res = await runFix('test', prompt, projectRoot, {
      model: opts.model || MODEL,
      tier: opts.tier,
      timeoutMs: effectiveTimeoutMs ?? undefined,
      feedback: opts.feedback ?? null,
      caller: `fix:test/coverage:${opts.tier ?? 'mutants'}:batch${i + 1}`,
      recordWrite: opts.recordWrite,
      chain: opts.chain ?? null,
      editMode: 'test-generation',
      sourceFiles: files
    })
    const writtenTests = (res.touchedFiles ?? []).filter(file => TEST_FILE_RE.test(file))
    const unexpectedWrites = (res.touchedFiles ?? []).filter(file => !TEST_FILE_RE.test(file))
    const noOp = !res.error && writtenTests.length === 0
    const error = resolveBatchError(res, unexpectedWrites, noOp)
    const diagnosis = batchDiagnosis({
      i,
      total: batches.length,
      files,
      batchMutants,
      budget,
      oversizedFiles,
      oversizedSubBatch,
      promptChars: res.telemetry?.promptChars ?? prompt.length,
      requestedTimeoutMs,
      workerDeadlineMs,
      effectiveTimeoutMs,
      survivedBatchesPerRung: opts.coverageTimeout?.survivedBatchesPerRung ?? null,
      wallMs: res.telemetry?.wallMs ?? Date.now() - startedAt,
      telemetry: res.telemetry,
      error,
      writtenTests
    })
    batchDiagnostics.push(diagnosis)
    console.log(`  ${formatBatchDiagnosis(diagnosis)}`)
    if (error) {
      if (unexpectedWrites.length > 0) res.rollback?.()
      console.error(`✗ batch ${i + 1}/${batches.length} не завершився: ${error}`)
      console.error(`  Файли batch (частковий прогрес зареєстровано через recordWrite): ${files.join(', ')}`)
      failed.push({ files, error, diagnosis })
      continue
    }
    fixed.push(...writtenTests)
    touchedFiles.push(...writtenTests)
  }

  logCoverageSummary(failed, deferred, fixed, batches)

  return { fixed, failed, deferred, touchedFiles, batches: batchDiagnostics }
}

/**
 * Повертає інʼєктований `runAgentFix` або lazy-завантажує агентний fixer для runtime.
 * @param {FixSurvivedOptions} opts ctx-поля ladder-а та тестові інʼєкції
 * @returns {Promise<typeof import('@7n/llm-lib/agent-fix').runAgentFix>} функція агентного fix-а
 */
async function resolveRunFix(opts) {
  if (opts.runAgentFix) return opts.runAgentFix
  const agentFixModule = await import('@7n/llm-lib/agent-fix')
  return agentFixModule.runAgentFix
}

/**
 * Визначає причину failed batch за результатом агента й політикою дозволених записів.
 * @param {{error?: string|null, telemetry?: object|null}} res результат `runAgentFix`
 * @param {string[]} unexpectedWrites файли, які агент змінив поза дозволеними test/spec шляхами
 * @param {boolean} noOp чи агент завершився без помилки і без test-записів
 * @returns {string|null} текст помилки batch-а або `null`, якщо batch успішний
 */
function resolveBatchError(res, unexpectedWrites, noOp) {
  if (res.error) return res.error
  if (unexpectedWrites.length > 0) return `недопустимі записи поза test-файлами: ${unexpectedWrites.join(', ')}`
  if (noOp) return noOpReason(res.telemetry)
  return null
}

/**
 * Логує підсумок coverage-fix після всіх batch-ів.
 * @param {{files: string[], error: string}[]} failed failed/no-op batch-и
 * @param {string[]} fixed змінені test-файли
 * @param {object[]} batches діагностика всіх batch-ів
 * @returns {void}
 */
function logCoverageSummary(failed, deferred, fixed, batches) {
  if (failed.length > 0) {
    console.log(
      `\n⚠️  coverage fix: ${batches.length - deferred.length} batch(ів) запущено, ${deferred.length} deferred, ${fixed.length} test-файл(ів) змінено, ${failed.length} batch(ів) failed/no-op:`
    )
    for (const f of failed) console.log(`  ✗ ${f.files.join(', ')} — ${f.error}`)
    return
  }
  console.log(
    `\n✓ coverage fix: ${batches.length - deferred.length} batch(ів) запущено, ${deferred.length} deferred, ${fixed.length} test-файл(ів) змінено.`
  )
}

/**
 * Складає serializable діагностику batch-а без prompt-а, model output чи source-коду.
 * @param {object} args дані batch-а та telemetry `runAgentFix`
 * @param {number} args.i індекс batch-а з нуля
 * @param {number} args.total загальна кількість batch-ів
 * @param {string[]} args.files source-файли batch-а
 * @param {number} args.batchMutants кількість мутантів у batch-і
 * @param {number} args.budget налаштована стеля мутантів на batch
 * @param {string[]} args.oversizedFiles source-файли, що перевищили budget до sub-batching
 * @param {boolean} [args.oversizedSubBatch] чи batch є частиною oversized source-файлу
 * @param {number|null} [args.promptChars] довжина prompt-а в символах
 * @param {number|null} args.requestedTimeoutMs запитаний timeout для worker-а
 * @param {number|null} args.workerDeadlineMs deadline worker-а
 * @param {number|null} args.effectiveTimeoutMs timeout, реально переданий batch-у
 * @param {number|null} [args.survivedBatchesPerRung=null] policy кількості agent batch-ів у rung
 * @param {number|null} args.wallMs тривалість batch-а
 * @param {object|null} [args.telemetry] telemetry `runAgentFix`
 * @param {string|null} [args.error] помилка batch-а
 * @param {string[]} [args.writtenTests] дозволені test-файли, змінені агентом
 * @returns {object} безпечний структурований verdict
 */
function batchDiagnosis({
  i,
  total,
  files,
  batchMutants,
  budget,
  oversizedFiles,
  oversizedSubBatch = false,
  promptChars = null,
  requestedTimeoutMs,
  workerDeadlineMs,
  effectiveTimeoutMs,
  survivedBatchesPerRung = null,
  wallMs,
  telemetry = null,
  error = null,
  writtenTests = []
}) {
  const stops = [...new Set((telemetry?.turns ?? []).map(turn => turn.finish).filter(Boolean))]
  const edits = telemetry?.edits
  const allowedTestWrites = (Array.isArray(edits) ? edits.filter(edit => TEST_FILE_RE.test(edit.path)) : writtenTests)
    .length
  return {
    batch: i + 1,
    batchCount: total,
    sourceFileCount: files.length,
    mutantCount: batchMutants,
    configuredBudget: budget,
    oversizedSourceFile: oversizedFiles.length > 0,
    oversizedAtomicFile: oversizedFiles.length > 0 && !oversizedSubBatch,
    oversizedSubBatch,
    oversizedSubBatchMutantLimit: oversizedSubBatch ? OVERSIZED_FILE_SUB_BATCH_MUTANTS : null,
    oversizedFiles,
    promptChars,
    requestedTimeoutMs,
    workerDeadlineMs,
    effectiveTimeoutMs,
    survivedBatchesPerRung,
    wallMs,
    verdict: {
      turnCount: telemetry?.turnCount ?? 0,
      toolCallCount: telemetry?.toolCallCount ?? 0,
      stopReasons: stops,
      error: error ?? telemetry?.error ?? null,
      allowedTestWrites,
      blockedWrites: telemetry?.blocks?.length ?? 0,
      backstopHit: telemetry?.backstopHit ?? false,
      emptyCompletion: telemetry?.emptyCompletion ?? false
    }
  }
}

/**
 * Форматує batch-діагностику в компактний рядок для логів.
 * @param {object} diagnosis безпечна batch-діагностика
 * @returns {string} однорядковий опис diagnosis для stderr/stdout
 */
function formatBatchDiagnosis(diagnosis) {
  const verdict = diagnosis.verdict
  return [
    `diagnosis: files=${diagnosis.sourceFileCount}, mutants=${diagnosis.mutantCount}, budget=${diagnosis.configuredBudget}`,
    `oversizedSourceFile=${diagnosis.oversizedSourceFile}, oversizedSubBatch=${diagnosis.oversizedSubBatch}, promptChars=${diagnosis.promptChars}`,
    `timeout(requested/worker/effective)=${diagnosis.requestedTimeoutMs}/${diagnosis.workerDeadlineMs}/${diagnosis.effectiveTimeoutMs}ms; survivedBatchesPerRung=${diagnosis.survivedBatchesPerRung}`,
    `wallMs=${diagnosis.wallMs}`,
    `verdict(turns/tools/stops/error/testWrites/blocked/backstop)=${verdict.turnCount}/${verdict.toolCallCount}/${verdict.stopReasons.join(',') || '-'} / ${verdict.error ?? '-'} / ${verdict.allowedTestWrites}/${verdict.blockedWrites}/${verdict.backstopHit}`
  ].join('; ')
}

/**
 * Формує діагностику no-op сесії, зокрема для completion без tool-call/write.
 * @param {object|null|undefined} telemetry телеметрія `runAgentFix`
 * @returns {string} причина failed batch
 */
function noOpReason(telemetry) {
  const turns = telemetry?.turnCount ?? 0
  const tools = telemetry?.toolCallCount ?? 0
  const usage = telemetry?.usage?.totalTokens
  const usagePart = Number.isFinite(usage) ? `, usage.totalTokens=${usage}` : ''
  const stops = [...new Set((telemetry?.turns ?? []).map(turn => turn.finish).filter(Boolean))]
  const blocked = telemetry?.blocks?.length ?? 0
  return `no-op: агент завершився без записів (turnCount=${turns}, toolCallCount=${tools}, stopReason=${stops.join(',') || '-'}, blockedWrites=${blocked}${usagePart})`
}

/**
 * Формує rich-промпт для агента: список вцілілих мутантів згрупований по файлах,
 * з контекстом ±3 рядки навколо кожного мутанта з source-файлу.
 * @param {SurvivedFileGroup[]} survived групи вцілілих мутантів по файлах
 * @param {string} projectRoot корінь проєкту
 * @returns {Promise<string>} текст rich-промпту
 */
export async function buildFixPrompt(survived, projectRoot) {
  const sections = []

  for (const { file, mutants, exampleTest } of survived) {
    let srcLines = []
    try {
      const src = await readFile(join(projectRoot, file), 'utf8')
      srcLines = src.split('\n')
    } catch {
      // файл може бути недоступним — пропускаємо контекст, але продовжуємо
    }

    const mutantDescriptions = mutants
      .map(m => {
        const ctxStart = Math.max(0, m.line - 4)
        const ctxEnd = Math.min(srcLines.length, m.line + 3)
        const context = srcLines
          .slice(ctxStart, ctxEnd)
          .map((l, i) => `${ctxStart + i + 1}: ${l}`)
          .join('\n')
        return [
          `  - Рядок ${m.line}, колонка ${m.col}, тип мутації \`${m.mutantType}\``,
          `    Оригінал: \`${m.original}\``,
          `    Вижив варіант: \`${m.replacement}\``,
          context ? `    Контекст:\n\`\`\`\n${context}\n\`\`\`` : ''
        ]
          .filter(Boolean)
          .join('\n')
      })
      .join('\n')

    const exampleSection = exampleTest?.code
      ? `\n\nПриклад тесту з \`${exampleTest.testFile}\`:\n\`\`\`js\n${exampleTest.code}\n\`\`\``
      : ''

    sections.push(`### \`${file}\`${exampleSection}\n${mutantDescriptions}`)
  }

  return [
    'Твоє завдання — написати unit-тести, що вбивають наступні вцілілі мутанти Stryker.',
    'Для кожного мутанта: знайди або створи відповідний test-файл, додай тест-кейс,',
    'що явно перевіряє цю гілку/умову і провалиться якщо код замінити на "вцілілий варіант".',
    '',
    '## Вцілілі мутанти',
    '',
    ...sections,
    '',
    '## Правила',
    '- Source-файли наведені лише як контекст; не редагуй їх.',
    '- Дозволено знайти, створити або змінити повʼязані `*.test.*` / `*.spec.*` файли у test-каталогах.',
    '- Для ізоляції unit-тесту дозволені звичайні Vitest mock/stub без зміни production-коду.',
    '- Використовуй той самий test-фреймворк, що вже в проєкті.',
    '- Запусти тести проєкту (`bunx vitest run` чи відповідну команду) після кожного файлу — переконайся, що 0 fail.',
    '- Якщо мутант охоплений іншим новим тестом — не дублюй.'
  ].join('\n')
}
