/**
 * SubagentRunner — спавн субагента через pi (провайдер-нейтрально).
 * Модель обирається через resolveModel('avg') (каскад local→cloud) або через deps.model.
 *
 * Контракт runner-а: { backend: 'pi', runStep(prompt, { cwd }) → Promise<{ ok, output }> }.
 * Усі callers (planner, executor, plan-panel, review, budget) використовують саме цей контракт.
 *
 * pi НЕ спавниться рекурсивно коли pi — зовнішній драйвер (§9.1).
 * У цьому проєкті зовнішній драйвер — Claude Code; pi як субагент — безпечно.
 */
import { spawnSync } from 'node:child_process'

import { resolveModel } from '../../../lib/models.mjs'

/**
 * Викликає pi і повертає { ok, output }.
 * @param {string} prompt текст промпта
 * @param {string} model  provider/model-id або '' для pi-дефолту
 * @param {{ cwd?: string }} [opts] опційні параметри (cwd)
 * @returns {{ ok: boolean, output: string }} результат із статусом і output
 */
function callPi(prompt, model, { cwd } = {}) {
  const modelArgs = model ? ['--model', model] : []
  const r = spawnSync('pi', ['-p', prompt, ...modelArgs, '--no-session'], {
    cwd,
    encoding: 'utf8',
    timeout: 600_000
  })
  const ok = !r.error && r.status === 0
  const output = (r.stdout ?? '') + (r.error ? r.error.message : (ok ? '' : (r.stderr ?? '')))
  return { ok, output }
}

/**
 * Створює pi-runner. Повертає { backend: 'pi', runStep }.
 * @param {{ model?: string, callPi?: Function }} [deps]  ін'єкції для тестів
 * @returns {Promise<{ backend: string, runStep: (prompt: string, opts?: object) => Promise<{ ok: boolean, output: string }> }>} runner із backend='pi' і методом runStep
 */
export function createRunner(deps = {}) {
  const model = deps.model ?? resolveModel('avg')
  const callPiFn = deps.callPi ?? callPi

  return {
    backend: 'pi',
    runStep(prompt, opts = {}) {
      try {
        return callPiFn(prompt, model, opts)
      } catch (error) {
        return { ok: false, output: String(error?.message ?? error) }
      }
    }
  }
}
