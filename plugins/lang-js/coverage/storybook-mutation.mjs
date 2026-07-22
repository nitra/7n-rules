/**
 * Mutation testing для Storybook-покритого коду (vitest browser mode) — власний
 * mutate→run→restore executor замість Stryker vitest-runner, який не підтримує
 * сучасний Playwright-based browser mode (див. коментар над collectStorybookForRoot
 * у js-collector.mjs).
 *
 * Патерн підтверджений дослідженням спільноти (alexop.dev, Mutahunter, Meta ACH):
 * мутанти генеруються детерміновано, а вбиває/милує ЛИШЕ реальний прогін тестів —
 * жодного LLM-суддівства pass/fail. Цикл на мутант: записати мутований файл →
 * `vitest run --project=storybook [сторі-фільтр]` → KILLED (exit ≠ 0) / SURVIVED
 * (exit 0) / TIMEOUT (kill за таймаутом, рахується як caught — мутант зламав
 * поведінку до зависання) → відновити оригінал у `finally`.
 *
 * Генерація мутантів — AST-based (rollup `parseAst`, ESTree-shaped, вже у deps),
 * без regex-хибняків у рядках/коментарях. Оператори — 5 тірів за ймовірністю
 * виживання (catalog citypaul/alexop): boundary → logical → equality → literals/return
 * → arithmetic. Мутуються лише рядки, покриті сторі (lcov `DA:`), з бюджетом
 * (maxPerFile/maxTotal) — browser-mode прогін коштує секунди на мутант.
 *
 * `.vue` SFC: мутується лише вміст `<script>`/`<script setup>` блоку (template поза
 * скоупом). `lang="ts"`-скрипти, які parseAst не бере, тихо пропускаються (0 мутантів).
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { isAbsolute, join, relative } from 'node:path'
import { parseAst } from './lib/parse-ast.mjs'

/** Дефолтна стеля детермінованих мутантів на файл (тіри з нижчих номерів мають пріоритет). */
const DEFAULT_MAX_PER_FILE = 8
/** Дефолтна стеля додаткових (LLM-запропонованих) мутантів на файл — поверх детермінованої. */
const DEFAULT_MAX_EXTRA_PER_FILE = 3
/** Дефолтна стеля мутантів на весь прогін (спільна для обох джерел). */
const DEFAULT_MAX_TOTAL = 32
/** Мінімальний таймаут одного мутант-прогону (браузер холодний старт). */
const MIN_TIMEOUT_MS = 30_000

