/**
 * Handler `flow plan` — Stage 1 (думка.MD § "flow plan").
 *
 * Читає `task.md` у поточному вузлі, розбирає `mode` і `hint` з front-matter,
 * знаходить наступний номер `plan_NNN.md`, пише шаблон і виводить контекст для
 * агента (task + mode + hint) на stdout.
 *
 * FS та path-резолвінг ін'єктуються — тестується без реального диска.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { cwd as processCwd } from 'node:process'

const FRONT_MATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---/

/**
 * Парсить YAML front-matter (мінімально: лише прості `key: value` рядки).
 * @param {string} text вміст файлу
 * @returns {Record<string, string>} ключ-значення з front-matter (рядки)
 */
function parseFrontMatter(text) {
  const m = text.match(FRONT_MATTER_RE)
  if (!m) return {}
  const result = {}
  for (const line of m[1].split(/\r?\n/)) {
    const idx = line.indexOf(':')
    if (idx === -1) continue
    const key = line.slice(0, idx).trim()
    const val = line.slice(idx + 1).trim()
    if (key) result[key] = val
  }
  return result
}

/**
 * Знаходить наступний номер `plan_NNN.md` у директорії вузла.
 * @param {string} dir абсолютний шлях до директорії вузла
 * @param {(dir: string) => string[]} readdir інжектована readdir
 * @returns {string} рядок типу `001`, `002`, …
 */
function nextPlanNumber(dir, readdir) {
  const files = readdir(dir)
  let max = 0
  for (const f of files) {
    const m = f.match(/^plan_(\d+)\.md$/)
    if (m) {
      const n = parseInt(m[1], 10)
      if (n > max) max = n
    }
  }
  return String(max + 1).padStart(3, '0')
}

/**
 * Будує вміст шаблону `plan_NNN.md`.
 * @param {{ mode: string, hint: string, now: string }} params параметри
 * @returns {string} вміст файлу
 */
export function buildPlanTemplate({ mode, hint, now }) {
  return [
    '---',
    `created_at: ${now}`,
    `mode: ${mode}`,
    `decision: ${hint || 'atomic | composite'}`,
    '---',
    '',
    '## Context',
    "<!-- Чому саме такий підхід — що агент/людина з'ясували -->",
    '',
    '## Approach',
    '<!-- atomic: покроковий план виконання -->',
    '<!-- composite: список дочірніх вузлів з описами -->',
    '',
    '## Risks',
    '<!-- Що може піти не так -->',
    ''
  ].join('\n')
}

/**
 * `flow plan` handler.
 *
 * @param {string[]} _rest аргументи після `plan` (не використовуються)
 * @param {{
 *   cwd?: string,
 *   log?: (m: string) => void,
 *   readFile?: (path: string, enc: string) => string,
 *   writeFile?: (path: string, content: string, enc: string) => void,
 *   readdir?: (dir: string) => string[],
 *   exists?: (path: string) => boolean,
 *   now?: () => string
 * }} [deps] ін'єкції
 * @returns {Promise<number>} exit code
 */
export async function plan(_rest, deps = {}) {
  const cwd = deps.cwd ?? processCwd()
  const log = deps.log ?? console.error
  const readFile = deps.readFile ?? ((p, enc) => readFileSync(p, enc))
  const writeFile = deps.writeFile ?? ((p, c, enc) => writeFileSync(p, c, enc))
  const readdir = deps.readdir ?? (d => (existsSync(d) ? readdirSync(d) : []))
  const exists = deps.exists ?? existsSync
  const nowFn = deps.now ?? (() => new Date().toISOString())

  const taskPath = join(cwd, 'task.md')
  if (!exists(taskPath)) {
    log('flow plan: task.md не знайдено в CWD')
    return 1
  }

  let taskContent
  try {
    taskContent = readFile(taskPath, 'utf8')
  } catch (err) {
    log(`flow plan: не вдалося прочитати task.md — ${err instanceof Error ? err.message : String(err)}`)
    return 1
  }

  const fm = parseFrontMatter(taskContent)
  const mode = fm.mode || 'human'
  const hint = fm.hint || ''

  const num = nextPlanNumber(cwd, readdir)
  const planPath = join(cwd, `plan_${num}.md`)

  const content = buildPlanTemplate({ mode, hint, now: nowFn() })
  try {
    writeFile(planPath, content, 'utf8')
  } catch (err) {
    log(`flow plan: не вдалося записати ${planPath} — ${err instanceof Error ? err.message : String(err)}`)
    return 1
  }

  log(`flow plan: створено ${planPath}`)

  // Виводимо контекст для агента на stdout
  const outLines = [
    `## flow plan context`,
    ``,
    `mode: ${mode}`,
    hint ? `hint: ${hint}` : `hint: (не задано — агент вирішує сам)`,
    `plan: plan_${num}.md`,
    ``
  ]
  // Додаємо вміст task.md для контексту (без front-matter)
  outLines.push(`### task.md`)
  const bodyStart = taskContent.indexOf('\n---\n', 4)
  const taskBody = bodyStart !== -1 ? taskContent.slice(bodyStart + 5).trimStart() : taskContent
  outLines.push(taskBody.trimEnd())

  console.log(outLines.join('\n'))

  return 0
}
