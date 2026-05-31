/**
 * Executor (spec §3 Ф3) — виконує план покроково через SubagentRunner + verify.
 *
 * Інваріанти:
 *  - **мікропромпт зі стану** (§3 Ф3): субагент отримує лише поточний крок +
 *    критерії + останню помилку, не історію переписки;
 *  - **commit лише після зеленого verify** (§4.1.7): repair-спроби не комітять,
 *    тож HEAD завжди = останній зелений крок;
 *  - **repair ≤ maxRepairAttempts**, далі — HITL (`blocked-on-human`, §4.2).
 *
 * Усі побічні дії (`runner`/`verify`/`commit`) ін'єктуються — тестується без
 * реальних LLM/git/gates.
 */
import { readState, recordTransition } from './state-store.mjs'

/**
 * Мікропромпт для кроку (§3 Ф3): лише поточний крок + критерії + остання помилка.
 * @param {{ step: number, task: string, acceptance?: string, last_error?: string }} step крок плану
 * @param {{ branch?: string }} state стан (для контексту гілки)
 * @returns {string} промпт субагента
 */
export function microprompt(step, state) {
  const lines = [
    'Реалізуй РІВНО цей крок плану (не більше). Iron Law of TDD: спершу падаючі тести, тоді код.',
    `Гілка: ${state.branch ?? '—'}`,
    `Крок ${step.step}: ${step.task}`
  ]
  if (step.acceptance) lines.push(`Критерії приймання: ${step.acceptance}`)
  if (step.hint) lines.push(`Підказка людини (HITL): ${step.hint}`)
  if (step.last_error) lines.push(`Попередня спроба впала на перевірці:\n${step.last_error}\nВиправ це.`)
  return lines.join('\n')
}

/**
 * Оновлює крок плану за індексом (pure).
 * @param {{ plan: object[] }} state стан
 * @param {number} index індекс кроку
 * @param {object} patch часткове оновлення кроку
 * @returns {object} новий стан
 */
export function patchStep(state, index, patch) {
  return { ...state, plan: state.plan.map((s, i) => (i === index ? { ...s, ...patch } : s)) }
}

/**
 * Виконує план зі стану.
 * @param {{ statePath: string, eventsPath: string }} paths шляхи стану й журналу
 * @param {{ runner: { runStep: (prompt: string, opts?: object) => object }, verify: (cwd: string) => Promise<{ pass: boolean, failedOutput?: string }> | { pass: boolean, failedOutput?: string }, commit: (cwd: string, msg: string) => void, cwd?: string, maxRepairAttempts?: number, log?: (m: string) => void, now?: () => number }} deps ін'єкції
 * @returns {Promise<{ status: 'done' | 'blocked-on-human', step?: number }>} результат
 */
export async function executePlan(paths, deps) {
  const { runner, verify, commit, cwd, maxRepairAttempts = 3, log = () => {}, now = Date.now } = deps
  let state = readState(paths.statePath)
  if (!state?.plan?.length) {
    throw new Error('executor: у стані немає плану — спершу planner')
  }

  for (let i = 0; i < state.plan.length; i++) {
    if (state.plan[i].status === 'done') continue

    let done = false
    while (state.plan[i].retry_count < maxRepairAttempts && !done) {
      const step = state.plan[i]
      log(`executor: крок ${step.step} (спроба ${step.retry_count + 1})`)
      await runner.runStep(microprompt(step, state), { cwd })
      const verdict = await verify(cwd)
      if (verdict.pass) {
        commit(cwd, `flow: step ${step.step} — ${step.task}`) // commit ЛИШЕ після зеленого
        state = recordTransition(paths, { type: 'step_done', step: step.step }, s => patchStep(s, i, { status: 'done' }), now)
        done = true
      } else {
        state = recordTransition(
          paths,
          { type: 'step_retry', step: step.step },
          s => patchStep(s, i, { retry_count: s.plan[i].retry_count + 1, last_error: verdict.failedOutput ?? null }),
          now
        )
      }
    }

    if (!done) {
      const failed = state.plan[i]
      const question = {
        id: `q-${i}`,
        step: failed.step,
        question: `Крок ${failed.step} «${failed.task}» не проходить verify після ${maxRepairAttempts} спроб. Що робити?`,
        status: 'open',
        answer: ''
      }
      recordTransition(
        paths,
        { type: 'blocked', step: failed.step },
        s => ({ ...s, status: 'blocked-on-human', hitl: [...(s.hitl ?? []), question] }),
        now
      )
      return { status: 'blocked-on-human', step: failed.step }
    }
  }

  recordTransition(paths, { type: 'plan_done' }, s => ({ ...s, status: 'built' }), now)
  return { status: 'done' }
}
