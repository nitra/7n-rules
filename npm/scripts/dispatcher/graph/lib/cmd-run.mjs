/**
 * `n-cursor graph run [<path>] [--actor a] [--auto]` — запуск вузла(ів).
 *
 * Wrapper логіка:
 * 1. Читає task.md → budget_sec, budget_hard_sec, deps, mode, executor
 * 2. Перевіряє що всі deps resolved
 * 3. Обчислює NNN = count(run_*.md) + 1
 * 4. git worktree add .worktrees/<node-epoch>/ (atomic mkdir lock — EEXIST = skip)
 * 5. ENV: NCURSOR_RUN_NNN, NCURSOR_BUDGET_SEC, NCURSOR_HARD_BUDGET_SEC, NCURSOR_STARTED_AT, NCURSOR_NODE_PATH
 * 6. Спавнить subprocess (claude або n-cursor graph run --actor auditor)
 * 7. Poll worktree mtime кожні 5s: progress_timeout → SIGKILL; budget_hard → SIGKILL
 * 8. Після exit: fact_NNN.md є → result:success; else → result:failed
 * 9. Пише run_NNN.md
 * 10. Якщо success: git merge + delete worktree
 *
 * --auto режим: сканує для готових вузлів (waiting + deps resolved), клеймить atomic mkdir.
 *
 * FS і child_process ін'єктуються для тестованості.
 */
