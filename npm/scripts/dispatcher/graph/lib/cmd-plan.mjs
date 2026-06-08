/**
 * `n-cursor graph plan [<path>] [--mode agent]` — Stage 1: пише plan_NNN.md.
 *
 * Читає task.md вузла, знаходить наступний NNN, пише шаблон plan_NNN.md.
 * Якщо --mode agent — встановлює mode:agent у plan front-matter.
 *
 * FS ін'єктується для тестованості.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { cwd as processCwd } from 'node:process'

import { buildMarkdown, parseFrontMatter } from './frontmatter.mjs'
import { nextPlanNNN } from './nnn.mjs'
import { loadConfig, resolveTasksDir } from './config.mjs'

/**
 * Будує шаблон plan_NNN.md.
 * @param {{ mode: string, hint: string, now: string, nnn: string }} params параметри
 * @returns {string} вміст файлу
 */
export function buildPlanTemplate(params) {
  const fm = {
    created_at: params.now,
    mode: params.mode,
    decision: params.hint || 'atomic'
  }

  const body = [
    `## Context`,
    `<!-- Чому саме такий підхід — що з'ясовано під час планування -->`,
    ``,
    `## Approach`,
    params.mode === 'composite'
      ? `<!-- composite: список дочірніх вузлів з описами -->`
      : `<!-- atomic: покроковий план виконання -->`,
    ``,
    `## Risks`,
    `<!-- Що може піти не так -->`,
    ``
  ].join('\n')

  return buildMarkdown(fm, body)
}

/**
 * `graph plan [<path>] [--mode agent]` command handler.
 * @param {string[]} args аргументи: [path] [--mode agent|human]
 * @param {{
 *   cwd?: string,
 *   log?: (m: string) => void,
 *   writeFile?: (p: string, c: string, enc: string) => void,
 *   readFile?: (p: string, enc: string) => string,
 *   readdir?: (d: string) => string[],
 *   exists?: (p: string) => boolean,
 *   now?: () => string
 * }} [deps] ін'єкції
 * @returns {Promise<number>} exit code
 */
export async function cmdPlan(args, deps = {}) {
  const root = deps.cwd ?? processCwd()
  const log = deps.log ?? console.log
  const writeFile = deps.writeFile ?? ((p, c, enc) => writeFileSync(p, c, enc))
  const readFile = deps.readFile ?? ((p, enc) => readFileSync(p, enc))
  const readdir = deps.readdir ?? (d => (existsSync(d) ? readdirSync(d) : []))
  const exists = deps.exists ?? existsSync
  const nowFn = deps.now ?? (() => new Date().toISOString())

  // Парсимо аргументи
  let nodePath = null
  let modeOverride = null

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--mode' && args[i + 1]) {
      modeOverride = args[i + 1]
      i++
    } else if (!args[i].startsWith('-')) {
      nodePath = args[i]
    }
  }

  const config = loadConfig({ root, readFile, exists })
  const tasksDir = resolveTasksDir(config, root)

  // Визначаємо директорію вузла
  let nodeDir
  if (nodePath) {
    nodeDir = join(tasksDir, nodePath)
  } else {
    // CWD може бути в worktree — шукаємо task.md у CWD
    nodeDir = processCwd()
  }

  const taskPath = join(nodeDir, 'task.md')
  if (!exists(taskPath)) {
    log(`plan: task.md не знайдено в ${nodeDir}`)
    return 1
  }

  let taskContent
  try {
    taskContent = readFile(taskPath, 'utf8')
  } catch (err) {
    log(`plan: не вдалося прочитати task.md — ${err.message ?? String(err)}`)
    return 1
  }

  const fm = parseFrontMatter(taskContent)
  const mode = modeOverride ?? (typeof fm.mode === 'string' ? fm.mode : 'human')
  const hint = typeof fm.hint === 'string' ? fm.hint : ''

  const nnn = nextPlanNNN(nodeDir, readdir)
  const planPath = join(nodeDir, `plan_${nnn}.md`)

  const content = buildPlanTemplate({ mode, hint, now: nowFn(), nnn })

  try {
    writeFile(planPath, content, 'utf8')
    log(`plan: створено ${planPath} (mode: ${mode})`)
  } catch (err) {
    log(`plan: не вдалося записати ${planPath} — ${err.message ?? String(err)}`)
    return 1
  }

  // Виводимо контекст для агента/людини
  const bodyStart = taskContent.indexOf('\n---\n', 4)
  const taskBody = bodyStart === -1 ? taskContent : taskContent.slice(bodyStart + 5).trimStart()

  console.log([
    `## plan context`,
    ``,
    `node: ${nodePath ?? nodeDir}`,
    `mode: ${mode}`,
    hint ? `hint: ${hint}` : `hint: (не задано)`,
    `plan: plan_${nnn}.md`,
    ``,
    `### task.md`,
    taskBody.trimEnd()
  ].join('\n'))

  return 0
}
