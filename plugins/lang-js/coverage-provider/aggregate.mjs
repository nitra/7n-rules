/**
 * Сумування coverage/mutation totals — спільна утиліта для collector-ів
 * (js-collector.mjs) і оркестратора (coverage.mjs). Винесено в окремий модуль,
 * щоб уникнути циклічного імпорту collector ↔ orchestrator.
 */

/**
 * Сума двох coverage-totals.
 * @param {{lines:{covered:number,total:number}, functions:{covered:number,total:number}}} a перший subtotal
 * @param {{lines:{covered:number,total:number}, functions:{covered:number,total:number}}} b другий subtotal
 * @returns {{lines:{covered:number,total:number}, functions:{covered:number,total:number}}} сумарні lines/functions
 */
export function addCoverage(a, b) {
  return {
    lines: { covered: a.lines.covered + b.lines.covered, total: a.lines.total + b.lines.total },
    functions: {
      covered: a.functions.covered + b.functions.covered,
      total: a.functions.total + b.functions.total
    }
  }
}

/**
 * Сума двох mutation-counts.
 * @param {{caught:number,total:number}} a перший subtotal
 * @param {{caught:number,total:number}} b другий subtotal
 * @returns {{caught:number,total:number}} сумарні caught/total
 */
export function addMutation(a, b) {
  return { caught: a.caught + b.caught, total: a.total + b.total }
}
