/**
 * `flow spec [--panel] [<spec.md>]` — фаза дизайну (Пасивний Турнікет, lifecycle
 * §3). Фіксує `docs/specs/<date>-<slug>.md` (дизайн із brainstorm) у стані й
 * верифікує ланцюг через read-only `trace`. Код не пише; лінки front-matter
 * пише агент за контрактом `flow.mdc`.
 *
 * Brainstorm: human↔agent — у діалозі IDE-агента (контракт); agent↔agent —
 * `--panel` (панель персон → суддя, синтез презентується людині).
 */
import { existsSync, readFileSync } from 'node:fs'
import { cwd as processCwd } from 'node:process'

import { resolveArtifact, verifyTrace } from './artifact.mjs'
import { flowEventsPath } from './events.mjs'
import { runPanel } from './plan-panel.mjs'
import { createRunner } from './subagent-runner.mjs'
import { readState, recordTransition } from './state-store.mjs'
import { resolveActiveFlowState } from './flow-resolve.mjs'
import { parseFrontMatter } from '../trace.mjs'

/** Допустимі значення ризику у spec-frontmatter. */
const RISKS = new Set(['low', 'med', 'high'])

/**
 * Зчитує `risk` зі spec-frontmatter, якщо валідний (інакше — поточний у стані).
 * Так risk-нотатка у spec керує глибиною подальшого `flow review`.
 * @param {string} doc шлях spec-doc
 * @param {string | undefined} current поточний risk у стані
 * @returns {string | undefined} ризик
 */
function riskFromSpec(doc, current) {
  try {
    const fm = parseFrontMatter(readFileSync(doc, 'utf8'))
    return fm && RISKS.has(fm.risk) ? fm.risk : current
  } catch {
    return current
  }
}

/**
 * @param {string[]} rest аргументи (`--panel`, опц. `<spec.md>`)
 * @param {{ cwd?: string, log?: (m: string) => void, runner?: object, trace?: (cwd: string) => number, now?: () => number }} [deps] ін'єкції
 * @returns {Promise<number>} exit code (0 ok, 1 нема стану/доку)
 */
export async function spec(rest, deps = {}) {
  const cwd0 = deps.cwd ?? processCwd()
  const log = deps.log ?? console.error
  const resolved = resolveActiveFlowState({ cwd: cwd0, branch: deps.branch }, deps)
  if (!resolved.statePath) {
    log(`spec: ${resolved.error}`)
    return 1
  }
  if (resolved.autoResolved) log(`flow: авторезолвлено активний flow «${resolved.label}» (cwd поза worktree)`)
  const cwd = resolved.worktreeDir ?? cwd0
  const statePath = resolved.statePath
  const state = readState(statePath)
  if (!state) {
    log('spec: стану нема — спершу `flow init`')
    return 1
  }

  if (rest.includes('--panel')) {
    let runner = deps.runner
    if (!runner) {
      try {
        runner = await createRunner(deps)
      } catch (error) {
        log(`spec: ${error.message}`)
        return 1
      }
    }
    const synth = await runPanel({ task: state.branch, cwd, runner, log, mode: 'spec' })
    if (synth) {
      log('spec: панель синтезувала підходи (нижче) — збережи дизайн у docs/specs/ і повтори `flow spec`:')
      log(typeof synth === 'string' ? synth : JSON.stringify(synth))
    }
  }

  const doc = rest.find(a => a.endsWith('.md')) ?? resolveArtifact(cwd, 'specs', state.branch)
  if (!doc || !existsSync(doc)) {
    log('spec: нема docs/specs/<date>-<slug>.md — спершу пройди brainstorm (див. flow.mdc)')
    return 1
  }
  if (!verifyTrace(cwd, deps.trace)) {
    log('⚠️ spec: trace виявив розрив ланцюга — перевір лінки front-matter (adr/spec/plan)')
  }

  const risk = riskFromSpec(doc, state.risk)
  recordTransition(
    { statePath, eventsPath: flowEventsPath(cwd) },
    { type: 'spec' },
    s => ({ ...s, spec_doc: doc, risk, status: 'spec' }),
    deps.now ?? Date.now
  )
  log(`spec: зафіксовано ${doc} → status: spec (risk ${risk ?? '—'})`)
  return 0
}
