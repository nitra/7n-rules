/**
 * Budget guard для автономного режиму (spec §9.4): обгортає SubagentRunner
 * лічильником викликів і кидає `BudgetExceeded` при перевищенні `maxApiCalls`.
 * Це запобіжник проти неконтрольованих витрат на сервері (де нема людини).
 *
 * (`maxCostUsd` — коли runner повертатиме tokens/cost; наразі рахуємо виклики.)
 */

/** Помилка перевищення бюджету (ловиться в `run`, §9.4). */
export class BudgetExceeded extends Error {}

/**
 * Обгортає runner лічильником API-викликів.
 * @param {{ backend?: string, runStep: (prompt: string, opts?: object) => object }} runner базовий runner
 * @param {{ maxApiCalls?: number, log?: (m: string) => void }} [opts] ліміт і лог
 * @returns {{ backend: string, runStep: (prompt: string, opts?: object) => Promise<object>, readonly calls: number }} обгорнутий runner
 */
export function withBudget(runner, opts = {}) {
  const maxApiCalls = opts.maxApiCalls ?? Number.POSITIVE_INFINITY
  const log = opts.log ?? (() => {})
  let calls = 0
  return {
    backend: runner.backend,
    get calls() {
      return calls
    },
    async runStep(prompt, stepOpts) {
      if (calls >= maxApiCalls) {
        throw new BudgetExceeded(`budget: вичерпано maxApiCalls=${maxApiCalls}`)
      }
      calls += 1
      log(`budget: API-виклик ${calls}/${maxApiCalls}`)
      return runner.runStep(prompt, stepOpts)
    }
  }
}
