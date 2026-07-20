/** @see ./docs/main.md */
import { createViolationReporter } from '@7n/rules/scripts/lib/lint-surface/violation-reporter.mjs'
import { collectTestFileOffenders } from '../lib/collect-test-file-offenders.mjs'

/**
 * `expect(x).toBe({…})` / `expect(x).toBe([…])` — `toBe` — це `Object.is`
 * (reference equality); нове об'єктне/масивне літеральне значення завжди має інше
 * посилання, тож перевірка **завжди false**, незалежно від вмісту. Канон — `toEqual`
 * (deep equality) для об'єктів і масивів (vitest-api-conventions.mdc, п.4).
 * Знаходить лише `.toBe(` де аргумент — САМЕ літерал (нічого не приєднано після
 * закриваючої дужки, окрім опційних пробілів і `)`) — `.toBe([...].join('\n'))`
 * не матчиться: результат `.join()` — рядок-примітив, а не масив-посилання.
 */
const TO_BE_CALL_RE = /\.toBe\(/gu
/** Whitespace-символ (пробіл/таб/перенос) — для `skipWhitespace`, module scope (oxlint prefer-static-regex). */
const WS_RE = /\s/u
/** Рядкові/template-лапки, що відкривають літерал усередині `findMatchingBracketEnd`. */
const QUOTE_CHARS = new Set(['"', "'", '`'])
/** Мапа закриваючої дужки на парну дужку, яка її відкриває — для перевірки балансу стеку. */
const CLOSE_TO_OPEN = { '}': '{', ']': '[' }

/**
 * Пропускає пробіли/переноси рядків, повертає індекс першого не-whitespace символу.
 * @param {string} body вміст файлу
 * @param {number} from стартовий індекс
 * @returns {number} індекс першого значущого символу (може дорівнювати `body.length`)
 */
function skipWhitespace(body, from) {
  let i = from
  while (i < body.length && WS_RE.test(body[i])) i++
  return i
}

/**
 * Просуває сканер на один крок усередині рядкового/template-літералу: обробляє
 * екранування (`\x`) і повідомляє, чи саме на цьому символі рядок закрився.
 * Виокремлено з `findMatchingBracketEnd`, аби тримати cognitive complexity
 * головного циклу під порогом лінтера.
 * @param {string} body вміст файлу
 * @param {number} i індекс поточного символу (усередині рядка)
 * @param {string} quote символ лапки, що відкриває поточний рядок
 * @returns {{next: number, closed: boolean}} нова позиція сканера і прапорець закриття
 */
function stepInsideQuote(body, i, quote) {
  const ch = body[i]
  if (ch === '\\') return { next: i + 2, closed: false }
  if (ch === quote) return { next: i + 1, closed: true }
  return { next: i + 1, closed: false }
}

/**
 * Знаходить індекс символу, що йде одразу за парною дужкою, яка закриває
 * дужку на позиції `openIndex` (`{` чи `[`). Ігнорує дужки всередині
 * рядкових/template-літералів, аби не збитись на `{ a: '}' }` тощо.
 * @param {string} body вміст файлу
 * @param {number} openIndex індекс відкриваючої дужки
 * @returns {number|null} індекс одразу після закриваючої дужки, або `null` якщо не збалансовано
 */
function findMatchingBracketEnd(body, openIndex) {
  const stack = [body[openIndex]]
  let i = openIndex + 1
  let quote = null

  while (i < body.length) {
    if (quote) {
      const step = stepInsideQuote(body, i, quote)
      if (step.closed) quote = null
      i = step.next
      continue
    }

    const ch = body[i]

    if (QUOTE_CHARS.has(ch)) {
      quote = ch
      i++
      continue
    }

    if (ch === '{' || ch === '[') {
      stack.push(ch)
      i++
      continue
    }

    if (ch in CLOSE_TO_OPEN) {
      if (stack.at(-1) !== CLOSE_TO_OPEN[ch]) return null // незбалансовано — здаємось
      stack.pop()
      if (stack.length === 0) return i + 1
      i++
      continue
    }

    i++
  }

  return null
}

/**
 * Знаходить усі виклики `.toBe(` де перший аргумент — САМЕ об'єктний/масивний
 * літерал (не результат ланцюжка викликів на ньому).
 * @param {string} body вміст файлу
 * @returns {Array<{line: number}>} знайдені порушення
 */
function findOffenders(body) {
  const offenders = []
  for (const m of body.matchAll(TO_BE_CALL_RE)) {
    const argStart = skipWhitespace(body, m.index + m[0].length)
    const ch = body[argStart]
    if (ch !== '{' && ch !== '[') continue

    const afterLiteral = findMatchingBracketEnd(body, argStart)
    if (afterLiteral === null) continue

    const afterWs = skipWhitespace(body, afterLiteral)
    if (body[afterWs] !== ')') continue // приєднано щось після літерала (напр. .join(...)) — не порушення

    const line = body.slice(0, m.index).split('\n').length
    offenders.push({ line })
  }
  return offenders
}

/**
 * Detector: жоден `*.test.{mjs,js}` не викликає `expect(...).toBe(...)` з
 * об'єктним/масивним літералом — `toBe` (Object.is) на новоствореному
 * об'єкті/масиві завжди false; канон — `toEqual` (vitest-api-conventions.mdc, п.4).
 * @param {import('@7n/rules/scripts/lib/lint-surface/types.mjs').LintContext} ctx контекст лінту.
 * @returns {Promise<import('@7n/rules/scripts/lib/lint-surface/types.mjs').LintResult>} результат перевірки з порушеннями.
 */
export async function lint(ctx) {
  const reporter = createViolationReporter(ctx)
  const { pass, fail } = reporter

  const cwd = ctx.cwd
  const { testFiles, offenders } = await collectTestFileOffenders(cwd, findOffenders)

  if (offenders.length === 0) {
    pass(`Жоден з ${testFiles.length} тестових файлів не викликає toBe(...) з об'єктним/масивним літералом (test.mdc)`)
    return reporter.result()
  }

  for (const { file, line } of offenders) {
    fail(
      `${file}:${line}: expect(...).toBe(...) з об'єктним/масивним літералом завжди false ` +
        `(Object.is на новому посиланні) — використовуй toEqual (test.mdc, vitest-api-conventions)`,
      { file }
    )
  }

  return reporter.result()
}
