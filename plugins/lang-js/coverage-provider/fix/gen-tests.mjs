/**
 * Генерація unit-тестів через LLM з per-export tiered-маршрутизацією
 * (fix-шлях концерну `coverage` правила `test`, \`npx \@7n/rules lint test\`).
 *
 * Стратегія:
 *   1. Класифікація кожного export-а: trivial/simple → спершу локальна модель, complex → cloud.
 *   2. Спільний header (imports, mocks, setup) — через cloud.
 *   3. Per-export describe()-блоки, маршрутизовані за складністю.
 *   4. Валідація локально згенерованих блоків; fallback на cloud при анти-патернах.
 *   5. Merge header + блоки → запис тест-файлу (через `recordWrite` ladder-а).
 *
 * Локальна модель — opts.localModel або env N_LOCAL_MIN_MODEL. Всі виклики йдуть
 * через LLM-хелпер концерну (`lib/llm.mjs` ядра). Без локальної моделі (або без
 * export-ів) — fallback на single-file cloud-генерацію. Валідація блоків жене
 * project-local vitest споживача (`bunx vitest run`) — bundled-vitest shim
 * колишнього `\@7n/test` не переносився (vitest — devDependency споживача).
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join, relative, dirname } from 'node:path'
import { env } from 'node:process'

import { callText, MEMORY_ERROR_RE } from '@7n/rules/rules/test/coverage/lib/llm.mjs'
import { extractExportsWithComplexity } from './classify-exports.mjs'
import { analyzeModule } from '../lib/ast-analyze.mjs'
import { probeModule, probeFetchCalls, probeTimeVariants, probeHelpers } from '../lib/runtime-probe.mjs'

// `@7n/llm-lib` — dependency ядра `@7n/rules`, не плагіна: динамічний import
// (top-level await) замість статичного — той самий патерн, що
// `rules/js/eslint/fix-worker.mjs`.
const { budgetFor } = await import('@7n/llm-lib/prompt-budget')
const { startChain } = await import('@7n/llm-lib/chain')

const MAX_SRC_BYTES = 6000

/**
 * Читає source-файл і обрізає до prompt-бюджету.
 * @param {string} absPath абсолютний шлях source
 * @returns {string} сніпет source або порожній рядок
 */
function readSourceSnippet(absPath) {
  if (!existsSync(absPath)) return ''
  const content = readFileSync(absPath, 'utf8')
  return content.length > MAX_SRC_BYTES ? `${content.slice(0, MAX_SRC_BYTES)}\n...(truncated)` : content
}

// ---------------------------------------------------------------------------
// Static regex constants (prefer-static-regex)
// ---------------------------------------------------------------------------

const FILE_EXT_RE = /\.[^.]+$/
const CODE_BLOCK_RE = /```(?:js|javascript|mjs|ts)?\n([\s\S]*?)```/
const FRONTMATTER_RE = /^---[\s\S]*?---\n/
const REQUIRE_CALL_RE = /\brequire\s*\(/
const JEST_ACCESS_RE = /\bjest\./
const AS_VI_MOCK_RE = /\bas\s+vi\.Mock/
const AS_JEST_MOCK_RE = /\bas\s+jest\.Mock/
const MOCK_TYPE_RE = /:\s*\w*Mock\b/
const FETCH_CALL_RE = /\bfetch\s*\(/
const TIME_DEPS_RE = /\bnew\s+Date\b|\bgetHours\b|\bgetDay\b|\bgetMinutes\b|\bDate\.now\b/
const VITEST_FAIL_RE = /Failed Tests|FAIL /
const EXPECTED_LINE_RE = /Expected:\s+"([^"]+)"/
const RECEIVED_LINE_RE = /Received:\s+"([^"]+)"/
const TO_CONTAIN_RE = /to contain '([^='\s]+)=([^']+)'/
const NOT_CONTAIN_RE = /not to contain '([^']+)'/
const FLAG_CONTAIN_RE = /to contain '([^'=]+)=true'/
const EXPORT_DECL_RE = /^export\s+(?:async\s+)?(?:const|function|class|let)\s+(\w+)/gm
const BLOCK_IMPORT_LINE_RE = /^import\s[^;]+;?\n?/gm
const BLOCK_COMMENT_LINE_RE = /^\/\/ .+\n/gm

/**
 * @callback PiCallFn
 * @param {string} prompt LLM prompt
 * @param {{cwd?: string, model?: string}} [options] опції виклику
 * @returns {Promise<string>} текст відповіді LLM
 */

/**
 * @callback GenerateOneFn
 * @param {{file: string, pct: number, reason: string}} fileInfo file coverage info
 * @param {string} dir корінь проєкту
 * @returns {Promise<string|null>} шлях записаного тесту або null
 */

/**
 * @callback RecordWriteFn
 * @param {string} absPath абсолютний шлях файлу, що буде записаний
 * @returns {void}
 */

/**
 * @typedef {object} GenerateTestsOptions
 * @property {PiCallFn} [callText] кастомний cloud-виклик
 * @property {string|null} [localModel] id локальної моделі; null — cloud-only режим
 * @property {GenerateOneFn} [generateOne] кастомний single-file генератор
 * @property {RecordWriteFn} [recordWrite] реєстрація запису для central rollback
 *   ladder-а (викликається ПЕРЕД writeFileSync; тимчасові валідаційні файли не реєструються)
 * @property {number|null} [deadlineAt] epoch-ms дедлайн — новий файл не стартує після нього
 */

// ---------------------------------------------------------------------------
// Helpers shared across strategies
// ---------------------------------------------------------------------------

/**
 * Витягує імена експортованих символів з JS/TS-джерела.
 * @param {string} content текст source
 * @returns {string[]} імена експортів
 */
function extractExports(content) {
  return Array.from(content.matchAll(EXPORT_DECL_RE), m => m[1])
}

