/**
 * Активний Раннер (spec §8.1 Фасад B): `run`/`resume`/`cancel`/`repair`. Зшиває
 * ensureWorktree + planner + executor + verify у повний 5-фазний цикл. Уся IO
 * ін'єктується (`runner`/`verify`/`commit`/`run`/`now`) — тестується без
 * реальних LLM/git/gates.
 */
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { cwd as processCwd } from 'node:process'

import { BudgetExceeded, withBudget } from './budget.mjs'
import { ensureWorktree, realRun } from './commands.mjs'
import { flowEventsPath } from './events.mjs'
import { executePlan } from './executor.mjs'
import { generatePlan } from './planner.mjs'
import { runReview } from './reviewer.mjs'
import { cleanupFlowSiblings, flowStatePath, readState, updateState, writeState } from './state-store.mjs'
import { createRunner } from './subagent-runner.mjs'

/**
 * Дефолтний commit: `git add -A && git commit -m` у worktree.
 * @param {string} cwd worktree
 * @param {string} msg повідомлення
 * @returns {void}
 */
function defaultCommit(cwd, msg) {
  spawnSync('git', ['add', '-A'], { cwd })
  spawnSync('git', ['commit', '-m', msg], { cwd })
}

/**
 * Дефолтний verify для executor-а: проганяє gates і повертає verdict.
 * @param {string} cwd worktree
 * @returns {{ pass: boolean, failedOutput: string | null }} verdict
 */
function defaultVerify(cwd) {
  return runReview({ run: realRun, cwd, fingerprint: () => null })
}

/**
 * Читає `flow.autonomous` із `.n-cursor.json` (бюджет автономного режиму).
 * @param {string} cwd корінь
 * @returns {{ maxApiCalls?: number, maxCostUsd?: number, onBudgetExceeded?: string }} конфіг бюджету
 */
function readFlowAutonomous(cwd) {
  try {
    const cfg = JSON.parse(readFileSync(join(cwd, '.n-cursor.json'), 'utf8'))
    return cfg?.flow?.autonomous ?? {}
  } catch {
    return {}
  }
}

/**
 * `flow run [--autonomous] <branch> "<task>"` — повний цикл: ensureWorktree →
 * план → executor. У `--autonomous` runner обгортається budget guard-ом (§9.4).
 * @param {string[]} rest аргументи (`--autonomous` + `<branch> <task...>`)
 * @param {{ runner?: object, verify?: (cwd: string) => object, commit?: (cwd: string, msg: string) => void, run?: (cmd: string, args: string[], opts: object) => object, autonomous?: boolean, budget?: object, cwd?: string, log?: (m: string) => void, now?: () => number }} [deps] ін'єкції
 * @returns {Promise<number>} exit code: 0 done, 1 fail, 2 blocked-on-human
 */
export async function run(rest, deps = {}) {
  const log = deps.log ?? console.error
  const now = deps.now ?? Date.now
  const autonomous = deps.autonomous ?? rest.includes('--autonomous')
  const positional = rest.filter(a => !a.startsWith('--'))

  const ew = ensureWorktree(positional, deps)
  if (ew.code !== 0) return ew.code
  const { worktreeDir, branch, desc, baseCommit } = ew
  const statePath = flowStatePath(worktreeDir)
  writeState(statePath, {
    branch,
    status: 'in_progress',
    started_at: new Date(now()).toISOString(),
    metadata: { base_commit: baseCommit },
    plan: []
  })

  let runner
  try {
    runner = deps.runner ?? (await createRunner(deps))
  } catch (error) {
    log(`run: ${error.message}`)
    return 1
  }
  if (autonomous) {
    const budget = deps.budget ?? readFlowAutonomous(deps.cwd ?? processCwd())
    runner = withBudget(runner, { maxApiCalls: budget.maxApiCalls, log })
  }

  try {
    const plan = await generatePlan({ runner, task: desc, cwd: worktreeDir })
    updateState(statePath, s => ({ ...s, plan }))
    const result = await executePlan(
      { statePath, eventsPath: flowEventsPath(worktreeDir) },
      { runner, verify: deps.verify ?? defaultVerify, commit: deps.commit ?? defaultCommit, cwd: worktreeDir, log, now }
    )
    if (result.status === 'done') {
      log('run: build done — далі `flow release`')
      return 0
    }
    if (result.status === 'blocked-on-human') {
      log(`run: blocked-on-human на кроці ${result.step}`)
      return 2
    }
    return 1
  } catch (error) {
    if (error instanceof BudgetExceeded) {
      log(`run: ${error.message} — abort`)
      updateState(statePath, s => ({ ...s, status: 'failed' }))
      return 1
    }
    log(`run: ${error.message}`)
    return 1
  }
}

