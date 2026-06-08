/**
 * Handler `flow verify` — Stage 2 structural check (думка.MD § "flow verify").
 *
 * Перевіряє що `fact_NNN.md` існує і непорожній у директорії поточного вузла
 * (CWD). Якщо так — виводить `## Done when` секцію з `task.md` та вміст
 * `fact_NNN.md` на stdout для агентської self-evaluation.
 *
 * exit 0 = структурно OK
 * exit 1 = структурна помилка (fact відсутній або порожній)
 *
 * FS ін'єктується для тестування без диска.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { cwd as processCwd } from 'node:process'

import { latestFactNNN } from './nnn.mjs'

const FRONT_MATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---/
const SECTION_RE = /^## (.+)$/m
const LINE_SPLIT_RE = /\r?\n/

/**
 * Читає секцію за заголовком із markdown-файлу.
 * @param {string} text вміст файлу
 * @param {string} heading заголовок без `## `
 * @returns {string | null} вміст секції або null
 */
function extractSection(text, heading) {
  const lines = text.split(LINE_SPLIT_RE)
  const start = lines.indexOf(`## ${heading}`)
  if (start === -1) return null
  const end = lines.findIndex((l, i) => i > start && SECTION_RE.test(l))
  const section = end === -1 ? lines.slice(start) : lines.slice(start, end)
  return section.join('\n').trimEnd()
}

/**
 * `flow verify` handler.
 * @param {string[]} _rest аргументи після `verify` (не використовуються)
 * @param {{
 *   cwd?: string,
 *   log?: (m: string) => void,
 *   readFile?: (path: string, enc: string) => string,
 *   readdir?: (dir: string) => string[],
 *   exists?: (path: string) => boolean
 * }} [deps] ін'єкції
 * @returns {number} exit code (0=OK, 1=структурна помилка)
 */
export function cmdVerify(_rest, deps = {}) {
  const cwd = deps.cwd ?? processCwd()
  const log = deps.log ?? console.error
  const readFile = deps.readFile ?? ((p, enc) => readFileSync(p, enc))
  const readdir = deps.readdir ?? (d => (existsSync(d) ? readdirSync(d) : []))
  const exists = deps.exists ?? existsSync

  const factNNN = latestFactNNN(cwd, readdir)
  if (!factNNN) {
    log('verify: fact_NNN.md не знайдено — структурна помилка')
    return 1
  }

  const factPath = join(cwd, `fact_${factNNN}.md`)
  if (!exists(factPath)) {
    log(`verify: fact_${factNNN}.md не існує — структурна помилка`)
    return 1
  }

  let factContent
  try {
    factContent = readFile(factPath, 'utf8')
  } catch (error) {
    log(`verify: не вдалося прочитати fact_${factNNN}.md — ${error instanceof Error ? error.message : String(error)}`)
    return 1
  }

  const withoutFm = factContent.replace(FRONT_MATTER_RE, '').trim()
  if (withoutFm.length === 0) {
    log(`verify: fact_${factNNN}.md порожній — структурна помилка`)
    return 1
  }

  const outLines = [`## verify context`, ``]

  const taskPath = join(cwd, 'task.md')
  if (exists(taskPath)) {
    try {
      const taskContent = readFile(taskPath, 'utf8')
      const doneWhen = extractSection(taskContent, 'Done when')
      if (doneWhen) outLines.push(doneWhen, '')
    } catch {
      // task.md недоступний — не блокуємо verify
    }
  }

  outLines.push(`### fact_${factNNN}.md`, ``, factContent.trimEnd())
  console.log(outLines.join('\n'))

  return 0
}