/** Detects top-level function calls that run as side-effects on module load. */
const TOP_LEVEL_CALL_RE = /^[a-zA-Z_$][a-zA-Z0-9_$]*\s*\(/m

/**
 * Кандидати тест-файлу відносно source-файлу.
 * Primary: піддиректорія tests/ (конвенція n-test.mdc).
 * @param {string} file відносний шлях source
 * @returns {string[]} кандидати шляхів тест-файлу
 */
function testCandidates(file) {
  const base = file.replace(FILE_EXT_RE, '')
  const lastSlash = base.lastIndexOf('/')
  const name = lastSlash === -1 ? base : base.slice(lastSlash + 1)
  const dir = lastSlash === -1 ? '' : base.slice(0, lastSlash)
  const testsDir = dir ? `${dir}/tests` : 'tests'
  return [`${testsDir}/${name}.test.mjs`, `${base}.test.mjs`, `${base}.test.js`]
}

/**
 * Витягує перший fenced JS-блок з текстового виводу LLM.
 * @param {string} text вивід LLM
 * @returns {string} витягнутий код або порожній рядок
 */
function extractCode(text) {
  const m = CODE_BLOCK_RE.exec(text)
  if (m) return m[1].trim()
  const start = text.indexOf('```')
  if (start === -1) return ''
  const bodyStart = text.indexOf('\n', start)
  if (bodyStart === -1) return ''
  const end = text.indexOf('\n```', bodyStart + 1)
  if (end === -1) return ''
  return text.slice(bodyStart + 1, end).trim()
}

/**
 * Чи викликає/декларує текст символ за іменем.
 * @param {string} text текст для пошуку
 * @param {string} name імʼя символу
 * @returns {boolean} true коли символ викликається
 */
function hasInvocation(text, name) {
  return text.includes(`${name}(`)
}

/**
 * Знаходить n-test.mdc правила проєкту, піднімаючись від dir (максимум 4 рівні).
 * @param {string} dir корінь проєкту
 * @returns {string|null} текст правил або null
 */
export function findTestRules(dir) {
  let current = dir
  for (let i = 0; i < 4; i++) {
    const candidate = join(current, '.cursor/rules/n-test.mdc')
    if (existsSync(candidate)) {
      return readFileSync(candidate, 'utf8').replace(FRONTMATTER_RE, '').trim()
    }
    const parent = dirname(current)
    if (parent === current) break
    current = parent
  }
  return null
}

/**
 * Резолвить importPath і testFilePath для source-файлу відносно його тесту.
 * @param {string} file відносний шлях source
 * @returns {{testFilePath: string, importPath: string}} резолвлені шляхи
 */
function resolveTestPaths(file) {
  const testFilePath = testCandidates(file)[0]
  const testDir = dirname(testFilePath)
  const rel = relative(testDir, file)
  const importPath = rel.startsWith('.') ? rel : `./${rel}`
  return { testFilePath, importPath }
}

// ---------------------------------------------------------------------------
// Validation helpers for per-export blocks
// ---------------------------------------------------------------------------

/**
 * true, коли LLM-згенерований describe-блок проходить базові перевірки якості.
 * Вирішує, приймати локальний вивід чи ескалювати на cloud.
 * @param {string} block текст describe-блоку
 * @returns {boolean} true коли блок виглядає валідним
 */
function isValidBlock(block) {
  if (!block?.trim()) return false
  if (!block.includes('describe(')) return false
  if (REQUIRE_CALL_RE.test(block)) return false
  if (JEST_ACCESS_RE.test(block)) return false
  if (AS_VI_MOCK_RE.test(block)) return false
  if (AS_JEST_MOCK_RE.test(block)) return false
  return !MOCK_TYPE_RE.test(block)
}

/**
 * Обʼєднує спільний header з окремими describe()-блоками.
 * Прибирає випадкові import-рядки, які моделі інколи додають до блоків.
 * @param {string} header спільний header тесту
 * @param {string[]} blocks describe-блоки
 * @returns {string | null} обʼєднаний вміст файлу або `null`
 */
function mergeBlocks(header, blocks) {
  if (!header?.trim()) return null
  const clean = blocks
    .filter(Boolean)
    .map(b => b.replaceAll(BLOCK_IMPORT_LINE_RE, '').replaceAll(BLOCK_COMMENT_LINE_RE, '').trim())
    .filter(Boolean)
  if (clean.length === 0) return null
  return [header.trim(), '', ...clean].join('\n\n')
}

// ---------------------------------------------------------------------------
// Prompt builders
// ---------------------------------------------------------------------------

/**
 * @typedef {object} HeaderPromptOptions
 * @property {string} file шлях source-файлу
 * @property {string} testFilePath шлях генерованого тест-файлу
 * @property {string} importPath import-шлях від тесту до source
 * @property {boolean} hasSideEffects чи має source top-level side effects
 * @property {string} content сніпет source
 * @property {string[]} exports імена експортів
 * @property {string|null} testRules правила тестів проєкту
 * @property {object|null} astInfo результат статичного AST-аналізу
 */

/**
 * Будує header-промпт. Отримує наперед пораховану AST-інформацію, тож mock-shape
 * виведені детерміновано — LLM заповнює лише vi.stubEnv-виклики.
 * @param {HeaderPromptOptions} opts опції header-промпту
 * @returns {string} текст header-промпту
 */
function buildHeaderPrompt(opts) {
  const { file, testFilePath, importPath, hasSideEffects, content, exports, testRules, astInfo } = opts
  const mockLines = astInfo?.externalMocks?.map(m => m.mockLine) ?? []
  const envReads = astInfo?.envReads ?? []
  const usesFetch = astInfo?.usesFetch ?? FETCH_CALL_RE.test(content)

  const importLine = hasSideEffects
    ? `const { ${exports.join(', ')} } = await import("${importPath}")`
    : `import { ${exports.join(', ')} } from "${importPath}"`

  const envStubHints = envReads.length
    ? envReads.map(k => `  vi.stubEnv("${k}", "test_value")`)
    : ['  // vi.stubEnv("KEY", "value") — для env-змінних що читає модуль']

  const hasTimeDependency = TIME_DEPS_RE.test(content)
  const timerHints = hasTimeDependency
    ? ['  vi.useFakeTimers()', '  vi.setSystemTime(new Date("2024-01-01T02:00:00"))']
    : ['  // vi.useFakeTimers() + vi.setSystemTime(...) — якщо є new Date()']

  const template = [
    `import { vi, describe, it, expect, beforeEach, afterEach } from "vitest"`,
    '',
    ...(mockLines.length ? mockLines : ['// vi.mock("pkg", () => ({ fn: vi.fn() }))']),
    '',
    importLine,
    ...(usesFetch ? ['', 'const mockFetch = vi.fn()'] : []),
    '',
    'beforeEach(() => {',
    '  vi.clearAllMocks()',
    ...(usesFetch
      ? [
          '  vi.stubGlobal("fetch", mockFetch)',
          '  mockFetch.mockResolvedValue({ status: 200, json: async () => ({}) })'
        ]
      : []),
    ...envStubHints,
    ...timerHints,
    '})',
    '',
    'afterEach(() => {',
    '  vi.restoreAllMocks()',
    '  vi.unstubAllGlobals()',
    '  vi.unstubAllEnvs()',
    '  vi.useRealTimers()',
    '})'
  ].join('\n')

  const internalNote = astInfo?.internalNames?.length
    ? `Внутрішні (НЕ-exported, НЕ імітувати): ${astInfo.internalNames.join(', ')}`
    : ''

  return [
    `Заповни template header для unit-тест файлу (без describe/it блоків).`,
    `Тест-файл: \`${testFilePath}\`  Source: \`${file}\``,
    '',
    'TEMPLATE — vi.mock рядки вже точні (з AST). Заповни лише vi.stubEnv і vi.useFakeTimers де потрібно:',
    '```js',
    template,
    '```',
    '',
    'ПРАВИЛА:',
    `- Імпортуй з \`${importPath}\` — НЕ змінюй розширення, НЕ підміняй цей модуль`,
    `- Exports: ${exports.join(', ')}`,
    ...(internalNote ? [internalNote] : []),
    '- vi.mock() factories вже прописані вище — НЕ додавай нових',
    'Поверни лише код у ```js … ```',
    ...(testRules ? ['', '## Конвенції проєкту:', testRules] : []),
    '',
    `Source (${file}):`,
    '```js',
    content || '(недоступно)',
    '```'
  ].join('\n')
}

/**
 * Витягує source top-level (неекспортованої) declaration за іменем.
 * @param {string} content source модуля
 * @param {string} name імʼя declaration
 * @returns {string|null} source declaration або null
 */
function extractInternalSource(content, name) {
  const prefixes = [`const ${name} =`, `let ${name} =`, `var ${name} =`, `function ${name}(`, `async function ${name}(`]
  let start = -1
  for (const prefix of prefixes) {
    const direct = content.indexOf(prefix)
    if (direct !== -1 && (start === -1 || direct < start)) start = direct
    const lineStart = content.indexOf(`\n${prefix}`)
    if (lineStart !== -1) {
      const candidate = lineStart + 1
      if (start === -1 || candidate < start) start = candidate
    }
  }
  if (start === -1) return null
  const after = content.slice(start)
  const markers = ['\nconst ', '\nlet ', '\nvar ', '\nfunction ', '\nasync function ', '\nexport ']
  let end = -1
  for (const marker of markers) {
    const idx = after.indexOf(marker)
    if (idx !== -1 && (end === -1 || idx < end)) end = idx
  }
  return after.slice(0, end === -1 ? Math.min(after.length, 600) : end)
}

const COMPLEXITY_HINTS = {
  trivial: 'константа, 1-2 прості перевірки',
  simple: 'чиста функція',
  complex: 'async/fetch/Date/env'
}

/**
 * Описує бюджет генерації за складністю export-а.
 * @param {string} complexity клас складності export-а
 * @returns {string} людиночитна підказка складності
 */
function describeExportComplexity(complexity) {
  return COMPLEXITY_HINTS[complexity] ?? COMPLEXITY_HINTS.complex
}

/**
 * Витягує фрагмент source, релевантний одному export-у.
 * @param {string} content source модуля
 * @param {string} name імʼя export-а
 * @returns {string} звужений сніпет source
 */
function extractExportSnippet(content, name) {
  const exportPrefixes = [
    `export async function ${name}`,
    `export function ${name}`,
    `export async const ${name}`,
    `export const ${name}`,
    `export let ${name}`,
    `export class ${name}`
  ]
  let startAt = -1
  let startLen = 0
  for (const prefix of exportPrefixes) {
    const direct = content.indexOf(prefix)
    if (direct !== -1 && (startAt === -1 || direct < startAt)) {
      startAt = direct
      startLen = prefix.length
    }
  }
  if (startAt === -1) return content
  const after = content.slice(startAt + startLen)
  const nextExport = after.indexOf('\nexport ')
  const end = nextExport === -1 ? Math.min(after.length, 2000) : nextExport
  return content.slice(startAt, startAt + startLen) + after.slice(0, end)
}

/**
 * Форматує результати runtime-probe для block-промпту.
 * @param {string} name імʼя export-а
 * @param {object} probeResults результати probe по export-ах
 * @returns {string[]} рядки промпту
 */
function buildProbeLines(name, probeResults) {
  const probeSection = probeResults?.[name]
  if (Array.isArray(probeSection) && probeSection.length) {
    return [
      '',
      `Реальні виходи \`${name}\` (runtime-probe — використовуй для expected, не вгадуй):`,
      ...probeSection.map(p => `- ${name}(${p.input}) → ${p.output}`)
    ]
  }
  if (probeSection?.constant !== undefined) {
    return ['', `Реальне значення \`${name}\`: ${probeSection.constant}`]
  }
  return []
}

/**
 * Форматує зафіксовані fetch-виклики для block-промпту.
 * @param {string} name імʼя export-а
 * @param {object} fetchProbe зібрані fetch-виклики по export-ах
 * @returns {string[]} рядки промпту
 */
function buildFetchLines(name, fetchProbe) {
  const fetchCalls = fetchProbe?.[name]
  return fetchCalls?.length
    ? [
        '',
        `Реальні fetch-виклики \`${name}\` (перехоплено під час probe — використовуй для assert URL):`,
        ...fetchCalls.map(c => `- args ${c.args} → fetch("${c.url}"${c.init ? ', init' : ''})`)
      ]
    : []
}

/**
 * Форматує time-variant probe-результати для block-промпту.
 * @param {string} name імʼя export-а
 * @param {object} timeProbe time-variant результати по export-ах
 * @returns {string[]} рядки промпту
 */
function buildTimeLines(name, timeProbe) {
  const timeVariant = timeProbe?.[name]
  return timeVariant
    ? [
        '',
        `Часова залежність \`${name}\` (виходи змінюються залежно від години):`,
        ...Object.entries(timeVariant).map(([h, v]) => `- ${h.toString().padStart(2, '0')}:00 → ${v}`)
      ]
    : []
}

/**
 * Форматує інтроспекцію internal helper-ів для block-промпту.
 * @param {string} content source модуля
 * @param {string} snippet звужений сніпет source
 * @param {string[]} internalNames internal top-level імена
 * @param {object} helperProbe результати probe internal helper-ів
 * @returns {string[]} рядки промпту
 */
function buildHelperLines(content, snippet, internalNames, helperProbe) {
  const usedHelpers = internalNames.filter(name => hasInvocation(snippet, name))
  const helperSources = usedHelpers
    .map(name => extractInternalSource(content, name))
    .filter(Boolean)
    .slice(0, 3)
  const helperLines = usedHelpers.flatMap(name => {
    const calls = helperProbe?.[name]
    if (!calls?.length) return []
    return [
      '',
      `Реальні виходи internal helper \`${name}\` (НЕ імітувати, лише розуміти):`,
      ...calls.slice(0, 4).map(c => `- ${name}(${JSON.stringify(c.params)}) → ${JSON.stringify(c.result)}`)
    ]
  })
  return helperSources.length
    ? [
        '',
        'Internal helpers (контекст для розуміння params/API — НЕ імітувати):',
        '```js',
        ...helperSources,
        '```',
        ...helperLines
      ]
    : helperLines
}

/**
 * Будує промпт одного describe()-блоку для одного export-а.
 * @param {object} opts опції block-промпту
 * @param {{name: string, complexity: string}} opts.exp метадані export-а
 * @param {string} opts.testFilePath шлях генерованого тест-файлу
 * @param {string} opts.importPath import-шлях від тесту до source
 * @param {string} opts.content сніпет source
 * @param {string} opts.header згенерований спільний header
 * @param {string|null} opts.testRules правила тестів проєкту
 * @param {object} opts.probeResults runtime-probe результати по export-ах
 * @param {object} opts.fetchProbe зібрані fetch-виклики по export-ах
 * @param {object} opts.timeProbe time-variant результати по export-ах
 * @param {object} opts.helperProbe probe-результати internal helper-ів
 * @param {object|null} opts.astInfo результат статичного AST-аналізу
 * @returns {string} текст block-промпту
 */
function buildBlockPrompt(opts) {
  const {
    exp,
    testFilePath,
    importPath,
    content,
    header,
    testRules,
    probeResults,
    fetchProbe,
    timeProbe,
    helperProbe,
    astInfo
  } = opts
  const snippet = extractExportSnippet(content, exp.name)
  const internalNames = astInfo?.internalNames ?? []

  return [
    `Тест-файл: \`${testFilePath}\`  Source import: \`"${importPath}"\``,
    '',
    'Header вже написано (НЕ дублюй import/beforeEach/afterEach):',
    '```js',
    header,
    '```',
    '',
    `Напиши ЛИШЕ \`describe("${exp.name}", () => { … })\` для \`${exp.name}\`.`,
    `Складність: ${exp.complexity} — ${describeExportComplexity(exp.complexity)}`,
    ...buildProbeLines(exp.name, probeResults),
    ...buildFetchLines(exp.name, fetchProbe),
    ...buildTimeLines(exp.name, timeProbe),
    ...buildHelperLines(content, snippet, internalNames, helperProbe),
    '',
    'Правила (СУВОРО):',
    '- Без import, без beforeEach — тільки describe',
    '- ESM only (без require), vi.* (без jest.*)',
    '- vi.mocked(fn) замість type-кастингу',
    '- toBe для примітивів, toEqual для обʼєктів/масивів',
    '- `describe()` callback НЕ може бути async — `await` тільки у top-level, `beforeAll(async()=>{})`, або `it(async()=>{})`',
    "- НЕ використовуй vi.spyOn на ESM-exports — це неможливо (`Cannot spy on export`). Для перевірки виклику fetch використовуй `mockFetch.mock.calls[0][0]` (URL) та `mockFetch.mock.calls[0][1]` (init-об'єкт або undefined)",
    '- fetch завжди викликається як `fetch(url, undefined)` — `toHaveBeenCalledWith` ПРОВАЛИТЬСЯ (2 аргументи). ЗАВЖДИ перевіряй URL через `expect(mockFetch.mock.calls[0][0]).toContain(pattern)` або `.toBe(url)` — НЕ `toHaveBeenCalledWith`',
    '- `expect(str).stringContaining(x)` та `expect(str).not.stringContaining(x)` НЕ існують в Vitest — використовуй `expect(str).toContain(pattern)` та `expect(str).not.toContain(pattern)`',
    '- НЕ створюй окремий mock-спай для тестованої функції — вона вже реальна. Стеж тільки за `mockFetch`',
    '- `formData.get("document")` повертає `File` об\'єкт, НЕ рядок — для перевірки імені файлу: `formData.get("document").name`',
    '- `vi.useFakeTimers()` БЕЗ `vi.setSystemTime(...)` заморожує час на ЗАРАЗ (поточна година) — якщо функція залежить від часу доби, обовʼязково встанови фіксований час: `vi.setSystemTime(new Date("2024-01-01T00:00:00"))` (північ, поза робочими годинами)',
    '- При тестуванні params — перевіряй РЕАЛЬНІ назви полів з internal helpers (наприклад, `disable_notification`, НЕ `silent`)',
    '- Поверни лише describe-блок у ```js … ```',
    ...(testRules ? ['', '## Конвенції:', testRules.slice(0, 1500)] : []),
    '',
    `Source (${exp.name}):`,
    '```js',
    snippet,
    '```'
  ].join('\n')
}

// ---------------------------------------------------------------------------
// Block validation via real vitest run
// ---------------------------------------------------------------------------

const LOCAL_MAX_ATTEMPTS = 3
const CLOUD_MAX_ATTEMPTS = 10

/**
 * Проганяє один describe-блок (обʼєднаний із header-ом) через project-local
 * vitest споживача (`bunx vitest run`, патерн runJsCoverage js-collector-а).
 * Пише тимчасовий файл усередині testDir, щоб відносні імпорти й include-патерн
 * vitest резолвились коректно; тимчасовий файл НЕ реєструється через
 * recordWrite (не є кінцевим станом) і прибирається після прогону.
 * @param {string} header спільний header тест-файлу
 * @param {string} block describe-блок для валідації
 * @param {string} dir корінь проєкту (cwd для vitest, для резолву конфігу)
 * @param {string} testDir директорія, де житиме реальний тест-файл
 * @returns {{ passed: boolean, errors: string }} результат vitest
 */
function runBlock(header, block, dir, testDir) {
  const code = mergeBlocks(header, [block])
  if (!code) return { passed: false, errors: 'mergeBlocks failed' }

  mkdirSync(testDir, { recursive: true })
  const tmpFile = join(testDir, '.7n-validate.test.mjs')
  try {
    writeFileSync(tmpFile, code + '\n', 'utf8')
    const result = spawnSync('bunx', ['vitest', 'run', '--reporter=verbose', tmpFile], {
      cwd: dir,
      encoding: 'utf8',
      timeout: 30_000,
      env: process.env
    })
    if (result.status === 0) return { passed: true, errors: '' }
    const out = (result.stdout ?? '') + (result.stderr ?? '')
    // Extract only the failure section to keep context short
    const lines = out.split('\n')
    const failIdx = lines.findIndex(l => VITEST_FAIL_RE.test(l))
    const relevant = failIdx === -1 ? out : lines.slice(failIdx).join('\n')
    return { passed: false, errors: relevant.slice(0, 3000) }
  } finally {
    try {
      rmSync(tmpFile)
    } catch {
      /* ignore if already gone */
    }
  }
}

/**
 * Виявляє типові env/timer-анти-патерни з виводу помилок vitest.
 * Патерновий, проєкт-агностичний — парсить Expected/Received з виводу vitest.
 * Повертає root-cause підказки для retry-промпту.
 * @param {string} errors вивід помилок vitest
 * @returns {string[]} підказки
 */
function detectStaleRootCause(errors) {
  const hints = []

  // Extract structured Expected/Received lines from vitest output
  const receivedMatch = errors.match(RECEIVED_LINE_RE)
  const received = receivedMatch?.[1] ?? ''
  // EXPECTED_LINE_RE тримається поруч для симетрії формату виводу vitest
  EXPECTED_LINE_RE.lastIndex = 0

  // Pattern 1: expected param=X, but received param=test_value (global stub conflict)
  const toContainMatch = errors.match(TO_CONTAIN_RE)
  if (toContainMatch && received.includes(`${toContainMatch[1]}=test_value`) && toContainMatch[2] !== 'test_value') {
    const [, param, wantedVal] = toContainMatch
    hints.push(
      `ПРИЧИНА: "${param}=" у результаті має значення "test_value" (зі stubEnv у beforeEach), а не "${wantedVal}".`,
      `Щоб перевірити конкретне значення — додай vi.stubEnv("ENV_KEY", "${wantedVal}") всередині it-блоку перед викликом.`,
      `Або змінить assert на .toContain("${param}=test_value") якщо конкретне значення не важливе.`
    )
  }

  // Pattern 2: not.toContain(X) fails → X always present (global stub makes it so)
  const notContainMatch = errors.match(NOT_CONTAIN_RE)
  if (notContainMatch && received.includes(notContainMatch[1])) {
    hints.push(
      `ПРИЧИНА: "${notContainMatch[1]}" завжди присутній у результаті — швидше за все через глобальний vi.stubEnv у beforeEach.`,
      `Видали цей тест або перевірте умову при якій "${notContainMatch[1]}" не з'являється.`
    )
  }

  // Pattern 3: expected to contain 'flag=true' but absent → conditional/time-based logic
  const flagMatch = errors.match(FLAG_CONTAIN_RE)
  if (flagMatch && !received.includes(`${flagMatch[1]}=true`)) {
    hints.push(
      `ПРИЧИНА: "${flagMatch[1]}=true" не з'являється — це умовний параметр (залежить від часу, env або стану).`,
      `Якщо залежить від часу — встанови фіксований час у it-блоці: vi.setSystemTime(new Date("2024-01-01T02:00:00")).`,
      `Якщо залежить від env — stub відповідну змінну перед викликом.`
    )
  }

  return hints
}

/**
 * Обгортає базовий block-промпт фідбеком помилок vitest для retry.
 * Коли передані rootCauseHints (stale-помилка) — інʼєктить їх перед помилкою.
 * @param {string} originalPrompt початковий block-промпт
 * @param {string} prevBlock попередній describe-блок
 * @param {string} errors вивід помилок vitest
 * @param {number} attempt номер поточної спроби
 * @param {string[]} rootCauseHints stale-діагностичні підказки
 * @returns {string} текст retry-промпту
 */
function buildRetryPrompt(originalPrompt, prevBlock, errors, attempt, rootCauseHints = []) {
  const hintsSection = rootCauseHints.length
    ? ['', '### Аналіз причини (не ігноруй — помилка повторюється):', ...rootCauseHints.map(h => `- ${h}`)]
    : []

  return [
    originalPrompt,
    '',
    '---',
    `## Спроба ${attempt}: попередній блок не пройшов vitest`,
    '',
    'Твій попередній варіант:',
    '```js',
    prevBlock,
    '```',
    '',
    'Помилки vitest:',
    '```',
    errors,
    '```',
    ...hintsSection,
    '',
    'Поверни виправлений describe-блок у ```js … ```'
  ].join('\n')
}

const STALE_THRESHOLD = 2

/**
 * Будує retry-діагностику для повторюваних падінь vitest.
 * @param {string|null} lastErrors попередній текст помилки
 * @param {string|null} prevErrorSig попередня стабільна сигнатура помилки
 * @param {number} staleCount поточний лічильник повторюваних помилок
 * @param {string} label відображувана назва для логів
 * @returns {{staleCount: number, prevErrorSig: string|null, rootCauseHints: string[]}} retry-діагностика
 */
function buildRetryDiagnostics(lastErrors, prevErrorSig, staleCount, label) {
  const errorSig = lastErrors?.slice(0, 120) ?? null
  const nextStaleCount = errorSig && errorSig === prevErrorSig ? staleCount + 1 : 0
  const rootCauseHints = nextStaleCount >= STALE_THRESHOLD ? detectStaleRootCause(lastErrors ?? '') : []
  if (rootCauseHints.length) {
    console.log(`    ${label} ⚡ stale error (${nextStaleCount}x) — root cause hints injected`)
  }
  return { staleCount: nextStaleCount, prevErrorSig: errorSig, rootCauseHints }
}

/**
 * Перетворює LLM-виняток на loop-control стан.
 * @param {Error} error спійманий LLM-виняток
 * @param {number} attempt номер поточної спроби
 * @param {number} maxAttempts ліміт retry
 * @param {string} label відображувана назва для логів
 * @returns {{stop: boolean, lastErrors: string|null}} loop-control стан
 */
function resolveLoopCallFailure(error, attempt, maxAttempts, label) {
  // memory-guard: не звичайна per-file помилка — RAM-стеля фіксована, продовжувати
  // до наступного файлу немає сенсу. Пробиваємо нагору, аби прогін завершився.
  if (MEMORY_ERROR_RE.test(error.message ?? '')) throw error
  console.log(`    ${label} ✗ LLM error (спроба ${attempt}): ${error.message}`)
  if (attempt >= maxAttempts) return { stop: true, lastErrors: null }
  return { stop: false, lastErrors: `LLM error: ${error.message}` }
}

/**
 * Генерує describe-блок циклом run → feedback.
 * На кожному падінні vitest додає помилку у наступний промпт.
 * @param {string} basePrompt початковий block-промпт
 * @param {PiCallFn} callFn LLM-виклик (async)
 * @param {object} callOpts опції, що передаються у callFn
 * @param {string} header спільний header тест-файлу
 * @param {string} dir корінь проєкту (cwd для vitest)
 * @param {string} testDir директорія реального тест-файлу (для відносних імпортів)
 * @param {string} label відображувана назва для логів
 * @param {number} maxAttempts стеля retry-ітерацій
 * @param {string|null} seedBlock блок із попереднього tier-у (стартує цикл із seed)
 * @param {string|null} seedErrors помилки попереднього tier-у (показуються на спробі 1)
 * @returns {Promise<{ block: string|null, lastBlock: string|null, lastErrors: string|null }>} результат генерації
 */
async function generateBlockWithLoop(
  basePrompt,
  callFn,
  callOpts,
  header,
  dir,
  testDir,
  label,
  maxAttempts = CLOUD_MAX_ATTEMPTS,
  seedBlock = null,
  seedErrors = null
) {
  let lastBlock = seedBlock
  let lastErrors = seedErrors
  let staleCount = 0
  let prevErrorSig = null // first 120 chars — stable signature for sameness

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const diagnostics = buildRetryDiagnostics(lastErrors, prevErrorSig, staleCount, label)
    staleCount = diagnostics.staleCount
    prevErrorSig = diagnostics.prevErrorSig

    const prompt =
      lastErrors && lastBlock
        ? buildRetryPrompt(basePrompt, lastBlock, lastErrors, attempt, diagnostics.rootCauseHints)
        : basePrompt

    let resp
    try {
      resp = await callFn(prompt, callOpts)
    } catch (error) {
      const failure = resolveLoopCallFailure(error, attempt, maxAttempts, label)
      if (failure.stop) break
      lastErrors = failure.lastErrors
      continue
    }

    const block = extractCode(resp)
    if (!isValidBlock(block)) {
      console.log(`    ${label} ✗ invalid block (спроба ${attempt}) → retry`)
      lastBlock = block || lastBlock
      lastErrors =
        'Блок не містить валідного describe() або має синтаксичну помилку — поверни лише describe-блок у ```js … ```'
      continue
    }

    const { passed, errors } = runBlock(header, block, dir, testDir)
    if (passed) {
      if (attempt > 1) console.log(`    ${label} ✓ passed (спроба ${attempt}/${maxAttempts})`)
      return { block, lastBlock: null, lastErrors: null }
    }

    console.log(`    ${label} ✗ vitest fail (спроба ${attempt}/${maxAttempts})`)
    lastBlock = block
    lastErrors = errors
  }

  console.log(`    ${label} ⚠ ${maxAttempts} спроб вичерпано`)
  return { block: null, lastBlock, lastErrors }
}

