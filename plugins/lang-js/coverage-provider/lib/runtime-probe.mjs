/**
 * Runtime probing of exported functions.
 *
 * Three probe strategies — all best-effort (return {} on any failure):
 *
 * 1. probeModule  — calls each export with edge-case primitives, returns actual outputs.
 * 2. probeFetchCalls — intercepts globalThis.fetch to capture real URL/init per export.
 * 3. probeTimeVariants — runs each export at hours [0,9,14,22], reports time-sensitive ones.
 * 4. probeHelpers — extracts non-exported helper functions from source and calls them
 *    with generic param combos to reveal their actual output shapes.
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const PROBE_TIMEOUT_MS = 10_000
/**
 * Кап на серіалізований probe-вихід (символів). Довший вихід замінюється
 * shape-summary — стислим описом форми замість значення: гігантський дамп
 * (напр. функція, що читає файл проєкту) інакше роздуває LLM-промпт до
 * сотень тисяч символів і впирається в memory guard моделі, а обрізаний
 * JSON модель копіює в expected як сміття.
 */
const PROBE_OUTPUT_MAX_CHARS = 600
/** Максимум probe-рядків на один export — багато середніх виходів теж не мають роздувати промпт. */
const PROBE_MAX_ENTRIES_PER_EXPORT = 12
/** Глибина рекурсії shape-summary. */
const SHAPE_MAX_DEPTH = 4
/** Скільки ключів об'єкта показує shape-summary до «…». */
const SHAPE_MAX_KEYS = 8

/** Generic argument combos to try when probing async/fetch functions. */
const FETCH_ARG_COMBOS = [
  ['test text'],
  ['test text', {}],
  ['test text', { id: 'test_id' }],
  ['test text', { chat_id: 'test_id' }],
  ['test', 'test_id'],
  [null]
]

/** Hours sampled for time-variant detection. */
const PROBE_HOURS = [0, 9, 14, 22]

/** Generic param combos for internal helper introspection. */
const HELPER_PARAM_COMBOS = [
  {},
  { id: 'test_id' },
  { chat_id: 'custom' },
  { silent: true },
  { parse_mode: 'HTML' },
  { chat_id: 'custom', parse_mode: 'MarkdownV2', silent: true }
]

/**
 * Edge-case inputs used for all function probes.
 * Each entry: [jsLiteral, displayRepr]
 */
const PROBE_INPUTS = [
  ['null', 'null'],
  ['undefined', 'undefined'],
  ['""', '""'],
  ['"*"', '"*"'],
  ['"_"', '"_"'],
  ['"["', '"["'],
  ['"]"', '"]"'],
  ['"("', '"("'],
  ['")"', '")"'],
  ['"~"', '"~"'],
  ['"`"', '"`"'],
  ['">"', '">"'],
  ['"#"', '"#"'],
  ['"+"', '"+"'],
  ['"-"', '"-"'],
  ['"="', '"="'],
  ['"|"', '"|"'],
  ['"{"', '"{"'],
  ['"}"', '"}"'],
  ['"."', '"."'],
  ['"!"', '"!"'],
  [String.raw`"\\"`, String.raw`"\\"`],
  ['"hello"', '"hello"'],
  ['"hello world"', '"hello world"'],
  ['0', '0'],
  ['42', '42']
]

/**
 * Рекурсивно описує форму значення без самих даних.
 * @param {unknown} value розпарсене JSON-значення
 * @param {number} [depth] залишкова глибина рекурсії; за замовчуванням `SHAPE_MAX_DEPTH`
 * @returns {string} стислий опис форми, напр. `Array(34) of {file: string, mutants: Array(12)}`
 */
