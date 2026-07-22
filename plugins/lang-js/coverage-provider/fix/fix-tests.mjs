/**
 * fix-tests: виявляє падаючі unit-тести і виправляє їх через LLM (text mode) —
 * fix-шлях концерну `coverage` правила `test` (\`npx \@7n/rules lint test\`).
 *
 * Порядок роботи:
 *   1. getFailingTests(dir) — запускає project-local vitest споживача
 *      (`bunx vitest run --reporter=json`) і повертає список падаючих файлів.
 *   2. fixFailingTests(dir, opts) — батчами під prompt-бюджет:
 *        a. Читає поточний вміст тест-файлу та source-файлу
 *        b. callText → отримує виправлений код у ```js блоці
 *        c. writeFileSync (з recordWrite-реєстрацією) — запис файлу напряму
 *        d. Повторює до MAX_FIX_ATTEMPTS поки залишаються падіння
 *
 * Text+write замість агентних Edit-інструментів усуває проблему точного матчу
 * рядків з URL, backtick-рядками та спецсимволами.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { env } from 'node:process'

import { callText, MEMORY_ERROR_RE } from '@7n/rules/rules/test/coverage/lib/llm.mjs'
import { findTestRules } from './gen-tests.mjs'
import { parseFailingTests } from '../per-file.mjs'

// `@7n/llm-lib` — dependency ядра `@7n/rules`, не плагіна: динамічний import
// (top-level await) — той самий патерн, що `rules/js/eslint/fix-worker.mjs`.
const { CLOUD_MAX } = await import('@7n/llm-lib/model-tiers')
const { startChain } = await import('@7n/llm-lib/chain')
const { budgetFor, capText, packBatch } = await import('@7n/llm-lib/prompt-budget')

const MODEL = env.N_CURSOR_FIX_TESTS_MODEL ?? (CLOUD_MAX || undefined)
const MAX_SRC_BYTES = 4000
const TEST_DIR_MARKERS = ['/tests/', '\\tests\\']
const TEST_FILE_SUFFIX = '.test.mjs'
const SOURCE_FILE_SUFFIX = '.js'
const FILE_MARKER_PREFIX = '<!--'
const FILE_MARKER_SUFFIX = '-->'
const FILE_MARKER_LABEL = 'file:'
const CODE_FENCE_START_RE = /^```(?:js|javascript|mjs|ts)?$/
const CODE_FENCE_END = '```'

/**
 * Виводить шлях source з конвенційного `tests/<name>.test.mjs`.
 * @param {string} absPath абсолютний шлях тест-файлу
 * @returns {string|null} виведений шлях source або null, коли конвенція не збігається
 */
function inferSourcePath(absPath) {
  const marker = TEST_DIR_MARKERS.find(item => absPath.includes(item))
  if (!marker || !absPath.endsWith(TEST_FILE_SUFFIX)) return null
  const markerAt = absPath.lastIndexOf(marker)
  const dir = absPath.slice(0, markerAt)
  const stem = absPath.slice(markerAt + marker.length, -TEST_FILE_SUFFIX.length)
  if (!stem || stem.includes('/') || stem.includes('\\')) return null
  return `${dir}${marker[0]}${stem}${SOURCE_FILE_SUFFIX}`
}

/**
 * Парсить HTML file-маркер з одного рядка відповіді LLM.
 * @param {string} line рядок відповіді
 * @returns {string|null} шлях файлу з маркера або null
 */
function parseFileMarker(line) {
  const trimmed = line.trim()
  if (!trimmed.startsWith(FILE_MARKER_PREFIX) || !trimmed.endsWith(FILE_MARKER_SUFFIX)) return null
  const inner = trimmed.slice(FILE_MARKER_PREFIX.length, -FILE_MARKER_SUFFIX.length).trim()
  if (!inner.startsWith(FILE_MARKER_LABEL)) return null
  const file = inner.slice(FILE_MARKER_LABEL.length).trim()
  return file || null
}

/**
 * Жене vitest у JSON-режимі й повертає падаючі тест-файли з помилками.
 * Project-local vitest споживача через `bunx` (патерн runJsCoverage) —
 * bundled-vitest shim колишнього `\@7n/test` не переносився.
 * @param {string} dir корінь проєкту
 * @returns {Promise<Array<{file: string, errors: string[]}>>} падаючі тест-файли з помилками
 */