// ---------------------------------------------------------------------------
// Per-export generation
// ---------------------------------------------------------------------------

/**
 * Best-effort статичний аналіз без переривання генерації.
 * @param {string} content сніпет source
 * @param {string} file відносний шлях source (для вибору діалекту парсера)
 * @returns {object|null} результат AST-аналізу або null
 */
function analyzeSourceModule(content, file) {
  try {
    return analyzeModule(content, file)
  } catch {
    return null
  }
}

/**
 * Збирає runtime-probe дані для заземлення per-export промптів.
 * @param {string} absPath абсолютний шлях source
 * @param {string[]} exports імена експортів
 * @param {string} content сніпет source
 * @param {object|null} astInfo результат статичного AST-аналізу
 * @returns {object} runtime-probe контекст
 */
function buildProbeContext(absPath, exports, content, astInfo) {
  const envKeys = astInfo?.envReads ?? []
  return {
    probeResults: exports.length ? probeModule(absPath, exports, envKeys) : {},
    fetchProbe: astInfo?.usesFetch ? probeFetchCalls(absPath, exports, envKeys) : {},
    timeProbe: TIME_DEPS_RE.test(content) ? probeTimeVariants(absPath, exports, envKeys) : {},
    helperProbe: astInfo?.internalNames?.length ? probeHelpers(absPath, astInfo.internalNames, envKeys) : {}
  }
}