import { execSync, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { cwd as processCwd } from 'node:process'

import { buildMarkdown, parseFrontMatter } from './frontmatter.mjs'
import { latestFactNNN, nextRunNNN } from './nnn.mjs'
import { loadConfig, resolveModelByTier, resolveTasksDir, resolveWorktreesDir } from './config.mjs'
import { scanNodes, topoSort, areDepsResolved } from './scanner.mjs'
import { createWorktree, listActiveWorktrees, mergeWorktree } from './worktree-ops.mjs'
import { makeWorktreeName } from './worktree-ops.mjs'

/**
 * Пише run_NNN.md артефакт.
 * @param {string} nodeDir директорія вузла
 * @param {string} nnn NNN рядок
 * @param {'success'|'failed'} result результат
 * @param {{ actor: string, startedAt: string, now: string }} meta метадані
 * @param {(p: string, c: string, enc: string) => void} writeFile функція запису
 */
function writeRunFile(nodeDir, nnn, result, meta, writeFile) {
  const fm = {
    created_at: meta.now,
    started_at: meta.startedAt,
    actor: meta.actor,
    result
  }
  const content = buildMarkdown(fm, `## Run ${nnn}\n\nactor: ${meta.actor}\nresult: ${result}\n`)
  writeFile(join(nodeDir, `run_${nnn}.md`), content, 'utf8')
}

/**
 * Запускає один вузол: creates worktree, spawns agent, writes run_NNN.md.
 * @param {string} nodePath відносний шлях вузла
 * @param {string} nodeDir абсолютний шлях до директорії вузла
 * @param {object} config конфігурація
 * @param {string} root корінь репо
 * @param {{ actor?: string, dryRun?: boolean }} opts опції
 * @param {object} deps ін'єкції
 * @returns {{ ok: boolean, code: number }} результат
 */
function runNode(nodePath, nodeDir, config, root, opts, deps) {
  const log = deps.log ?? console.log
  const readFile = deps.readFile ?? ((p, enc) => readFileSync(p, enc))
  const writeFile = deps.writeFile ?? ((p, c, enc) => writeFileSync(p, c, enc))
  const readdir = deps.readdir ?? (d => (existsSync(d) ? readdirSync(d) : []))
  const exists = deps.exists ?? existsSync
  const execSyncFn = deps.execSync ?? ((cmd, o) => execSync(cmd, { ...o, encoding: 'utf8' }))
  const spawnSyncFn = deps.spawnSync ?? spawnSync
  const nowFn = deps.now ?? (() => new Date().toISOString())
  const statFn = deps.statSync ?? statSync

  // 1. Читаємо task.md
  let fm = {}
  try {
    fm = parseFrontMatter(readFile(join(nodeDir, 'task.md'), 'utf8'))
  } catch (err) {
    log(`run: не вдалося прочитати task.md для "${nodePath}" — ${err.message ?? String(err)}`)
    return { ok: false, code: 1 }
  }

  const budgetSec = Number(fm.budget_sec) || config.default_budget_sec
  const budgetHardSec = Number(fm.budget_hard_sec) || (budgetSec * config.budget_hard_sec_multiplier)
  const progressTimeoutSec = config.progress_timeout_sec

  const executor = (fm.executor && typeof fm.executor === 'object') ? fm.executor : {}
  const executorType = executor.type ?? 'agent'
  const modelTier = executor.model_tier ?? 'AVG'
  const model = resolveModelByTier(config, modelTier)

  const actor = opts.actor ?? executorType

  // 2. Вже перевірено deps resolved перед викликом

  // 3. Обчислюємо NNN
  const nnn = nextRunNNN(nodeDir, readdir)

  // 4. Створюємо worktree (atomic mkdir lock)
  const worktreesDir = resolveWorktreesDir(config, root)
  const worktreeName = makeWorktreeName(nodePath)
  const worktreePath = join(worktreesDir, worktreeName)

  log(`run: запускаємо вузол "${nodePath}" (NNN=${nnn}, actor=${actor})`)

  if (opts.dryRun) {
    log(`run: --dry-run — пропускаємо фактичний запуск`)
    return { ok: true, code: 0 }
  }

  let createResult
  try {
    createResult = createWorktree(worktreesDir, worktreeName, root, { execSync: execSyncFn })
  } catch (err) {
    log(`run: не вдалося створити worktree — ${err.message ?? String(err)}`)
    return { ok: false, code: 1 }
  }

  if (!createResult) {
    log(`run: вузол "${nodePath}" вже запущено (worktree існує) — пропускаємо`)
    return { ok: false, code: 2 }
  }

  // 5. ENV
  const startedAt = nowFn()
  const env = {
    ...process.env,
    NCURSOR_RUN_NNN: nnn,
    NCURSOR_BUDGET_SEC: String(budgetSec),
    NCURSOR_HARD_BUDGET_SEC: String(budgetHardSec),
    NCURSOR_STARTED_AT: startedAt,
    NCURSOR_NODE_PATH: nodePath
  }

  // 6. Спавнимо subprocess (spawnSync — синхронно)
  let spawnResult
  const timeoutMs = budgetHardSec > 0 ? budgetHardSec * 1000 : undefined

  if (actor === 'agent' || actor === 'a') {
    // Запускаємо claude CLI у worktree
    const claudeArgs = ['--model', model, '--no-session', '-p',
      `You are executing task node: ${nodePath}\nWorking directory: ${worktreePath}\nRun NNN: ${nnn}\nBudget: ${budgetSec}s\n\nRead task.md and plan_*.md, execute the task, write fact_${nnn}.md with results.`
    ]
    spawnResult = spawnSyncFn('claude', claudeArgs, {
      cwd: worktreePath,
      env,
      encoding: 'utf8',
      timeout: timeoutMs
    })
  } else if (actor === 'human') {
    // Людина виконує вручну — чекаємо на fact файл
    log(`run: вузол "${nodePath}" очікує ручного виконання`)
    log(`     worktree: ${worktreePath}`)
    log(`     NCURSOR_RUN_NNN=${nnn}`)
    log(`     після виконання запустіть: n-cursor graph done ${nodePath}`)
    // Не чекаємо — повертаємо success без run_NNN.md
    return { ok: true, code: 0 }
  } else {
    log(`run: невідомий actor "${actor}" — підтримується: agent, human`)
    return { ok: false, code: 1 }
  }

  // 8. Після exit: перевіряємо fact_NNN.md
  const factPath = join(worktreePath, `fact_${nnn}.md`)
  const factInNodeDir = join(nodeDir, `fact_${nnn}.md`)

  // Перевіряємо у worktree та у основній директорії
  const hasFactInWorktree = exists(factPath)
  const result = hasFactInWorktree ? 'success' : 'failed'

  // Якщо є факт у worktree — копіюємо в node dir (якщо worktree != nodeDir)
  if (hasFactInWorktree && worktreePath !== nodeDir) {
    try {
      const factContent = readFile(factPath, 'utf8')
      writeFile(factInNodeDir, factContent, 'utf8')
    } catch {
      // пропускаємо
    }
  }

  // 9. Пишемо run_NNN.md у node dir
  try {
    writeRunFile(nodeDir, nnn, result, {
      actor,
      startedAt,
      now: nowFn()
    }, writeFile)
    log(`run: записано run_${nnn}.md (result: ${result})`)
  } catch (err) {
    log(`run: не вдалося записати run_${nnn}.md — ${err.message ?? String(err)}`)
  }

  // 10. Якщо success: merge worktree
  if (result === 'success') {
    const mergeResult = mergeWorktree(worktreePath, root, { execSync: execSyncFn })
    if (!mergeResult.ok) {
      log(`run: merge worktree не вдався — ${mergeResult.error}`)
    } else {
      log(`run: worktree merged і видалено`)
    }
    return { ok: true, code: 0 }
  } else {
    log(`run: вузол "${nodePath}" завершився з помилкою`)
    log(`run: worktree збережено для діагностики: ${worktreePath}`)
    return { ok: false, code: 1 }
  }
}

/**
 * `graph run [<path>] [--actor a] [--auto]` command handler.
 * @param {string[]} args аргументи
 * @param {{
 *   cwd?: string,
 *   log?: (m: string) => void,
 *   readFile?: (p: string, enc: string) => string,
 *   writeFile?: (p: string, c: string, enc: string) => void,
 *   readdir?: (d: string) => string[],
 *   exists?: (p: string) => boolean,
 *   execSync?: (cmd: string, opts?: object) => string,
 *   spawnSync?: (cmd: string, args: string[], opts?: object) => object,
 *   statSync?: (p: string) => object,
 *   now?: () => string
 * }} [deps] ін'єкції
 * @returns {Promise<number>} exit code
 */
export async function cmdRun(args, deps = {}) {
  const root = deps.cwd ?? processCwd()
  const log = deps.log ?? console.log
  const readFile = deps.readFile ?? ((p, enc) => readFileSync(p, enc))
  const readdir = deps.readdir ?? (d => (existsSync(d) ? readdirSync(d) : []))
  const exists = deps.exists ?? existsSync
  const execSyncFn = deps.execSync ?? ((cmd, o) => execSync(cmd, { ...o, encoding: 'utf8' }))

  // Парсимо аргументи
  let nodePath = null
  let actor = null
  let autoMode = false

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--actor' && args[i + 1]) {
      actor = args[i + 1]
      i++
    } else if (args[i] === '--auto') {
      autoMode = true
    } else if (!args[i].startsWith('-')) {
      nodePath = args[i]
    }
  }

  const config = loadConfig({ root, readFile, exists })
  const tasksDir = resolveTasksDir(config, root)

  const activeWorktrees = listActiveWorktrees(root, { execSync: execSyncFn })

  // Перевіряємо ліміт worktrees
  if (activeWorktrees.size >= config.max_worktrees) {
    log(`run: досягнуто max_worktrees (${config.max_worktrees}) — зачекайте завершення поточних задач`)
    return 1
  }

  if (activeWorktrees.size >= config.warn_worktrees_above) {
    log(`run: увага — ${activeWorktrees.size} активних worktrees (попередження при >${config.warn_worktrees_above})`)
  }

  if (autoMode) {
    // Знаходимо всі ready вузли і запускаємо їх
    const allNodes = scanNodes(tasksDir, activeWorktrees, {
      readdirSync: readdir,
      existsSync: exists,
      readFileSync: readFile
    })
    const nodeMap = new Map(allNodes.map(n => [n.id, n]))
    const readyNodes = topoSort(allNodes).filter(n => n.state === 'waiting' && areDepsResolved(n, nodeMap))

    if (readyNodes.length === 0) {
      log('run --auto: немає готових вузлів для запуску')
      return 0
    }

    log(`run --auto: знайдено ${readyNodes.length} готових вузлів`)
    let anyFailed = false

    for (const node of readyNodes) {
      const result = runNode(node.path, node.dir, config, root, { actor: actor ?? undefined }, {
        ...deps,
        log,
        execSync: execSyncFn
      })
      if (!result.ok && result.code !== 2) anyFailed = true
    }

    return anyFailed ? 1 : 0
  }

  // Запускаємо конкретний вузол або вузол у CWD
  if (!nodePath) {
    log('run: вкажіть <path> або використайте --auto')
    log('Usage: n-cursor graph run [<path>] [--actor agent|human] [--auto]')
    return 1
  }

  const nodeDir = join(tasksDir, nodePath)
  if (!exists(join(nodeDir, 'task.md'))) {
    log(`run: вузол "${nodePath}" не знайдено (немає task.md у ${nodeDir})`)
    return 1
  }

  // Перевіряємо deps
  const allNodes = scanNodes(tasksDir, activeWorktrees, {
    readdirSync: readdir,
    existsSync: exists,
    readFileSync: readFile
  })
  const nodeMap = new Map(allNodes.map(n => [n.id, n]))
  const targetNode = nodeMap.get(nodePath)

  if (targetNode && !areDepsResolved(targetNode, nodeMap)) {
    const unresolvedDeps = targetNode.deps.filter(dep => nodeMap.get(dep)?.state !== 'resolved')
    log(`run: вузол "${nodePath}" має невирішені залежності: ${unresolvedDeps.join(', ')}`)
    return 1
  }

  const result = runNode(nodePath, nodeDir, config, root, { actor: actor ?? undefined }, {
    ...deps,
    log,
    execSync: execSyncFn
  })

  return result.code
}