const SCRIPT_BLOCK_RE = /<script[^>]*>([\s\S]*?)<\/script>/
const SCRIPT_LANG_TS_RE = /<script[^>]*\blang\s*=\s*["']ts["'][^>]*>/
const VUE_FILE_RE = /\.vue$/

/** Заміни операторів за тірами: tier 1 boundary, 2 logical, 3 equality, 5 arithmetic. */
const BINARY_SWAPS = {
  '<': { to: '<=', tier: 1, type: 'ConditionalExpression' },
  '<=': { to: '<', tier: 1, type: 'ConditionalExpression' },
  '>': { to: '>=', tier: 1, type: 'ConditionalExpression' },
  '>=': { to: '>', tier: 1, type: 'ConditionalExpression' },
  '===': { to: '!==', tier: 3, type: 'EqualityOperator' },
  '!==': { to: '===', tier: 3, type: 'EqualityOperator' },
  '==': { to: '!=', tier: 3, type: 'EqualityOperator' },
  '!=': { to: '==', tier: 3, type: 'EqualityOperator' },
  '-': { to: '+', tier: 5, type: 'ArithmeticOperator' },
  '*': { to: '/', tier: 5, type: 'ArithmeticOperator' },
  '/': { to: '*', tier: 5, type: 'ArithmeticOperator' }
}
const LOGICAL_SWAPS = {
  '&&': { to: '||', tier: 2, type: 'LogicalOperator' },
  '||': { to: '&&', tier: 2, type: 'LogicalOperator' }
}

/**
 * Парс lcov.info у мапу «файл → покриті рядки» з `SF:`/`DA:<line>,<hits>` records.
 * Шляхи рібейзяться відносно `baseDir` (lcov типово містить абсолютні шляхи).
 * @param {string} text вміст lcov.info
 * @param {string} baseDir корінь, відносно якого рібейзити шляхи (jsRoot)
 * @returns {Map<string, Set<number>>} relative-шлях → множина покритих (hits > 0) рядків
 */
export function parseLcovCoveredLines(text, baseDir) {
  const map = new Map()
  let currentFile = null
  let lines = null
  for (const line of text.split('\n')) {
    if (line.startsWith('SF:')) {
      const raw = line.slice(3).trim()
      currentFile = isAbsolute(raw) ? relative(baseDir, raw) : raw
      lines = new Set()
    } else if (line.startsWith('DA:') && lines) {
      const comma = line.indexOf(',', 3)
      const hits = Number(line.slice(comma + 1))
      if (hits > 0) lines.add(Number(line.slice(3, comma)))
    } else if (line === 'end_of_record' && currentFile) {
      if (lines.size > 0 && !currentFile.startsWith('..')) map.set(currentFile, lines)
      currentFile = null
      lines = null
    }
  }
  return map
}

/**
 * Витягує JS-вміст для мутації: для `.vue` — перший `<script>`-блок (без TS),
 * для решти — увесь файл. Експортовано для LLM-джерела мутантів
 * (storybook-mutation-llm.mjs) — той самий скоуп і синтакс-валідація.
 * @param {string} file відносний шлях файлу
 * @param {string} source повний вміст файлу
 * @returns {{code: string, offset: number} | null} код і зсув початку в повному файлі, або null (TS-скрипт / нема script-блоку)
 */
export function extractMutableCode(file, source) {
  if (!VUE_FILE_RE.test(file)) return { code: source, offset: 0 }
  if (SCRIPT_LANG_TS_RE.test(source)) return null
  const m = SCRIPT_BLOCK_RE.exec(source)
  if (!m) return null
  return { code: m[1], offset: m.index + m[0].indexOf(m[1]) }
}

/**
 * Індекс початків рядків для перекладу offset → {line, col} (line 1-indexed, col 0-indexed).
 * @param {string} source повний вміст файлу
 * @returns {number[]} зростаючі offsets початку кожного рядка
 */
function buildLineIndex(source) {
  const starts = [0]
  for (let i = 0; i < source.length; i++) {
    if (source[i] === '\n') starts.push(i + 1)
  }
  return starts
}

/**
 * Переводить абсолютний offset у позицію {line, col}.
 * @param {number[]} lineStarts індекс із buildLineIndex
 * @param {number} offset абсолютний offset у файлі
 * @returns {{line: number, col: number}} line 1-indexed, col 0-indexed
 */
function offsetToPosition(lineStarts, offset) {
  let lo = 0
  let hi = lineStarts.length - 1
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2)
    if (lineStarts[mid] <= offset) lo = mid
    else hi = mid - 1
  }
  return { line: lo + 1, col: offset - lineStarts[lo] }
}

/**
 * Рекурсивний обхід ESTree-вузлів.
 * @param {object} node AST-вузол
 * @param {(node: object) => void} visit колбек для кожного вузла з type
 * @returns {void}
 */
function walkAst(node, visit) {
  if (!node || typeof node !== 'object') return
  if (Array.isArray(node)) {
    for (const child of node) walkAst(child, visit)
    return
  }
  if (typeof node.type === 'string') visit(node)
  for (const key of Object.keys(node)) {
    if (key === 'type' || key === 'start' || key === 'end') continue
    walkAst(node[key], visit)
  }
}

/**
 * Мутація оператора binary/logical-виразу: знаходить текст оператора між
 * `left.end` і `right.start` і формує splice-заміну.
 * @param {object} node BinaryExpression/LogicalExpression вузол
 * @param {string} code повний вміст файлу
 * @param {{to: string, tier: number, type: string}} swap правило заміни
 * @returns {{start: number, end: number, text: string, tier: number, mutantType: string} | null} splice або null, якщо оператор не знайдено текстуально
 */
function operatorMutation(node, code, swap) {
  const between = code.slice(node.left.end, node.right.start)
  const at = between.indexOf(node.operator)
  if (at === -1) return null
  const start = node.left.end + at
  return { start, end: start + node.operator.length, text: swap.to, tier: swap.tier, mutantType: swap.type }
}