export async function getFailingTests(dir) {
  const tmpDir = await mkdtemp(join(tmpdir(), '7n-fix-'))
  const outputFile = join(tmpDir, 'results.json')

  try {
    spawnSync('bunx', ['vitest', 'run', '--reporter=json', `--outputFile=${outputFile}`, '--passWithNoTests'], {
      cwd: dir,
      stdio: 'inherit',
      env
    })

    if (!existsSync(outputFile)) return []

    return parseFailingTests(outputFile, dir)
  } finally {
    try {
      await rm(tmpDir, { recursive: true, force: true })
    } catch {
      /* ignore cleanup errors */
    }
  }
}

/**
 * Витягує перший fenced JS-блок з текстового виводу LLM.
 * @param {string} text текст відповіді LLM
 * @returns {string} витягнутий код або порожній рядок
 */
function extractCode(text) {
  const start = text.indexOf('```')
  if (start === -1) return ''
  const bodyStart = text.indexOf('\n', start)
  if (bodyStart === -1) return ''
  const end = text.indexOf('\n```', bodyStart + 1)
  if (end === -1) return ''
  return text.slice(bodyStart + 1, end).trim()
}

/**
 * Читає складники секції одного падаючого файлу для промпту.
 * @param {{file: string, errors: string[]}} failure падаючий тест-файл
 * @param {string} [dir] корінь проєкту
 * @returns {{file: string, errBlock: string, testCode: string, sourceCode: string|null}} сирі частини секції
 */
function readFailureParts({ file, errors }, dir) {
  const absPath = dir ? join(dir, file) : file
  const testCode = existsSync(absPath) ? readFileSync(absPath, 'utf8').slice(0, 6000) : '(файл не знайдено)'
  // Heuristically find source file: strip tests/ prefix from path
  const sourcePath = inferSourcePath(absPath)
  const sourceCode =
    sourcePath && existsSync(sourcePath) ? readFileSync(sourcePath, 'utf8').slice(0, MAX_SRC_BYTES) : null
  return { file, errBlock: errors.join('\n\n'), testCode, sourceCode }
}

/**
 * Складає секцію файлу з готових частин.
 * @param {{file: string, errBlock: string, testCode: string, sourceCode: string|null}} parts частини з `readFailureParts`
 * @returns {string} markdown-секція файлу
 */
function buildFileSection({ file, errBlock, testCode, sourceCode }) {
  return [
    `### \`${file}\``,
    '',
    '**Помилки:**',
    '```',
    errBlock,
    '```',
    '',
    '**Поточний тест-файл:**',
    '```js',
    testCode,
    '```',
    ...(sourceCode ? ['', '**Source (для довідки, не міняй):**', '```js', sourceCode, '```'] : [])
  ].join('\n')
}

/**
 * Будує промпт для виправлення падаючих тест-файлів.
 * Включає поточний вміст файлів — LLM не потребує file-read інструментів.
 * @param {Array<{file: string, errors: string[]}>} failures падаючі тест-файли
 * @param {string} [dir] корінь проєкту
 * @returns {string} текст промпту для LLM
 */
export function buildFixTestsPrompt(failures, dir) {
  const testRules = dir ? findTestRules(dir) : null
  const sections = failures.map(f => buildFileSection(readFailureParts(f, dir)))
  return buildPromptShell(sections, testRules)
}

/**
 * Обгортає секції файлів спільними правилами й інструкцією формату відповіді.
 * @param {string[]} sections markdown-секції падаючих файлів
 * @param {string|null} testRules конвенції тестів проєкту
 * @returns {string} повний текст промпту
 */
