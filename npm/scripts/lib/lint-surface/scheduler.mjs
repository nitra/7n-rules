/**
 * Bounded two-lane concurrent scheduler для `detectAll()` (ADR 260716-1354). Активний лише
 * коли `concurrency > 1` (деталі — `run-detectors.mjs`); за замовчуванням (`concurrency === 1`)
 * `detectAll` лишається на повністю послідовному шляху, спостережувано ідентичному до-ADR
 * поведінці — ця функція там навіть не викликається.
 *
 * Два лейни за `isSerial(item)`: **serial lane** — власний sequential runner (mutex за
 * конструкцією, items ніколи не перекриваються самі з собою); **parallel lane** — bounded
 * pool до `concurrency` слотів. Обидва лейни виконуються конкурентно один з одним — свідомий
 * вибір: serial-lane item, коли реально виконує свій blocking `spawnSync`, все одно заморожує
 * весь event loop (тобто "конкурентність" із parallel lane суто структурна, не робить
 * serial-lane item швидшим), а parallel-lane пул отримує реальну вигоду від одночасного
 * очікування кількох `spawnAsync`-викликів.
 *
 * Перший виняток від `runItem` зупиняє нові старти в обох лейнах, `controller.abort()`
 * сигналізує вже запущеним async-детекторам, і функція чекає завершення всіх уже
 * стартованих items (кожен `runOne` сам ловить власну помилку — жоден виклик не відхиляє
 * зовнішній `Promise.all`) перед поверненням.
 */

/**
 * @template T, R
 * @typedef {object} PlanItemOutcome
 * @property {T} item вхідний item
 * @property {R} [result] результат `runItem`, якщо завершився успішно
 * @property {unknown} [error] помилка `runItem` (перша — стає `infraError`)
 * @property {boolean} [aborted] true — item отримав `AbortError` уже ПІСЛЯ того, як інший item
 *   зупинив плановий прогін (очікуване скасування, не нова інфра-помилка)
 */

/**
 * @template T, R
 * @param {T[]} items вхідний план (в оригінальному порядку)
 * @param {object} opts опції планування
 * @param {number} opts.concurrency bounded pool розмір для parallel lane (мінімум 1)
 * @param {(item: T) => boolean} opts.isSerial чи item належить serial lane
 * @param {(item: T, signal: AbortSignal) => Promise<R>} opts.runItem виконує один item;
 *   кидання зупиняє планування нових items і абортить `signal`
 * @returns {Promise<{ results: PlanItemOutcome<T, R>[], infraError: unknown|null }>}
 *   `results` — лише items, що реально стартували (в порядку завершення, не вхідному);
 *   `infraError` — перша помилка `runItem`, або `null`, якщо всі items завершились успішно
 */
export async function runPlanConcurrently(items, { concurrency, isSerial, runItem }) {
  const controller = new AbortController()
  const parallelItems = []
  const serialItems = []
  for (const item of items) (isSerial(item) ? serialItems : parallelItems).push(item)

  /** @type {PlanItemOutcome<T, R>[]} */
  const results = []
  let infraError = null
  let stopped = false

  const runOne = async item => {
    if (stopped) return
    try {
      const result = await runItem(item, controller.signal)
      results.push({ item, result })
    } catch (error) {
      if (stopped && error?.name === 'AbortError') {
        results.push({ item, aborted: true })
        return
      }
      results.push({ item, error })
      if (!stopped) {
        stopped = true
        infraError = error
        controller.abort()
      }
    }
  }

  const runSerialLane = async () => {
    for (const item of serialItems) {
      if (stopped) break
      await runOne(item)
    }
  }

  const runParallelLane = async () => {
    let next = 0
    const worker = async () => {
      while (!stopped) {
        const i = next++
        if (i >= parallelItems.length) return
        await runOne(parallelItems[i])
      }
    }
    const workerCount = Math.min(concurrency, parallelItems.length)
    await Promise.all(Array.from({ length: workerCount }, worker))
  }

  await Promise.all([runSerialLane(), runParallelLane()])

  return { results, infraError }
}
