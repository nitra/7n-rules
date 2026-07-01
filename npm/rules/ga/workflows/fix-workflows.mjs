/** @see ./docs/fix-workflows.md */

/**
 * T0-autofix для `ga/workflows` — детерміновані правки, керовані structured `data`
 * детектора (#3 fix-hints), БЕЗ LLM. Покриває дві механічні родини порушень:
 *   - `checkout-persist-credentials` — дописати `with: persist-credentials: false`
 *     у кожен `actions/checkout` крок, де його бракує;
 *   - `unmatched-paths-glob` — прибрати застарілий glob із `on.<event>.paths`.
 *
 * Трансформації **текстові** (зберігають коментарі/формат/blank-lines, мінімальний diff);
 * семантичну коректність гарантує canonical re-detect runner-а (T0 permanent, поза rollback).
 * Чисті трансформери експортуються для unit-тестів.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const CHECKOUT_USES_RE = /uses:\s*actions\/checkout@/u
const WITH_LINE_RE = /^\s*with:\s*$/u
const PERSIST_KEY_RE = /^\s*persist-credentials\s*:/u
const QUOTE_EDGE_RE = /^['"]|['"]$/gu
const PATHS_KEY_RE = /^\s*paths:\s*$/u

/**
 * Індекс першого непорожнього рядка з `from` (включно).
 * @param {string[]} lines усі рядки
 * @param {number} from стартовий індекс
 * @returns {number} індекс непорожнього рядка (або `lines.length`)
 */
function nextNonEmpty(lines, from) {
  let j = from
  while (j < lines.length && lines[j].trim() === '') j++
  return j
}

/**
 * Чи блок `with:` (на рядку `withLine`, колонка ключа `col`) уже містить
 * `persist-credentials`. Скан до dedent.
 * @param {string[]} lines усі рядки
 * @param {number} withLine індекс рядка `with:`
 * @param {number} col колонка ключа `with:`
 * @returns {boolean} true, якщо ключ уже присутній
 */
function withBlockHasPersist(lines, withLine, col) {
  for (let k = withLine + 1; k < lines.length; k++) {
    if (lines[k].trim() === '') continue
    const c = lines[k].length - lines[k].trimStart().length
    if (c <= col) return false // dedent → блок завершився
    if (PERSIST_KEY_RE.test(lines[k])) return true
  }
  return false
}

/**
 * Insert-план для одного `actions/checkout` кроку на рядку `i` (колонка `uses:` = `col`).
 * @param {string[]} lines усі рядки
 * @param {number} i індекс рядка `uses:`
 * @param {number} col колонка `uses:`
 * @returns {{ at: number, text: string[] } | null} вставка або null, якщо ключ уже є
 */
function persistInsertFor(lines, i, col) {
  const ind = ' '.repeat(col)
  const j = nextNonEmpty(lines, i + 1)
  const hasWithBlock = j < lines.length && WITH_LINE_RE.test(lines[j]) && lines[j].indexOf('with:') === col
  if (hasWithBlock) {
    return withBlockHasPersist(lines, j, col) ? null : { at: j + 1, text: [`${ind}  persist-credentials: false`] }
  }
  return { at: i + 1, text: [`${ind}with:`, `${ind}  persist-credentials: false`] }
}

/**
 * Дописує `with: persist-credentials: false` у кожен `actions/checkout` крок,
 * де його бракує. Дві форми: крок без `with:` (створити блок) і з наявним `with:`
 * (вставити ключ). Відступ `with:` = колонка `uses:`; ключа = +2.
 * @param {string} content вміст workflow-файла
 * @returns {string|null} новий вміст або null, якщо нічого не змінилось
 */
export function addPersistCredentials(content) {
  const lines = content.split('\n')
  /** @type {Array<{ at: number, text: string[] }>} */
  const inserts = []
  for (let i = 0; i < lines.length; i++) {
    const col = lines[i].indexOf('uses:')
    if (col === -1 || !CHECKOUT_USES_RE.test(lines[i])) continue
    const ins = persistInsertFor(lines, i, col)
    if (ins) inserts.push(ins)
  }
  if (inserts.length === 0) return null
  // Згори вниз — індекси не зсуваються під час splice.
  inserts.sort((a, b) => b.at - a.at)
  for (const ins of inserts) lines.splice(ins.at, 0, ...ins.text)
  return lines.join('\n')
}

/**
 * Прибирає list-елементи із заданими значеннями всередині блоків `paths:`
 * (`on.push.paths` / `on.pull_request.paths`). Scoped до paths-блоку, щоб не
 * зачепити однойменні значення деінде.
 * @param {string} content вміст workflow-файла
 * @param {Set<string>} globs значення glob-ів на видалення (без лапок)
 * @returns {string|null} новий вміст або null, якщо нічого не змінилось
 */
export function removePathsGlobs(content, globs) {
  const lines = content.split('\n')
  /** @type {string[]} */
  const out = []
  let pathsCol = -1 // колонка ключа `paths:` поточного блоку; -1 = поза блоком
  let changed = false
  for (const line of lines) {
    if (PATHS_KEY_RE.test(line)) {
      pathsCol = line.indexOf('paths:')
      out.push(line)
      continue
    }
    if (pathsCol >= 0 && line.trim() !== '') {
      const col = line.length - line.trimStart().length
      if (col > pathsCol) {
        // Лінійний парс list-елемента `- <value>` (без regex → без ReDoS).
        const trimmed = line.trimStart()
        if (trimmed.startsWith('- ')) {
          const val = trimmed.slice(2).trim().replace(QUOTE_EDGE_RE, '')
          if (globs.has(val)) {
            changed = true
            continue // викидаємо рядок
          }
        }
        out.push(line)
        continue
      }
      pathsCol = -1 // dedent → блок `paths:` завершився
    }
    out.push(line)
  }
  return changed ? out.join('\n') : null
}