/**
 * Генерує детерміновані мутанти для одного файлу (AST-based, лише покриті рядки).
 * Тіри (пріоритет відбору): 1 boundary (`<`↔`<=`…), 2 logical (`&&`↔`||`, зняття `!`),
 * 3 equality (`===`↔`!==`…), 4 literals/return (`true`↔`false`, `return X`→`return null`),
 * 5 arithmetic (`-`↔`+`, `*`↔`/`). `+` свідомо не мутується (string-concat дає шумні
 * псевдо-еквівалентні мутанти).
 * @param {string} file відносний шлях (для .vue-детекції)
 * @param {string} source повний вміст файлу
 * @param {Set<number>} coveredLines покриті сторі рядки (1-indexed, з lcov DA)
 * @returns {Array<{line: number, col: number, mutantType: string, original: string, replacement: string, start: number, end: number, text: string, tier: number}>} мутанти, відсортовані за (tier, line)
 */
export function generateMutants(file, source, coveredLines) {
  const extracted = extractMutableCode(file, source)
  if (!extracted) return []

  let ast
  try {
    ast = parseAst(extracted.code)
  } catch {
    return [] // синтаксис поза parseAst (TS у .js тощо) — тихо без мутантів
  }

  const lineStarts = buildLineIndex(source)
  const splices = []

  walkAst(ast, node => {
    if (node.type === 'BinaryExpression' && BINARY_SWAPS[node.operator]) {
      const m = operatorMutation(node, extracted.code, BINARY_SWAPS[node.operator])
      if (m) splices.push(m)
    } else if (node.type === 'LogicalExpression' && LOGICAL_SWAPS[node.operator]) {
      const m = operatorMutation(node, extracted.code, LOGICAL_SWAPS[node.operator])
      if (m) splices.push(m)
    } else if (node.type === 'UnaryExpression' && node.operator === '!' && node.prefix) {
      splices.push({ start: node.start, end: node.argument.start, text: '', tier: 2, mutantType: 'BooleanNegation' })
    } else if (node.type === 'Literal' && (node.value === true || node.value === false)) {
      splices.push({
        start: node.start,
        end: node.end,
        text: String(!node.value),
        tier: 4,
        mutantType: 'BooleanLiteral'
      })
    } else if (node.type === 'ReturnStatement' && node.argument && node.argument.raw !== 'null') {
      splices.push({
        start: node.argument.start,
        end: node.argument.end,
        text: 'null',
        tier: 4,
        mutantType: 'ReturnValue'
      })
    }
  })

  const mutants = []
  for (const s of splices) {
    const absStart = extracted.offset + s.start
    const absEnd = extracted.offset + s.end
    const pos = offsetToPosition(lineStarts, absStart)
    if (!coveredLines.has(pos.line)) continue
    mutants.push({
      line: pos.line,
      col: pos.col,
      mutantType: s.mutantType,
      original: source.slice(absStart, absEnd),
      replacement: s.text,
      start: absStart,
      end: absEnd,
      text: s.text,
      tier: s.tier
    })
  }
  return mutants.toSorted((a, b) => a.tier - b.tier || a.line - b.line || a.col - b.col)
}

/**
 * Об'єднує детерміновані мутанти з додатковими (LLM-запропонованими), відкидаючи
 * лише ТОЧНІ дублі (той самий [start, end) і та сама заміна). Перетин діапазонів —
 * не дубль: мутація `5` всередині `return x < 5` і заміна всього аргументу на `null`
 * — різні мутанти, обидва цінні.
 * @param {Array<{start: number, end: number, text: string}>} deterministic детерміновані мутанти (пріоритет)
 * @param {Array<{start: number, end: number, text: string}>} extra додаткові мутанти
 * @returns {Array<object>} deterministic + недубльовані extra
 */
function mergeMutants(deterministic, extra) {
  const merged = [...deterministic]
  for (const e of extra) {
    const duplicate = deterministic.some(d => d.start === e.start && d.end === e.end && d.text === e.text)
    if (!duplicate) merged.push(e)
  }
  return merged
}