/**
 * Готує source, статичний аналіз і probe-и для per-export генерації.
 * @param {{file: string, pct: number, reason: string}} fileInfo file coverage info
 * @param {string} dir корінь проєкту
 * @returns {object} контекст per-export генерації
 */
function buildPerExportContext(fileInfo, dir) {
  const { file } = fileInfo
  const absPath = join(dir, file)
  const content = readSourceSnippet(absPath)
  const { testFilePath, importPath } = resolveTestPaths(file)
  const hasSideEffects = content.length > 0 && TOP_LEVEL_CALL_RE.test(content)
  const exports = extractExports(content)
  const exportsWithComplexity = extractExportsWithComplexity(content)
  const testRules = findTestRules(dir)
  const astInfo = analyzeSourceModule(content, file)

  return {
    file,
    testFilePath,
    importPath,
    content,
    hasSideEffects,
    exports,
    exportsWithComplexity,
    testRules,
    astInfo,
    ...buildProbeContext(absPath, exports, content, astInfo)
  }
}

/**
 * Генерує спільний header через cloud-модель.
 * @param {object} ctx контекст per-export генерації
 * @param {string} dir корінь проєкту
 * @param {PiCallFn} callTextFn cloud LLM-виклик
 * @returns {Promise<string|null>} згенерований header або null
 */