const WRAPPED_NCURSOR_RE = /\b(?:bunx|npx)\s+n-cursor/u
const RUN_INLINE_NCURSOR_MATCH = /^(\s*(?:-\s*)?run:\s*)(n-cursor\s.*)$/u
const BARE_LINE_NCURSOR_MATCH = /^(\s+)(n-cursor\s.*)$/u

/**
 * Префіксує bare `n-cursor …` у `run`-кроках через `bunx` (у CI n-cursor не на PATH).
 * Пропускає рядки, де вже є `bunx`/`npx n-cursor`. Покриває inline `run:` і рядок у run-блоці.
 * @param {string} content вміст workflow-файла
 * @returns {string|null} новий вміст або null, якщо нічого не змінилось
 */
export function prefixBunxNCursor(content) {
  let changed = false
  const out = content.split('\n').map(line => {
    if (WRAPPED_NCURSOR_RE.test(line)) return line
    const inline = RUN_INLINE_NCURSOR_MATCH.exec(line)
    if (inline) {
      changed = true
      return `${inline[1]}bunx ${inline[2]}`
    }
    const bare = BARE_LINE_NCURSOR_MATCH.exec(line)
    if (bare) {
      changed = true
      return `${bare[1]}bunx ${bare[2]}`
    }
    return line
  })
  return changed ? out.join('\n') : null
}

/**
 * Застосовує текстовий трансформер до унікальних файлів із violations і пише зміни.
 * @param {import('../../../scripts/lib/lint-surface/types.mjs').LintViolation[]} violations порушення (джерело переліку файлів)
 * @param {import('../../../scripts/lib/lint-surface/types.mjs').LintContext} ctx контекст лінту (cwd, recordWrite)
 * @param {(file: string) => (content: string) => string|null} transformerFor
 *   фабрика трансформера для конкретного relative-file (дає доступ до per-file даних)
 * @returns {string[]} абсолютні шляхи змінених файлів
 */
function applyToFiles(violations, ctx, transformerFor) {
  const files = [...new Set(violations.map(v => v.file).filter(Boolean))]
  /** @type {string[]} */
  const touchedFiles = []
  for (const rel of files) {
    const abs = join(ctx.cwd, rel)
    let content
    try {
      content = readFileSync(abs, 'utf8')
    } catch {
      continue
    }
    const next = transformerFor(rel)(content)
    if (next && next !== content) {
      ctx.recordWrite?.(abs)
      writeFileSync(abs, next)
      touchedFiles.push(abs)
    }
  }
  return touchedFiles
}

/** @type {import('../../../scripts/lib/lint-surface/types.mjs').T0Pattern[]} */
export const patterns = [
  {
    id: 'ga-workflows-checkout-persist-credentials',
    test: violations => violations.some(v => v.data?.kind === 'checkout-persist-credentials' && v.file),
    apply: (violations, ctx) => {
      const targets = violations.filter(v => v.data?.kind === 'checkout-persist-credentials' && v.file)
      const touchedFiles = applyToFiles(targets, ctx, () => addPersistCredentials)
      return touchedFiles.length > 0
        ? { touchedFiles, message: `persist-credentials: false → ${touchedFiles.length} workflow(s)` }
        : { touchedFiles: [] }
    }
  },
  {
    id: 'ga-workflows-unmatched-paths-glob',
    test: violations => violations.some(v => v.data?.kind === 'unmatched-paths-glob' && v.file),
    apply: (violations, ctx) => {
      const targets = violations.filter(v => v.data?.kind === 'unmatched-paths-glob' && v.file)
      // Глоби на видалення згруповані per-file.
      /** @type {Map<string, Set<string>>} */
      const byFile = new Map()
      for (const v of targets) {
        const glob = typeof v.data?.glob === 'string' ? v.data.glob : null
        if (!glob) continue
        if (!byFile.has(v.file)) byFile.set(v.file, new Set())
        byFile.get(v.file).add(glob)
      }
      const touchedFiles = applyToFiles(
        targets,
        ctx,
        rel => content => removePathsGlobs(content, byFile.get(rel) ?? new Set())
      )
      return touchedFiles.length > 0
        ? { touchedFiles, message: `прибрано не-матчені paths-glob у ${touchedFiles.length} файл(ах)` }
        : { touchedFiles: [] }
    }
  },
  {
    id: 'ga-workflows-bare-n-cursor',
    test: violations => violations.some(v => v.data?.kind === 'bare-n-cursor' && v.file),
    apply: (violations, ctx) => {
      const targets = violations.filter(v => v.data?.kind === 'bare-n-cursor' && v.file)
      const touchedFiles = applyToFiles(targets, ctx, () => prefixBunxNCursor)
      return touchedFiles.length > 0
        ? { touchedFiles, message: `bunx-префікс n-cursor → ${touchedFiles.length} workflow(s)` }
        : { touchedFiles: [] }
    }
  }
]