function buildPromptShell(sections, testRules) {
  return [
    'Виправ падаючі unit-тести. Поверни ПОВНИЙ вміст КОЖНОГО виправленого тест-файлу.',
    '',
    '## Правила:',
    '- Міняй виключно тест-файли — source-файли не чіпай',
    '- Зберігай структуру тестів (describe/it/expect) — НЕ видаляй тести',
    '- Якщо тест перевіряє неіснуючий API — адаптуй до реального',
    '- Файл .mjs = чистий JavaScript, НЕ TypeScript. НІКОЛИ: `as Type`, generics',
    '- `import { vi, describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from "vitest"` — імпортуй ВСЕ що використовуєш',
    '- Замість `fn as vi.Mock` → `vi.mocked(fn)`',
    '- `vi.spyOn(process, "env")` НЕ ПРАЦЮЄ — use `vi.stubEnv("KEY", "val")` + `afterEach(() => vi.unstubAllEnvs())`',
    '- `vi.spyOn(Date).mockReturnValue(...)` НЕ ПРАЦЮЄ з `new Date()` — use `vi.useFakeTimers()` + `vi.setSystemTime(new Date(...))` + `afterEach(() => vi.useRealTimers())`',
    "- `sendMessage` викликає fetch з одним аргументом (URL-рядком) — перевіряй через `expect.stringContaining(...)`, НЕ через об'єктний matcher",
    '- `describe()` callback НЕ може бути async. `await` тільки у: top-level async IIFE, `beforeAll(async () => {})`, або `it(async () => {})`',
    "- `vi.mock` hoisting: фабрика виконується до будь-якого `const`/`let` у модулі. Якщо потрібен спільний mock-об'єкт — оголошуй його через `vi.hoisted()`: `const { mockFn } = vi.hoisted(() => ({ mockFn: vi.fn() }))`; потім використовуй в factory та тестах",
    '- Якщо AssertionError показує `Expected: "A" Received: "B"` — функція реально повертає B. ВИПРАВ expected на точне значення з рядка "Received:", не переосмислюй логіку функції',
    '- Для regex/escape функцій: тестуй по одному символу (`expect(esc("*")).toBe("\\\\*")`), НЕ комбінований рядок — легко помилитись в подвійному екрануванні',
    ...(testRules ? ['', '## Конвенції тестів цього проєкту (.cursor/rules/n-test.mdc):', testRules] : []),
    '',
    '## Падаючі файли:',
    '',
    ...sections,
    '',
    'Для кожного файлу поверни його ПОВНИЙ вміст у блоці:',
    '<!-- file: <шлях до файлу> -->',
    '```js',
    '... повний вміст ...',
    '```'
  ].join('\n')
}

/**
 * Складає промпт під бюджет `budgetFor('fix')`: скільки файлів влазить —
 * стільки в батч (найменші першими), решта — у `deferred` на наступний
 * прохід. Файл, що сам-один перевищує бюджет, отримує соло-промпт із
 * внутрішнім обрізанням (спершу ріжеться source-довідка, потім
 * vitest-помилки; сам тест-код захищений) — ніколи не скипається.
 * @param {Array<{file: string, errors: string[]}>} failures падаючі тест-файли
 * @param {string} [dir] корінь проєкту
 * @returns {{prompt: string, included: string[], deferred: string[]}} промпт + розподіл файлів
 */
export function buildFixTestsBatch(failures, dir) {
  const testRules = dir ? findTestRules(dir) : null
  const shellOverhead = buildPromptShell([], testRules).length
  const sectionBudget = Math.max(1000, budgetFor('fix').maxPromptChars - shellOverhead)

  const parts = failures.map(f => {
    const p = readFailureParts(f, dir)
    return { ...p, section: buildFileSection(p) }
  })
  const { included, deferred } = packBatch(
    parts.map(p => ({ key: p.file, size: p.section.length })),
    sectionBudget
  )

  if (included.length === 0) {
    // Соло-режим: навіть найменший файл не влазить — жорстко обрізаємо
    // нутрощі секції (source геть, помилки до чверті бюджету, тест-код —
    // найцінніше — до половини), замість мовчазного skip
    const smallest = parts.toSorted((a, b) => a.section.length - b.section.length)[0]
    console.log(`  ⚠ ${smallest.file}: секція завелика (${smallest.section.length} симв.) — соло-виклик з обрізанням`)
    const section = buildFileSection({
      file: smallest.file,
      errBlock: capText(smallest.errBlock, Math.floor(sectionBudget / 4)),
      testCode: capText(smallest.testCode, Math.floor(sectionBudget / 2)),
      sourceCode: null
    })
    return {
      prompt: buildPromptShell([section], testRules),
      included: [smallest.file],
      deferred: failures.map(f => f.file).filter(f => f !== smallest.file)
    }
  }

  const includedSet = new Set(included)
  const sections = parts.filter(p => includedSet.has(p.file)).map(p => p.section)
  return { prompt: buildPromptShell(sections, testRules), included, deferred }
}

