/**
 * `n-cursor coverage-fix index|slice` — read-only витяг вцілілих мутантів із
 * `COVERAGE.md` для скілу `n-coverage-fix`.
 *
 * Мотивація: `COVERAGE.md` може важити мегабайти (секція `## Вцілілі мутанти`
 * з JSON-блоком на сотні файлів). Якщо цей файл читає LLM-оркестратор, він
 * спалює сотні тисяч токенів лише на парсинг. Натомість важкий парсинг несе цей
 * скрипт (для JS — мілісекунди, 0 токенів), а агенту віддається рівно потрібна
 * порція:
 *   - `index` — крихітний `[{file, mutants}]` для рішення про фан-аут;
 *   - `slice --file <path>` — промпт лише для одного файлу (контекст ±3 рядки),
 *     рівно під когнітивне навантаження одного субагента.
 *
 * Команда read-only: лише парсить наявний `COVERAGE.md`, нічого не мутує і не
 * перезапускає Stryker (тож не входить у root-guard).
 */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { buildFixPrompt } from './coverage-fix.mjs'

/** Заголовок секції вцілілих мутантів у COVERAGE.md (контракт із renderMarkdown). */
const SURVIVED_SECTION = '## Вцілілі мутанти'

/**
 * Огорожа json-блоку: ≥3 бектики, далі `json` і решта рядка до `\n`. Довжина
 * захоплюється в групу 1 — renderMarkdown пише 3, але oxfmt підвищує до 4+, коли
 * сам JSON-вміст містить ``` (типово для original/replacement мутантів).
 */
const FENCE_OPEN_RE = /(`{3,})json[^\n]*\n/

/**
 * Витягує JSON-масив вцілілих мутантів із тексту COVERAGE.md: знаходить секцію
 * `## Вцілілі мутанти`, перший огороджений ` ```json ` блок під нею і парсить.
 * @param {string} md повний текст COVERAGE.md
 * @returns {import('./coverage-fix.mjs').SurvivedFileGroup[]} групи вцілілих по файлах (порожньо, якщо секції/блоку немає або JSON невалідний)
 */
export function parseSurvivedBlock(md) {
  const sectionAt = md.indexOf(SURVIVED_SECTION)
  if (sectionAt === -1) return []
  const after = md.slice(sectionAt)
  const open = after.match(FENCE_OPEN_RE)
  if (!open) return []
  const fence = open[1]
  const bodyStart = open.index + open[0].length
  const rest = after.slice(bodyStart)
  // Закриття — рядок із тих самих бектиків. Усередині JSON реальних переводів
  // рядка немає (JSON.stringify екранує їх як `\n`), тож `\n<fence>` унікально
  // позначає кінець блоку навіть якщо значення містять бектики.
  const closeAt = rest.indexOf(`\n${fence}`)
  const json = closeAt === -1 ? rest : rest.slice(0, closeAt)
  try {
    const parsed = JSON.parse(json)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

/**
 * Читає `COVERAGE.md` із кореня проєкту і повертає структуровані групи вцілілих.
 * @param {string} cwd корінь проєкту
 * @returns {Promise<import('./coverage-fix.mjs').SurvivedFileGroup[]>} групи вцілілих по файлах
 */
export async function readSurvived(cwd) {
  let md
  try {
    md = await readFile(join(cwd, 'COVERAGE.md'), 'utf8')
  } catch {
    return []
  }
  return parseSurvivedBlock(md)
}

/**
 * Згортає групи вцілілих у компактний index `[{file, mutants}]`.
 * @param {import('./coverage-fix.mjs').SurvivedFileGroup[]} survived групи вцілілих
 * @returns {Array<{file:string, mutants:number}>} файл → кількість вцілілих мутантів
 */
export function buildIndex(survived) {
  return survived
    .filter(group => group && typeof group.file === 'string' && Array.isArray(group.mutants))
    .map(group => ({ file: group.file, mutants: group.mutants.length }))
}

const USAGE = 'Usage: n-cursor coverage-fix <index | slice --file <path>>'

/**
 * CLI: `index` друкує компактний JSON-масив, `slice --file <path>` — промпт для
 * одного файлу. Обидва read-only (читають лише COVERAGE.md).
 * @param {string[]} args аргументи після `coverage-fix`
 * @param {string} [cwd] корінь проєкту (ін'єкція для тестів)
 * @returns {Promise<number>} exit code
 */
export async function runCoverageFixCli(args, cwd = process.cwd()) {
  const sub = args[0]
  const survived = await readSurvived(cwd)

  if (sub === 'index') {
    process.stdout.write(`${JSON.stringify(buildIndex(survived))}\n`)
    return 0
  }

  if (sub === 'slice') {
    const flagAt = args.indexOf('--file')
    const file = flagAt === -1 ? undefined : args[flagAt + 1]
    if (!file) {
      console.error(USAGE)
      return 1
    }
    const group = survived.find(g => g && g.file === file)
    if (!group) {
      console.error(`✗ Файл не знайдено серед вцілілих мутантів: ${file}`)
      return 1
    }
    process.stdout.write(`${await buildFixPrompt([group], cwd)}\n`)
    return 0
  }

  console.error(USAGE)
  return 1
}
