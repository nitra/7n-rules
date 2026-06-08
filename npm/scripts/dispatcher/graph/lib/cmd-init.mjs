/**
 * `n-cursor graph init <name>` — створює task.md шаблон для нового вузла.
 *
 * Не потребує LLM. Просто пише task.md з front-matter і порожнім тілом.
 * Ім'я може містити `/` для вкладених вузлів (напр. "research/collect-data").
 *
 * FS ін'єктується для тестованості.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { cwd as processCwd } from 'node:process'

import { buildMarkdown } from './frontmatter.mjs'
import { loadConfig, resolveTasksDir } from './config.mjs'

/**
 * Будує front-matter для task.md шаблону.
 * @param {{ now: string, name: string }} params параметри
 * @returns {Record<string, unknown>} front-matter об'єкт
 */
export function buildTaskFrontMatter(params) {
  return {
    created_at: params.now,
    budget_sec: 600,
    mode: 'human',
    interactive: true,
    executor: {
      type: 'agent',
      model_tier: 'AVG',
      skills: ['bash', 'write-files']
    },
    hint: 'atomic',
    deps: []
  }
}

/**
 * `graph init <name>` command handler.
 * @param {string[]} args аргументи: [name]
 * @param {{
 *   cwd?: string,
 *   log?: (m: string) => void,
 *   writeFile?: (p: string, c: string, enc: string) => void,
 *   exists?: (p: string) => boolean,
 *   mkdir?: (p: string, opts?: object) => void,
 *   now?: () => string,
 *   readFile?: (p: string, enc: string) => string
 * }} [deps] ін'єкції
 * @returns {Promise<number>} exit code
 */
export async function cmdInit(args, deps = {}) {
  const root = deps.cwd ?? processCwd()
  const log = deps.log ?? console.log
  const writeFile = deps.writeFile ?? ((p, c, enc) => writeFileSync(p, c, enc))
  const exists = deps.exists ?? existsSync
  const mkdir = deps.mkdir ?? ((p, opts) => mkdirSync(p, opts))
  const nowFn = deps.now ?? (() => new Date().toISOString())

  const [name] = args
  if (!name) {
    log('Usage: n-cursor graph init <name>')
    log('  name може містити / для вкладених вузлів (напр. "research/collect-data")')
    return 1
  }

  const config = loadConfig({ root, readFile: deps.readFile, exists })
  const tasksDir = resolveTasksDir(config, root)

  const nodeDir = join(tasksDir, name)
  const taskPath = join(nodeDir, 'task.md')

  if (exists(taskPath)) {
    log(`init: ${taskPath} вже існує — пропускаємо`)
    return 0
  }

  // Створюємо директорію рекурсивно
  try {
    mkdir(nodeDir, { recursive: true })
  } catch (err) {
    log(`init: не вдалося створити директорію ${nodeDir} — ${err.message ?? String(err)}`)
    return 1
  }

  const fm = buildTaskFrontMatter({ now: nowFn(), name })
  const body = [
    `## Mission`,
    ``,
    `<!-- Опишіть завдання вузла тут -->`,
    ``,
    `## Done when`,
    ``,
    `<!-- Критерії успіху -->`,
    ``,
    `## Context`,
    ``,
    `<!-- Додатковий контекст для виконавця -->`,
    ``
  ].join('\n')

  const content = buildMarkdown(fm, body)

  try {
    writeFile(taskPath, content, 'utf8')
    log(`init: створено ${taskPath}`)
  } catch (err) {
    log(`init: не вдалося записати ${taskPath} — ${err.message ?? String(err)}`)
    return 1
  }

  return 0
}