/**
 * Парсить fenced JS-блоки з file-маркерами з відповіді LLM.
 * @param {string} text текст відповіді LLM
 * @returns {Array<{file: string|null, code: string}>} пари файл/код
 */
function parseFixedFiles(text) {
  const results = []
  const lines = text.split('\n')

  let lineIndex = 0
  while (lineIndex < lines.length) {
    const file = parseFileMarker(lines[lineIndex])
    if (!file) {
      lineIndex++
      continue
    }

    const fenceStart = lines.findIndex((line, index) => index > lineIndex && CODE_FENCE_START_RE.test(line.trim()))
    if (fenceStart === -1) break

    const fenceEnd = lines.findIndex((line, index) => index > fenceStart && line.trim() === CODE_FENCE_END)
    if (fenceEnd === -1) break

    const code = lines
      .slice(fenceStart + 1, fenceEnd)
      .join('\n')
      .trim()
    if (code) results.push({ file, code })
    lineIndex = fenceEnd + 1
  }

  // Fallback: single unnamed block when only one file is being fixed
  if (results.length === 0) {
    const code = extractCode(text)
    if (code) results.push({ file: null, code })
  }
  return results
}

const MAX_FIX_ATTEMPTS = 3

/**
 * Вибирає eligible-файли поточного проходу: під лімітом спроб, deferred —
 * першими (анти-starvation).
 * @param {Array<{file: string, errors: string[]}>} remaining поточні падаючі файли
 * @param {Map<string, number>} attempts лічильники спроб per-file
 * @param {Set<string>} prevDeferred файли, відкладені попереднім батчем
 * @returns {Array<{file: string, errors: string[]}>} файли для наступного батчу
 */
function selectEligible(remaining, attempts, prevDeferred) {
  return remaining
    .filter(f => (attempts.get(f.file) ?? 0) < MAX_FIX_ATTEMPTS)
    .toSorted((a, b) => (prevDeferred.has(b.file) ? 1 : 0) - (prevDeferred.has(a.file) ? 1 : 0))
}

/**
 * Логи стартового списку падаючих файлів.
 * @param {Array<{file: string, errors: string[]}>} failures падаючі тест-файли
 * @returns {void}
 */
function logFailures(failures) {
  console.log(`\n🔧 Виправляю ${failures.length} падаючих test-файлів (LLM text mode)...\n`)
  for (const f of failures) {
    console.log(`  • ${f.file} (${f.errors.length} помилок)`)
  }
  console.log()
}

/**
 * Лог розподілу батчу (included/deferred).
 * @param {{included: string[], deferred: string[]}} batch результат buildFixTestsBatch
 * @returns {void}
 */
function announceBatch(batch) {
  if (batch.deferred.length) {
    console.log(`  📦 батч: ${batch.included.length} файлів, відкладено на наступний прохід: ${batch.deferred.length}`)
  }
}

/**
 * Підсумковий outcome ланцюжка за станом прогону.
 * @param {number} remainingCount скільки файлів досі падає
 * @param {number} fixedCount скільки файлів виправлено
 * @returns {'success'|'partial'|'fail'} outcome для chain.end
 */
function resolveChainOutcome(remainingCount, fixedCount) {
  if (remainingCount === 0) return 'success'
  return fixedCount > 0 ? 'partial' : 'fail'
}

/**
 * Записує згенеровані виправлення у наявні тест-файли (з recordWrite-реєстрацією).
 * @param {Array<{file: string|null, code: string}>} fixed розпарсені виправлення
 * @param {Array<{file: string, errors: string[]}>} remaining поточні падаючі файли
 * @param {string} dir корінь проєкту
 * @param {((absPath: string) => void)|null} recordWrite реєстрація запису для rollback ladder-а
 * @returns {string[]} абсолютні шляхи записаних файлів
 */
function writeFixedFiles(fixed, remaining, dir, recordWrite) {
  const written = []
  for (const { file, code } of fixed) {
    let absPath = null
    if (file) {
      absPath = join(dir, file)
    } else if (remaining.length === 1) {
      absPath = join(dir, remaining[0].file)
    }
    if (!absPath) {
      console.error('  ✗ не вдалось визначити файл для запису (немає маркера <!-- file: ... -->)')
      continue
    }
    if (!existsSync(absPath)) {
      console.error(`  ✗ файл не існує: ${relative(dir, absPath)}`)
      continue
    }
    recordWrite?.(absPath)
    writeFileSync(absPath, code + '\n', 'utf8')
    written.push(absPath)
    console.log(`  ✓ Записано: ${relative(dir, absPath)}`)
  }
  return written
}