/**
 * `flow resume` — продовжує з чекпойнта. Safe-resume (§4.1.7): скидає частковий
 * доробок до останнього коміту; застосовує HITL-відповіді як підказки й дає
 * крокам свіжі спроби.
 * @param {string[]} _rest аргументи (не використовуються)
 * @param {object} [deps] ін'єкції (як у `run`)
 * @returns {Promise<number>} exit code
 */
export async function resume(_rest, deps = {}) {
  const cwd = deps.cwd ?? processCwd()
  const log = deps.log ?? console.error
  const now = deps.now ?? Date.now
  const run_ = deps.run ?? realRun

  const statePath = flowStatePath(cwd)
  const state = readState(statePath)
  if (!state) {
    log('resume: стану нема')
    return 1
  }

  const openHitl = (state.hitl ?? []).filter(q => !q.answer)
  if (state.status === 'blocked-on-human' && openHitl.length > 0) {
    log(`resume: ще blocked — ${openHitl.length} відкритих HITL-питань (заповни answer і повтори)`)
    return 2
  }
  if (!state.plan?.length) {
    log('resume: нема плану')
    return 1
  }

  // safe-resume: скинути частковий доробок невдалого кроку до останнього коміту
  run_('git', ['reset', '--hard', 'HEAD'], { cwd })

  // застосувати HITL-відповіді як hint + дати незавершеним крокам свіжі спроби
  const answers = new Map((state.hitl ?? []).filter(q => q.answer).map(q => [q.step, q.answer]))
  updateState(statePath, s => ({
    ...s,
    status: 'in_progress',
    plan: s.plan.map(st =>
      st.status === 'done'
        ? st
        : { ...st, retry_count: 0, ...(answers.has(st.step) ? { hint: answers.get(st.step) } : {}) }
    ),
    hitl: (s.hitl ?? []).map(q => (q.answer ? { ...q, status: 'answered' } : q))
  }))

  let runner
  try {
    runner = deps.runner ?? (await createRunner(deps))
  } catch (error) {
    log(`resume: ${error.message}`)
    return 1
  }

  const result = await executePlan(
    { statePath, eventsPath: flowEventsPath(cwd) },
    { runner, verify: deps.verify ?? defaultVerify, commit: deps.commit ?? defaultCommit, cwd, log, now }
  )
  if (result.status === 'done') return 0
  if (result.status === 'blocked-on-human') return 2
  return 1
}

/**
 * `flow cancel` — скасування: прибирає transient sibling-и (стан/журнал/lock).
 * @param {string[]} _rest аргументи
 * @param {{ cwd?: string, log?: (m: string) => void }} [deps] ін'єкції
 * @returns {Promise<number>} 0
 */
export async function cancel(_rest, deps = {}) {
  const cwd = deps.cwd ?? processCwd()
  const log = deps.log ?? console.error
  cleanupFlowSiblings(cwd)
  log('cancel: стан і sibling-и прибрано')
  return 0
}

/**
 * `flow repair [--discard-step-work]` — fail-closed escape: діагностика стану або
 * жорстке скидання робочого дерева до HEAD (свідоме викидання доробку).
 * @param {string[]} rest аргументи
 * @param {{ run?: (cmd: string, args: string[], opts: object) => object, cwd?: string, log?: (m: string) => void }} [deps] ін'єкції
 * @returns {Promise<number>} exit code
 */
export async function repair(rest, deps = {}) {
  const cwd = deps.cwd ?? processCwd()
  const log = deps.log ?? console.error
  const run_ = deps.run ?? realRun

  if (rest.includes('--discard-step-work')) {
    run_('git', ['reset', '--hard', 'HEAD'], { cwd })
    log('repair: робоче дерево скинуто до HEAD (--discard-step-work)')
    return 0
  }
  try {
    const state = readState(flowStatePath(cwd))
    log(state ? `repair: стан валідний (status: ${state.status})` : 'repair: стану нема')
    return 0
  } catch (error) {
    log(`repair: стан пошкоджено — ${error.message}. Спробуй \`flow repair --discard-step-work\` або \`flow cancel\`.`)
    return 1
  }
}