async function generateSharedHeader(ctx, dir, callTextFn) {
  const { file, testFilePath, importPath, hasSideEffects, content, exports, testRules, astInfo } = ctx
  try {
    const headerResp = await callTextFn(
      buildHeaderPrompt({ file, testFilePath, importPath, hasSideEffects, content, exports, testRules, astInfo }),
      { cwd: dir, maxTokens: budgetFor('header').maxTokens }
    )
    const header = extractCode(headerResp)
    if (header) return header
    console.error(`  ✗ cloud не повернув header для ${file}`)
  } catch (error) {
    if (MEMORY_ERROR_RE.test(error.message ?? '')) throw error
    console.error(`  ✗ cloud header error: ${error.message}`)
  }
  return null
}

/**
 * Пробує локальну генерацію для простих export-ів і готує seed для cloud.
 * @param {object} opts опції локальної генерації
 * @returns {Promise<{block: string|null, lastBlock: string|null, lastErrors: string|null}>} локальний результат
 */
async function generateLocalBlock(opts) {
  const { exp, blockPrompt, header, dir, testDir, callLocalFn, isSimple } = opts
  if (!isSimple || !callLocalFn) return { block: null, lastBlock: null, lastErrors: null }

  console.log(`    ${exp.name} (${exp.complexity}) → local [max ${LOCAL_MAX_ATTEMPTS}]`)
  const result = await generateBlockWithLoop(
    blockPrompt,
    callLocalFn,
    { maxTokens: budgetFor('block').maxTokens },
    header,
    dir,
    testDir,
    `${exp.name} [local]:`,
    LOCAL_MAX_ATTEMPTS
  )
  if (result.block) return { block: result.block, lastBlock: null, lastErrors: null }

  // Only seed cloud with lastBlock if it's a valid block structure.
  // An invalid block as seed causes cascade invalid blocks in cloud.
  const lastBlock = result.lastBlock && isValidBlock(result.lastBlock) ? result.lastBlock : null
  console.log(`    ${exp.name} ✗ local exhausted → cloud (з seed-контекстом)`)
  return { block: null, lastBlock, lastErrors: result.lastErrors }
}