/**
 * Виявляє й виправляє падаючі тести через LLM text mode + прямий writeFileSync.
 * Повертається одразу з count=0, якщо всі тести вже зелені.
 * @param {string} dir корінь проєкту
 * @param {{
 *   failures?: Array<{file: string, errors: string[]}>,
 *   callTextFn?: (prompt: string, opts?: object) => Promise<string>,
 *   startChain?: typeof startChain,
 *   model?: string,
 *   recordWrite?: (absPath: string) => void,
 *   deadlineAt?: number|null
 * }} [opts] інʼєкції callText/failures/chain (для тестів), model — override моделі
 *   (ctx.model ladder-а), recordWrite — реєстрація записів для rollback, deadlineAt —
 *   epoch-ms дедлайн: новий батч після нього не стартує (конвергенцію жене ladder ядра)
 * @returns {Promise<{count: number, fixed: number, remaining: number, touchedFiles: string[]}>} підсумок виправлення
 */
export async function fixFailingTests(dir, opts = {}) {
  const failures = opts.failures ?? (await getFailingTests(dir))

  if (failures.length === 0) return { count: 0, fixed: 0, remaining: 0, touchedFiles: [] }

  // Один ланцюжок на прогін: батчі змішують файли, per-file chain неможливий
  // без ламання батчингу; кожен batch-виклик = крок.
  const chain = (opts.startChain ?? startChain)({
    kind: 'test-fix',
    unit: `fix:${failures.length}files`,
    cwd: dir
  })
  let batches = 0
  const model = opts.model ?? MODEL
  const callTextFn =
    opts.callTextFn ?? (prompt => callText(prompt, { model, cwd: dir, maxTokens: budgetFor('fix').maxTokens, chain }))

  logFailures(failures)

  const touchedFiles = []
  let remaining = failures
  const attempts = new Map()
  let prevDeferred = new Set()
  try {
    for (;;) {
      // Дедлайн ladder-а: новий батч після нього не стартує
      if (opts.deadlineAt && Date.now() >= opts.deadlineAt) break
      // Спроби рахуються per-file (лише коли файл реально був у батчі),
      // тож deferred-черга не з'їдає ліміт файлів, які ще не пробували
      const eligible = selectEligible(remaining, attempts, prevDeferred)
      if (eligible.length === 0) break

      const batch = buildFixTestsBatch(eligible, dir)
      announceBatch(batch)
      for (const file of batch.included) attempts.set(file, (attempts.get(file) ?? 0) + 1)
      prevDeferred = new Set(batch.deferred)

      let response
      try {
        batches++
        response = await callTextFn(batch.prompt)
      } catch (error) {
        // memory-guard: не звичайна per-file помилка — RAM-стеля фіксована, продовжувати
        // до наступного файлу немає сенсу. Пробиваємо нагору, аби прогін завершився.
        if (MEMORY_ERROR_RE.test(error.message ?? '')) throw error
        console.error(`  ✗ LLM помилка: ${error.message}`)
        break
      }

      const fixed = parseFixedFiles(response)

      if (fixed.length === 0) {
        console.error('  ✗ LLM не повернула виправлений код')
        break
      }

      const includedSet = new Set(batch.included)
      touchedFiles.push(
        ...writeFixedFiles(
          fixed,
          eligible.filter(f => includedSet.has(f.file)),
          dir,
          opts.recordWrite ?? null
        )
      )

      remaining = await getFailingTests(dir)
    }
  } finally {
    const fixedSoFar = failures.length - remaining.length
    chain.end({
      outcome: resolveChainOutcome(remaining.length, fixedSoFar),
      extra: {
        files: failures.map(f => f.file),
        batches,
        fixed: fixedSoFar,
        remaining: remaining.length
      }
    })
  }

  const fixedCount = failures.length - remaining.length

  if (fixedCount > 0) console.log(`✓ Виправлено: ${fixedCount}/${failures.length} файлів`)
  if (remaining.length > 0) console.log(`⚠ Залишились падати: ${remaining.length} файлів`)

  return { count: failures.length, fixed: fixedCount, remaining: remaining.length, touchedFiles }
}
