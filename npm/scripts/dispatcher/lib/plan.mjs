/**
 * `flow plan [--panel] [<plan.md>]` — фаза плану (Пасивний Турнікет, lifecycle
 * §4). Фіксує `docs/plans/<date>-<slug>.md`: дзеркалить кроки (`## Кроки`) у
 * `.flow.json plan[]`, виставляє `status: planned`, верифікує ланцюг через
 * read-only `trace`. Код не пише; лінки front-matter (`spec`/`flow`) пише агент.
 *
 * Brainstorm: human↔agent (агент пише plan-doc у діалозі) або agent↔agent
 * (`--panel`: панель персон → суддя синтезує кроки).
 */
import { existsSync, readFileSync } from 'node:fs'
import { cwd as processCwd } from 'node:process'

import { extractSteps, resolveArtifact, verifyTrace } from './artifact.mjs'
import { flowEventsPath } from './events.mjs'
import { parsePlan } from './planner.mjs'
import { runPanel } from './plan-panel.mjs'
import { createRunner } from './subagent-runner.mjs'
import { flowStatePath, readState, recordTransition } from './state-store.mjs'

/**
 * @param {string[]} rest аргументи (`--panel`, опц. `<plan.md>`)
 * @param {{ cwd?: string, log?: (m: string) => void, runner?: object, trace?: (cwd: string) => number, now?: () => number }} [deps] ін'єкції
 * @returns {Promise<number>} exit code (0 ok, 1 нема стану/доку/невалідний план)
 */
export async function plan(rest, deps = {}) {
  const cwd = deps.cwd ?? processCwd()
  const log = deps.log ?? console.error
  const statePath = flowStatePath(cwd)
  const state = readState(statePath)
  if (!state) {
    log('plan: стану нема — спершу `flow init`')
    return 1
  }
  if (state.status !== 'spec' && !state.spec_doc) {
    log('plan: дизайн ще не зафіксовано — рекомендовано спершу `flow spec` (не блокує)')
  }

  const doc = rest.find(a => a.endsWith('.md')) ?? resolveArtifact(cwd, 'plans')
  let steps
  if (rest.includes('--panel')) {
    let runner = deps.runner
    if (!runner) {
      try {
        runner = await createRunner(deps)
      } catch (error) {
        log(`plan: ${error.message}`)
        return 1
      }
    }
    steps = await runPanel({ task: state.branch, cwd, runner, log, mode: 'plan' })
    if (!steps) return 1
  } else {
    if (!doc || !existsSync(doc)) {
      log('plan: нема docs/plans/<date>-<slug>.md — спершу пройди brainstorm (див. flow.mdc)')
      return 1
    }
    steps = extractSteps(readFileSync(doc, 'utf8'))
  }

  let normalized
  try {
    normalized = parsePlan(JSON.stringify(steps))
  } catch (error) {
    log(`plan: ${error.message}`)
    return 1
  }

  if (!verifyTrace(cwd, deps.trace)) {
    log('⚠️ plan: trace виявив розрив ланцюга — перевір лінки spec/plan/flow')
  }

  recordTransition(
    { statePath, eventsPath: flowEventsPath(cwd) },
    { type: 'plan', steps: normalized.length },
    s => ({ ...s, plan: normalized, plan_doc: doc ?? null, status: 'planned' }),
    deps.now ?? Date.now
  )
  log(`plan: зафіксовано ${normalized.length} кроків → status: planned`)
  return 0
}