/**
 * Генерує блок через cloud-tier, опційно з seed від локальної спроби.
 * @param {object} opts опції cloud-генерації
 * @returns {Promise<string|null>} згенерований describe-блок або останній вживаний блок
 */
async function generateCloudBlock(opts) {
  const { exp, blockPrompt, header, dir, testDir, callTextFn, isSimple, seed } = opts
  const tier = isSimple ? 'cloud fallback' : 'cloud'
  console.log(`    ${exp.name} (${exp.complexity}) → ${tier} [max ${CLOUD_MAX_ATTEMPTS}]`)
  const result = await generateBlockWithLoop(
    blockPrompt,
    callTextFn,
    { cwd: dir, maxTokens: budgetFor('block').maxTokens },
    header,
    dir,
    testDir,
    `${exp.name} [cloud]:`,
    CLOUD_MAX_ATTEMPTS,
    seed.lastBlock,
    seed.lastErrors
  )
  return result.block ?? result.lastBlock
}

/**
 * Генерує один export describe-блок з local-first tiering-ом, коли доступний.
 * @param {object} exp метадані складності export-а
 * @param {object} ctx контекст per-export генерації включно з header-ом
 * @param {string} dir корінь проєкту
 * @param {string} testDir директорія реального тест-файлу
 * @param {PiCallFn} callTextFn cloud LLM-виклик
 * @param {PiCallFn} callLocalFn локальний LLM-виклик
 * @returns {Promise<string|null>} згенерований describe-блок або null
 */