/**
 * Виконує mutate→run→restore цикл для набору файлів одного Storybook-root.
 *
 * Гарантія відновлення: оригінальний вміст тримається в пам'яті і записується назад
 * у `finally` після КОЖНОГО мутанта — жоден наступний прогін не бачить попередню
 * мутацію, а креш процесу лишає щонайбільше один мутований файл (відновлюється
 * `git checkout`, файл завжди у git — ми мутуємо лише tracked production-код).
 *
 * Класифікація: exit 0 → survived; exit ≠ 0 → killed; null status (kill за
 * таймаутом spawnSync) → timeout, рахується як caught (мутант завісив виконання).
 *
 * `proposeExtraMutants` (опційно) — друге джерело мутантів (LLM, Mutahunter/ACH-патерн):
 * ПРОПОНУЄ додаткові bug-like мутанти, але вбиває/милує так само лише реальний прогін.
 * Додаткові мутанти мають ВЛАСНУ стелю (`maxExtraPerFile`) поверх детермінованої і
 * дедуплікуються проти детермінованих за діапазоном; помилки хука (нема API-ключа
 * тощо) — відповідальність самого хука (тут не ловляться).
 * @param {object} opts опції прогону
 * @param {string} opts.jsRoot абсолютний шлях workspace-кореня
 * @param {string[]} opts.files відносні (до jsRoot) шляхи production-файлів для мутації
 * @param {Map<string, Set<number>>} opts.coveredLines файл → покриті рядки (parseLcovCoveredLines)
 * @param {(args: {cwd: string, storyFilter: string|null, timeoutMs: number}) => number|null} opts.runMutantTest прогін тестів проти мутованого дерева; повертає exit code або null при таймауті
 * @param {(file: string) => string|null} [opts.resolveStoryFilter] відносний шлях сторі-файлу компонента для звуження прогону (null = увесь storybook-проєкт)
 * @param {(file: string, source: string, coveredLines: Set<number>) => Promise<Array<object>>} [opts.proposeExtraMutants] друге джерело мутантів у тому ж shape, що generateMutants
 * @param {number} [opts.timeoutMs] таймаут одного мутант-прогону
 * @param {number} [opts.maxPerFile] стеля детермінованих мутантів на файл
 * @param {number} [opts.maxExtraPerFile] стеля додаткових (LLM) мутантів на файл
 * @param {number} [opts.maxTotal] стеля мутантів на прогін (спільна для обох джерел)
 * @returns {Promise<{caught: number, total: number, survived: Array<{file: string, mutants: Array<{line: number, col: number, mutantType: string, original: string, replacement: string}>, exampleTest: null, recommendationText: null}>}>} результат у shape parseStrykerReport
 */
export async function runStorybookMutation(opts) {
  const {
    jsRoot,
    files,
    coveredLines,
    runMutantTest,
    resolveStoryFilter = () => null,
    proposeExtraMutants = null,
    timeoutMs = MIN_TIMEOUT_MS,
    maxPerFile = DEFAULT_MAX_PER_FILE,
    maxExtraPerFile = DEFAULT_MAX_EXTRA_PER_FILE,
    maxTotal = DEFAULT_MAX_TOTAL
  } = opts

  let caught = 0
  let total = 0
  let budget = maxTotal
  const survived = []

  for (const file of files) {
    if (budget <= 0) break
    const lines = coveredLines.get(file)
    if (!lines || lines.size === 0) continue

    const absPath = join(jsRoot, file)
    let source
    try {
      source = readFileSync(absPath, 'utf8')
    } catch {
      continue
    }

    const deterministic = generateMutants(file, source, lines).slice(0, maxPerFile)
    const proposed = proposeExtraMutants ? await proposeExtraMutants(file, source, lines) : []
    const mutants = mergeMutants(deterministic, proposed.slice(0, maxExtraPerFile)).slice(0, budget)
    if (mutants.length === 0) continue
    budget -= mutants.length

    const storyFilter = resolveStoryFilter(file)
    const survivedInFile = []

    for (const mutant of mutants) {
      const mutated = source.slice(0, mutant.start) + mutant.text + source.slice(mutant.end)
      let status
      try {
        writeFileSync(absPath, mutated, 'utf8')
        status = runMutantTest({ cwd: jsRoot, storyFilter, timeoutMs })
      } finally {
        writeFileSync(absPath, source, 'utf8')
      }

      total += 1
      if (status === 0) {
        survivedInFile.push({
          line: mutant.line,
          col: mutant.col,
          mutantType: mutant.mutantType,
          original: mutant.original,
          replacement: mutant.replacement
        })
      } else {
        caught += 1 // non-zero exit АБО timeout (null) — мутант впійманий
      }
    }

    if (survivedInFile.length > 0) {
      survived.push({ file, mutants: survivedInFile, exampleTest: null, recommendationText: null })
    }
  }

  return { caught, total, survived }
}
