/**
 * Handler `flow verify` — Stage 2 structural check (думка.MD § "flow verify").
 *
 * Перевіряє що `outputs_NNN.md` існує і непорожній у директорії поточного вузла
 * (CWD). Якщо так — виводить `## Done when` секцію з `task.md` та вміст
 * `outputs_NNN.md` на stdout для агентської self-evaluation.
 *
 * exit 0 = структурно OK
 * exit 1 = структурна помилка (outputs відсутній або порожній)
 *
 * НІЯКОГО артефакту не пишеться. FS ін'єктується для тестування без диска.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { cwd as processCwd } from 'node:process'

const FRONT_MATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---/
const SECTION_RE = /^## (.+)$/m

/**
 * Читає секцію за заголовком із markdown-файлу.
 * Повертає вміст від заголовка до наступного `## ` або кінця файлу.
 * @param {string} text вміст файлу
 * @param {string} heading заголовок без `## `
 * @returns {string | null} вміст секції (включно з рядком заголовка) або null
 */
function extractSection(text, heading) {
  const lines = text.split(/\r?\n/)
  const start = lines.findIndex(l => l === `## ${heading}`)
  if (start === -1) return null
  const end = lines.findIndex((l, i) => i > start && SECTION_RE.test(l))
  const section = end === -1 ? lines.slice(start) : lines.slice(start, end)
  return section.join('\n').trimEnd()
}

/**
 * Знаходить outputs-файл з найбільшим NNN у директорії вузла.
 * @param {string[]} files список файлів директорії
 * @returns {string | null} ім'я файлу (напр. `outputs_001.md`) або null
 */
export function findLatestOutputs(files) {
  let max = -1
  let best = null
  for (const f of files) {
    const m = f.match(/^outputs_(\d+)\.md$/)
    if (m) {
      const n = parseInt(m[1], 10)
      if (n > max) {
        max = n
        best = f
      }
    }
  }
  return best
}

/**
 * `flow verify` handler.
 *
 * @param {string[]} _rest аргументи після `verify` (не використовуються)
 * @param {{
 *   cwd?: string,
 *   log?: (m: string) => void,
 *   readFile?: (path: string, enc: string) => string,
 *   readdir?: (dir: string) => string[],
 *   exists?: (path: string) => boolean
 * }} [deps] ін'єкції
 * @returns {Promise<number>} exit code (0=OK, 1=структурна помилка)
 */
export async function verify(_rest, deps = {}) {
  const cwd = deps.cwd ?? processCwd()
  const log = deps.log ?? console.error
  const readFile = deps.readFile ?? ((p, enc) => readFileSync(p, enc))
  const readdir = deps.readdir ?? (d => (existsSync(d) ? readdirSync(d) : []))
  const exists = deps.exists ?? existsSync

  // Перевіряємо outputs_NNN.md
  const files = readdir(cwd)
  const outputsName = findLatestOutputs(files)
  if (!outputsName) {
    log('flow verify: outputs_NNN.md не знайдено — структурна помилка')
    return 1
  }

  const outputsPath = join(cwd, outputsName)
  if (!exists(outputsPath)) {
    log(`flow verify: ${outputsName} не існує — структурна помилка`)
    return 1
  }

  let outputsContent
  try {
    outputsContent = readFile(outputsPath, 'utf8')
  } catch (err) {
    log(`flow verify: не вдалося прочитати ${outputsName} — ${err instanceof Error ? err.message : String(err)}`)
    return 1
  }

  // Перевіряємо що файл не порожній (без front-matter — суто тіло)
  const withoutFm = outputsContent.replace(FRONT_MATTER_RE, '').trim()
  if (withoutFm.length === 0) {
    log(`flow verify: ${outputsName} порожній — структурна помилка`)
    return 1
  }

  // Виводимо Done when + outputs на stdout для агентської self-evaluation
  const outLines = [`## verify context`, ``]

  const taskPath = join(cwd, 'task.md')
  if (exists(taskPath)) {
    try {
      const taskContent = readFile(taskPath, 'utf8')
      const doneWhen = extractSection(taskContent, 'Done when')
      if (doneWhen) {
        outLines.push(doneWhen, '')
      }
    } catch {
      // якщо task.md недоступний — не блокуємо verify
    }
  }

  outLines.push(`### ${outputsName}`, ``, outputsContent.trimEnd())

  console.log(outLines.join('\n'))

  return 0
}