async function generateExportBlock(exp, ctx, dir, testDir, callTextFn, callLocalFn) {
  const isSimple = exp.complexity === 'trivial' || exp.complexity === 'simple'
  const blockPrompt = buildBlockPrompt({ exp, ...ctx })
  const seed = await generateLocalBlock({ exp, blockPrompt, header: ctx.header, dir, testDir, callLocalFn, isSimple })
  if (seed.block) return seed.block
  return generateCloudBlock({ exp, blockPrompt, header: ctx.header, dir, testDir, callTextFn, isSimple, seed })
}

/**
 * Записує обʼєднаний згенерований тест-файл (з recordWrite-реєстрацією).
 * @param {string} dir корінь проєкту
 * @param {string} testFilePath шлях генерованого тест-файлу
 * @param {string} code обʼєднаний код тесту
 * @param {string[]} blocks згенеровані describe-блоки
 * @param {RecordWriteFn} recordWrite реєстрація запису для rollback ladder-а
 * @returns {string} шлях записаного тесту
 */
function writeGeneratedTest(dir, testFilePath, code, blocks, recordWrite) {
  const testPath = join(dir, testFilePath)
  mkdirSync(dirname(testPath), { recursive: true })
  recordWrite?.(testPath)
  writeFileSync(testPath, code + '\n', 'utf8')
  console.log(`  ✓ Записано: ${relative(dir, testPath)} (${blocks.length} блоків)`)
  return testPath
}

/**
 * Генерує тест-файл per-export tiered-маршрутизацією:
 *   - cloud для спільного header
 *   - local → cloud fallback для trivial/simple export-ів
 *   - cloud напряму для complex export-ів
 * @param {{file: string, pct: number, reason: string}} fileInfo file coverage info
 * @param {string} dir корінь проєкту
 * @param {PiCallFn} callTextFn cloud LLM-виклик
 * @param {PiCallFn} callLocalFn локальний LLM-виклик
 * @param {RecordWriteFn} recordWrite реєстрація запису для rollback ladder-а
 * @returns {Promise<string|null>} шлях записаного тесту або null
 */
async function generatePerExport(fileInfo, dir, callTextFn, callLocalFn, recordWrite) {
  const ctx = buildPerExportContext(fileInfo, dir)

  console.log(`    header → cloud`)
  const header = await generateSharedHeader(ctx, dir, callTextFn)
  if (!header) return null

  const blocks = []
  const testDir = dirname(join(dir, ctx.testFilePath))
  const blockCtx = { ...ctx, header }
  for (const exp of ctx.exportsWithComplexity) {
    const block = await generateExportBlock(exp, blockCtx, dir, testDir, callTextFn, callLocalFn)
    if (block) blocks.push(block)
  }

  const code = mergeBlocks(header, blocks)
  if (!code) {
    console.error(`  ✗ merge failed for ${ctx.file}`)
    return null
  }

  return writeGeneratedTest(dir, ctx.testFilePath, code, blocks, recordWrite)
}

// ---------------------------------------------------------------------------
// Single-file (fallback) generation
// ---------------------------------------------------------------------------

/**
 * Будує display-only summary-промпт (використовується в тестах).
 * @param {Array<{file: string, pct: number, reason: string}>} files файли для підсумку
 * @param {string} dir корінь проєкту
 * @returns {string} текст summary-промпту
 */
export function buildGenTestsPrompt(files, dir) {
  return files
    .map(({ file, pct, reason }) => {
      const absPath = join(dir, file)
      const content = readSourceSnippet(absPath)
      return (
        `### \`${file}\` (покриття: ${pct.toFixed(1)}%)\n` +
        (reason ? `Причина: ${reason}\n\n` : '') +
        (content ? `\`\`\`js\n${content}\n\`\`\`` : '(вміст недоступний)')
      )
    })
    .join('\n\n')
}

/**
 * Будує single-file промпт (fallback, коли per-export недоступний).
 * @param {{file: string, pct: number, reason: string}} fileInfo file coverage info
 * @param {string} dir корінь проєкту
 * @returns {string} промпт single-file генерації
 */
function buildSingleFilePrompt(fileInfo, dir) {
  const { file, pct: _pct, reason } = fileInfo
  const absPath = join(dir, file)
  const content = readSourceSnippet(absPath)

  const exports = extractExports(content)
  const hasSideEffects = content.length > 0 && TOP_LEVEL_CALL_RE.test(content)

  const existingTestFile = testCandidates(file).find(c => existsSync(join(dir, c)))
  let existingSection = ''
  if (existingTestFile) {
    const tc = readFileSync(join(dir, existingTestFile), 'utf8')
    existingSection = `\n\nІснуючий тест (доповни):\n\`\`\`js\n${tc.slice(0, 3000)}\n\`\`\``
  }

  const { testFilePath, importPath } = resolveTestPaths(file)

  const exportsLine =
    exports.length > 0
      ? `Тестуй ЛИШЕ публічний API (exports): ${exports.join(', ')}`
      : 'Тестуй лише публічні (exported) функції — не приватні деталі реалізації'

  const sideEffectsSection = hasSideEffects
    ? [
        '',
        'УВАГА: модуль має side-effect при завантаженні (виклик функції на рівні модуля).',
        'Встанови env/мок ДО import і використовуй dynamic import:',
        '```js',
        'process.env.KEY = "value"',
        `const { fn } = await import("${importPath}")`,
        '```'
      ]
    : []

  const testRules = findTestRules(dir)

  return [
    `Напиши unit-тест у файл \`${testFilePath}\` для джерела \`${file}\`.`,
    `КРИТИЧНО — імпорт source: \`"${importPath}"\` (тест у \`${testFilePath}\`, source у \`${file}\`)`,
    reason ? `Причина: ${reason}` : '',
    '',
    'Правила (СУВОРО):',
    '- Перший рядок: `import { vi, describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from "vitest"` — включай ЛИШЕ те що реально використовуєш',
    '- Імітуй залежності: `vi.mock("module", () => ({ fn: vi.fn() }))` + `vi.mocked(fn)`',
    '- НІКОЛИ `jest.*`, НІКОЛИ `require()`',
    `- ${exportsLine}`,
    '- Файл .mjs = чистий JavaScript, НЕ TypeScript. НІКОЛИ: `as Type`, `: TypeName`, generics',
    '- Замість `fn as vi.Mock` → `vi.mocked(fn)`',
    '- `vi.spyOn(process, "env")` НЕ ПРАЦЮЄ — для env: `vi.stubEnv("KEY", "val")` + `afterEach(() => vi.unstubAllEnvs())`',
    '- `vi.spyOn(Date).mockReturnValue(...)` НЕ ПРАЦЮЄ з `new Date()` — для часу: `vi.useFakeTimers()` + `vi.setSystemTime(new Date(...))` + `afterEach(() => vi.useRealTimers())`',
    `- Шлях до source файлу відносно тест-файлу: \`${importPath}\` (НЕ \`${file}\`)`,
    '- `describe()` callback НЕ може бути async — `await` тільки у top-level, `beforeAll(async()=>{})`, або `it(async()=>{})`',
    '- Для regex/escape функцій: НЕ ВГАДУЙ складний expected рядок. Тестуй один символ за раз де результат очевидний: `expect(esc("*")).toBe("\\\\*")`, `expect(esc("!")).toBe("\\\\!")`',
    '- Поверни ЛИШЕ код тесту у блоці ```js ... ``` — без пояснень',
    ...sideEffectsSection,
    ...(testRules ? ['', '## Конвенції тестів цього проєкту (.cursor/rules/n-test.mdc):', testRules] : []),
    '',
    `Джерело (\`${file}\`):`,
    '```js',
    content || '(недоступно)',
    '```',
    existingSection
  ]
    .filter(Boolean)
    .join('\n')
}