export function describeShape(value, depth = SHAPE_MAX_DEPTH) {
  if (value === null) return 'null'
  if (Array.isArray(value)) {
    if (value.length === 0) return 'Array(0)'
    if (depth <= 0) return `Array(${value.length})`
    return `Array(${value.length}) of ${describeShape(value[0], depth - 1)}`
  }
  const type = typeof value
  if (type === 'object') {
    const keys = Object.keys(value)
    if (depth <= 0 || keys.length === 0) return 'Object'
    const shown = keys.slice(0, SHAPE_MAX_KEYS)
    const inner =
      depth > 1 ? shown.map(k => `${k}: ${describeShape(value[k], depth - 1)}`).join(', ') : shown.join(', ')
    return `{${inner}${keys.length > shown.length ? ', …' : ''}}`
  }
  if (type === 'string') return 'string'
  return type
}

/**
 * Обмежує серіалізований probe-вихід: до `PROBE_OUTPUT_MAX_CHARS` — без змін,
 * довший — shape-summary замість значення (модель бачить структуру для
 * asserts на форму, але не тягне дамп у промпт і не копіює його в expected).
 * @param {string} serialized JSON-серіалізований вихід probe
 * @returns {string} оригінал або `[shape-summary, ~N chars] <форма>`
 */
export function capProbeOutput(serialized) {
  if (typeof serialized !== 'string' || serialized.length <= PROBE_OUTPUT_MAX_CHARS) return serialized
  let shape
  try {
    shape = describeShape(JSON.parse(serialized))
  } catch {
    shape = 'string'
  }
  const summary = `[shape-summary, ~${serialized.length} chars] ${shape}`
  return summary.length > PROBE_OUTPUT_MAX_CHARS ? `${summary.slice(0, PROBE_OUTPUT_MAX_CHARS - 1)}…` : summary
}

/**
 * Застосовує кап виходів і ліміт кількості рядків до результатів `probeModule`.
 * @param {Record<string, Array<{input: string, output: string}> | {constant: string}>} results сирі результати з дочірнього процесу
 * @returns {typeof results} результати з capped-виходами
 */
function capModuleResults(results) {
  const capped = {}
  for (const [name, section] of Object.entries(results)) {
    if (Array.isArray(section)) {
      capped[name] = section
        .slice(0, PROBE_MAX_ENTRIES_PER_EXPORT)
        .map(entry => ({ ...entry, output: capProbeOutput(entry.output) }))
    } else if (section && typeof section === 'object' && 'constant' in section) {
      capped[name] = { constant: capProbeOutput(section.constant) }
    } else {
      capped[name] = section
    }
  }
  return capped
}

/**
 * Запускає node з probe-скриптом у порожній тимчасовій cwd: відносні
 * I/O-читання функцій під probe (напр. `readFile('COVERAGE.md')` при
 * порожньому аргументі шляху) не бачать файлів проєкту — вихід
 * детермінований між машинами і не може випадково затягнути великий
 * файл репозиторію у LLM-промпт.
 * @param {string} script код для виконання
 * @param {number} [timeout] ліміт очікування в мс; за замовчуванням `PROBE_TIMEOUT_MS`
 * @returns {import('node:child_process').SpawnSyncReturns<string>} результат spawnSync
 */