/**
 * Генерує тест-файл для одного source-файлу через cloud LLM.
 * @param {{file: string, pct: number, reason: string}} fileInfo file coverage info
 * @param {string} dir корінь проєкту
 * @param {PiCallFn} callTextFn cloud LLM-виклик
 * @param {RecordWriteFn} recordWrite реєстрація запису для rollback ladder-а
 * @returns {Promise<string|null>} шлях записаного тесту або null
 */
async function generateOneTest(fileInfo, dir, callTextFn, recordWrite) {
  const prompt = buildSingleFilePrompt(fileInfo, dir)
  let response
  try {
    response = await callTextFn(prompt, { cwd: dir, maxTokens: budgetFor('single-file').maxTokens })
  } catch (error) {
    if (MEMORY_ERROR_RE.test(error.message ?? '')) throw error
    console.error(`  ✗ LLM помилка для ${fileInfo.file}: ${error.message}`)
    return null
  }
  const code = extractCode(response)
  if (!code) {
    console.error(`  ✗ LLM не повернула код для ${fileInfo.file}`)
    return null
  }
  const testPath = join(dir, testCandidates(fileInfo.file)[0])
  mkdirSync(dirname(testPath), { recursive: true })
  recordWrite?.(testPath)
  writeFileSync(testPath, code + '\n', 'utf8')
  console.log(`  ✓ Записано: ${relative(dir, testPath)}`)
  return testPath
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Резолвить ефективний id локальної моделі.
 * @param {GenerateTestsOptions} opts опції генерації
 * @returns {string | null} id локальної моделі або null для cloud-only режиму
 */
function resolveLocalModel(opts) {
  if (opts.localModel !== undefined) return opts.localModel
  return env.N_LOCAL_MIN_MODEL ?? null
}

/**
 * Обробляє один файл усередині зовнішнього циклу генерації.
 * @param {{file: string, pct: number, reason: string}} fileInfo file coverage info
 * @param {string} dir корінь проєкту
 * @param {PiCallFn} callTextFn cloud LLM-виклик
 * @param {PiCallFn | null} localFn локальний LLM-виклик
 * @param {GenerateOneFn | undefined} generateOne кастомний single-file генератор
 * @param {RecordWriteFn} recordWrite реєстрація запису для rollback ladder-а
 * @param {typeof startChain} [makeChain] фабрика ланцюжка (інжект для тестів)
 * @returns {Promise<string|null>} шлях записаного тесту або null
 */
async function generateTestsForFile(
  fileInfo,
  dir,
  callTextFn,
  localFn,
  generateOne,
  recordWrite,
  makeChain = startChain
) {
  console.log(`  → ${fileInfo.file} (${fileInfo.pct.toFixed(1)}%)`)

  if (generateOne) {
    return await generateOne(fileInfo, dir)
  }

  // Ланцюжок файлу: усі виклики (header, per-export local/cloud спроби,
  // vitest-retry, length-retry) — кроки одного chain.
  const chain = makeChain({ kind: 'test-generate', unit: fileInfo.file, cwd: dir })
  const chainedCloud = (prompt, callOpts = {}) => callTextFn(prompt, { ...callOpts, chain })
  const chainedLocal = localFn ? (prompt, callOpts = {}) => localFn(prompt, { ...callOpts, chain }) : null
  let failed = null
  try {
    const exportsInfo = extractExportsWithComplexity(readSourceSnippet(join(dir, fileInfo.file)))
    if (chainedLocal && exportsInfo.length > 0) {
      return await generatePerExport(fileInfo, dir, chainedCloud, chainedLocal, recordWrite)
    }

    return await generateOneTest(fileInfo, dir, chainedCloud, recordWrite)
  } catch (error) {
    failed = String(error.message ?? error).slice(0, 200)
    throw error
  } finally {
    chain.end({ outcome: failed ? 'fail' : 'success', extra: failed ? { error: failed } : {} })
  }
}

/**
 * Генерує тести для всіх переданих файлів.
 * Per-export tiered-маршрутизація коли доступна локальна модель;
 * інакше — single-file cloud-генерація. Повертає записані файли для
 * `touchedFiles`-контракту fix-worker-а.
 * @param {Array<{file: string, pct: number, reason: string}>} files файли для генерації тестів
 * @param {string} dir корінь проєкту
 * @param {GenerateTestsOptions} [opts] опції генерації
 * @returns {Promise<{touchedFiles: string[]}>} абсолютні шляхи записаних тест-файлів
 */
export async function generateTests(files, dir, opts = {}) {
  if (files.length === 0) return { touchedFiles: [] }

  const callTextFn = opts.callText ?? callText
  const recordWrite = opts.recordWrite ?? null
  const localModel = resolveLocalModel(opts)
  const localFn = localModel
    ? (prompt, callOpts = {}) => callTextFn(prompt, { ...callOpts, model: localModel, cwd: dir })
    : null

  const mode = localFn ? `per-export (local:${localModel} + cloud)` : 'single-file (cloud)'
  console.log(`\n🤖 Генерую тести для ${files.length} файлів [${mode}]...\n`)

  const touchedFiles = []
  for (const fileInfo of files) {
    // Дедлайн ladder-а: новий файл не стартує після нього — конвергенцію
    // жене ядро повторними rung-ами, не власний retry-цикл.
    if (opts.deadlineAt && Date.now() >= opts.deadlineAt) break
    const written = await generateTestsForFile(fileInfo, dir, callTextFn, localFn, opts.generateOne, recordWrite)
    if (written) touchedFiles.push(written)
  }
  return { touchedFiles }
}