function spawnProbe(script, timeout = PROBE_TIMEOUT_MS) {
  const cwd = mkdtempSync(join(tmpdir(), 'n-probe-'))
  try {
    return spawnSync('node', ['--input-type=module'], {
      input: script,
      encoding: 'utf8',
      timeout,
      env: { ...process.env },
      cwd
    })
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
}

/**
 * Пробує експорти модуля у дочірньому процесі й повертає фактичні виходи.
 * @param {string} absFilePath абсолютний шлях до джерела модуля
 * @param {string[]} exportedNames назви експортів для probing
 * @param {string[]} [envKeys] ключі env, які треба підставити test-значеннями; за замовчуванням порожній список
 * @returns {Record<string, Array<{input: string, output: string}> | {constant: string}>} фактичні probe-результати для кожного export
 */
export function probeModule(absFilePath, exportedNames, envKeys = []) {
  const envStubs = envKeys.map(k => `process.env[${JSON.stringify(k)}] = '__probe__'`).join('\n')

  const script = `
import { createRequire } from 'node:module'
${envStubs}
globalThis.fetch = async () => ({ status: 200, json: async () => ({}) })

const probeInputs = ${JSON.stringify(PROBE_INPUTS)}
const names = ${JSON.stringify(exportedNames)}
const filePath = ${JSON.stringify(absFilePath)}

let mod
try {
  mod = await import(filePath)
} catch (e) {
  process.stdout.write(JSON.stringify({ __importError: e.message }))
  process.exit(0)
}

const results = {}
for (const name of names) {
  const val = mod[name]
  if (typeof val === 'function') {
    results[name] = []
    for (const [inputLiteral, repr] of probeInputs) {
      let input
      // safe eval of primitive literals
      try { input = new Function('return ' + inputLiteral)() } catch { continue }
      try {
        const out = await Promise.resolve(val(input))
        if (out !== undefined) {
          results[name].push({ input: repr, output: JSON.stringify(out) })
        }
      } catch {
        // skip — function threw on this input
      }
    }
  } else if (val !== undefined) {
    try { results[name] = { constant: JSON.stringify(val) } } catch { /* skip non-serializable */ }
  }
}
process.stdout.write(JSON.stringify(results))
`

  const proc = spawnProbe(script)

  if (!proc.stdout) return {}
  try {
    const parsed = JSON.parse(proc.stdout)
    if (parsed.__importError) return {}
    return capModuleResults(parsed)
  } catch {
    return {}
  }
}

// ---------------------------------------------------------------------------
// Helper: run an isolated node ESM script and parse JSON stdout
// ---------------------------------------------------------------------------

/**
 * Запускає ізольований node ESM script і парсить JSON зі stdout.
 * @param {string} script код для виконання
 * @param {number} [timeout] ліміт очікування в мс; за замовчуванням `PROBE_TIMEOUT_MS`
 * @returns {Record<string, unknown> | null} розпарсений JSON або `null` при помилці
 */
function runProbeScript(script, timeout = PROBE_TIMEOUT_MS) {
  const proc = spawnProbe(script, timeout)
  if (!proc.stdout) return null
  try {
    const parsed = JSON.parse(proc.stdout)
    return parsed.__importError ? null : parsed
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Probe 2: fetch-capture
// ---------------------------------------------------------------------------

/**
 * Перехоплює `fetch` і збирає реальні URL/init, які будує кожен export.
 * @param {string} absFilePath абсолютний шлях до джерела модуля
 * @param {string[]} exportedNames назви експортів для probing
 * @param {string[]} [envKeys] env-ключі, які треба підмінити `test_value`; за замовчуванням порожній список
 * @returns {Record<string, Array<{args: string, url: string, init: unknown}>>} зібрані fetch-виклики по export
 */
export function probeFetchCalls(absFilePath, exportedNames, envKeys = []) {
  const envStubs = envKeys.map(k => `process.env[${JSON.stringify(k)}] = 'test_value'`).join('\n')

  const script = `
${envStubs}
const __calls = []
globalThis.fetch = async (url, init) => {
  __calls.push({ url: String(url), init: init ?? null })
  return { status: 200, json: async () => ({}) }
}

let mod
try { mod = await import(${JSON.stringify(absFilePath)}) }
catch (e) { process.stdout.write(JSON.stringify({ __importError: e.message })); process.exit(0) }

const argCombos = ${JSON.stringify(FETCH_ARG_COMBOS)}
const results = {}

for (const name of ${JSON.stringify(exportedNames)}) {
  const fn = mod[name]
  if (typeof fn !== 'function') continue
  for (const args of argCombos) {
    __calls.length = 0
    try { await Promise.resolve(fn(...args)) } catch { /* ignore */ }
    if (__calls.length > 0) {
      results[name] = __calls.map(c => ({ args: JSON.stringify(args), url: c.url, init: c.init }))
      break
    }
  }
}
process.stdout.write(JSON.stringify(results))
`
  return runProbeScript(script) ?? {}
}

/**
 * Застосовує кап до результатів `probeHelpers`: завеликий `result`
 * замінюється shape-summary рядком, кількість комбо на helper обмежується.
 * @param {Record<string, Array<{params: Record<string, unknown>, result: unknown}>>} results сирі результати helper-probe
 * @returns {typeof results} результати з capped-виходами
 */
function capHelperResults(results) {
  const capped = {}
  for (const [name, entries] of Object.entries(results)) {
    if (!Array.isArray(entries)) {
      capped[name] = entries
      continue
    }
    capped[name] = entries.slice(0, PROBE_MAX_ENTRIES_PER_EXPORT).map(entry => {
      let serialized
      try {
        serialized = JSON.stringify(entry.result)
      } catch {
        return entry
      }
      if (typeof serialized !== 'string' || serialized.length <= PROBE_OUTPUT_MAX_CHARS) return entry
      return { ...entry, result: capProbeOutput(serialized) }
    })
  }
  return capped
}

// ---------------------------------------------------------------------------
// Probe 3: time-variant detection
// ---------------------------------------------------------------------------

/**
 * Запускає кожен export у кількох годинах доби й повертає time-sensitive варіанти.
 * @param {string} absFilePath абсолютний шлях до джерела модуля
 * @param {string[]} exportedNames назви експортів для probing
 * @param {string[]} [envKeys] env-ключі, які треба підмінити `test_value`; за замовчуванням порожній список
 * @returns {Record<string, Record<number, string>>} лише exports, чий вихід змінюється залежно від години
 */
export function probeTimeVariants(absFilePath, exportedNames, envKeys = []) {
  const envStubs = envKeys.map(k => `process.env[${JSON.stringify(k)}] = 'test_value'`).join('\n')

  // Use generic arg combos (same as fetch probe) to get meaningful calls
  const script = `
${envStubs}

let mod
try { mod = await import(${JSON.stringify(absFilePath)}) }
catch (e) { process.stdout.write(JSON.stringify({ __importError: e.message })); process.exit(0) }

const hours = ${JSON.stringify(PROBE_HOURS)}
const argCombos = ${JSON.stringify(FETCH_ARG_COMBOS)}
const results = {}

for (const name of ${JSON.stringify(exportedNames)}) {
  const fn = mod[name]
  if (typeof fn !== 'function') continue
  const byHour = {}
  for (const h of hours) {
    const fixedMs = new Date('2024-01-15T00:00:00').setHours(h, 0, 0, 0)
    const Orig = globalThis.Date
    globalThis.Date = class FakeDate extends Orig {
      constructor(...a) { super(...(a.length ? a : [fixedMs])) }
      static now() { return fixedMs }
    }
    Object.setPrototypeOf(globalThis.Date, Orig)
    // Capture fetch URL (more informative than return value for side-effectful fns)
    let captured = null
    globalThis.fetch = async (url) => { captured = String(url); return { status: 200, json: async () => ({}) } }
    try {
      for (const args of argCombos) {
        captured = null
        try { await Promise.resolve(fn(...args)) } catch { /* ignore */ }
        if (captured) break
      }
      byHour[h] = captured ?? '__no_fetch__'
    } catch {
      byHour[h] = '__error__'
    } finally {
      globalThis.Date = Orig
    }
  }
  // Report only functions where fetch URL changes across hours
  const fetched = Object.values(byHour).filter(v => v !== '__no_fetch__' && v !== '__error__')
  if (fetched.length > 0 && new Set(fetched).size > 1) results[name] = byHour
}
process.stdout.write(JSON.stringify(results))
`
  return runProbeScript(script) ?? {}
}

// ---------------------------------------------------------------------------
// Probe 4: internal helper introspection
// ---------------------------------------------------------------------------

/**
 * Знаходить початок top-level declaration для helper-а в source.
 * @param {string} source текст модуля
 * @param {string} name назва helper-а
 * @returns {number} індекс початку або `-1`, якщо declaration не знайдено
 */
function findDeclarationStart(source, name) {
  const prefixes = [`const ${name} =`, `let ${name} =`, `var ${name} =`, `function ${name}(`, `async function ${name}(`]
  let start = -1
  for (const prefix of prefixes) {
    const direct = source.indexOf(prefix)
    if (direct !== -1 && (start === -1 || direct < start)) start = direct
    const lineStart = source.indexOf(`\n${prefix}`)
    if (lineStart !== -1) {
      const candidate = lineStart + 1
      if (start === -1 || candidate < start) start = candidate
    }
  }
  return start
}

/**
 * Знаходить межу до наступної top-level declaration.
 * @param {string} sourceTail текст після declaration
 * @returns {number} індекс межі або `-1`, якщо наступної declaration немає
 */
function findNextDeclarationEnd(sourceTail) {
  const markers = ['\nconst ', '\nlet ', '\nvar ', '\nfunction ', '\nasync function ', '\nexport ']
  let end = -1
  for (const marker of markers) {
    const idx = sourceTail.indexOf(marker)
    if (idx !== -1 && (end === -1 || idx < end)) end = idx
  }
  return end
}

/**
 * Витягує top-level declaration helper-а з source.
 * @param {string} source текст модуля
 * @param {string} name назва helper-а
 * @param {number} [maxLength] максимальна довжина fallback-сніпета; за замовчуванням `800`
 * @returns {string|null} сніпет helper-а або `null`, якщо declaration не знайдено
 */
function extractHelperSource(source, name, maxLength = 800) {
  const start = findDeclarationStart(source, name)
  if (start === -1) return null
  const after = source.slice(start)
  const next = findNextDeclarationEnd(after)
  return after.slice(0, next === -1 ? Math.min(after.length, maxLength) : next)
}

/**
 * Витягує неекспортовані helper-и з source та проганяє їх крізь generic param combos.
 * Best-effort: повертає `{}` при будь-якій помилці.
 * @param {string} absFilePath абсолютний шлях до source-модуля
 * @param {string[]} helperNames назви internal (non-exported) helper-ів
 * @param {string[]} [envKeys] env-ключі, які треба підмінити `test_value`; за замовчуванням порожній список
 * @returns {Record<string, Array<{params: Record<string, unknown>, result: unknown}>>} результати probe для кожного helper-а
 */
export function probeHelpers(absFilePath, helperNames, envKeys = []) {
  if (!helperNames.length) return {}

  let source
  try {
    source = readFileSync(absFilePath, 'utf8')
  } catch {
    return {}
  }

  const extracted = {}
  for (const name of helperNames) {
    const snippet = extractHelperSource(source, name)
    if (snippet) extracted[name] = snippet
  }

  if (Object.keys(extracted).length === 0) return {}

  const envStubs = envKeys.map(k => `process.env[${JSON.stringify(k)}] = 'test_value'`).join('\n')
  const helperDefs = Object.values(extracted).join('\n\n')
  const combos = JSON.stringify(HELPER_PARAM_COMBOS)
  const names = JSON.stringify(Object.keys(extracted))

  const script = `
import { env } from 'node:process'
${envStubs}

${helperDefs}

const combos = ${combos}
const results = {}
for (const name of ${names}) {
  const fns = { ${Object.keys(extracted)
    .map(n => `${n}: typeof ${n} !== 'undefined' ? ${n} : null`)
    .join(', ')} }
  const fn = fns[name]
  if (typeof fn !== 'function') continue
  results[name] = []
  for (const params of combos) {
    try {
      const r = fn(params)
      results[name].push({ params, result: JSON.parse(JSON.stringify(r)) })
    } catch {
      // helper threw on this combo — skip
    }
  }
}
process.stdout.write(JSON.stringify(results))
`
  return capHelperResults(runProbeScript(script) ?? {})
}
