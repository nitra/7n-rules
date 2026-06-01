/**
 * Декларативний планувальник (spec §3 Ф1). Просить субагента видати суворий
 * покроковий JSON-план, парсить і **валідує** його (fail-closed на невалідному).
 * Нормалізує кроки до `{ step, task, status: 'pending', retry_count: 0 }`.
 */

/** Заборонені плейсхолдер-значення `task` (план із ними — не план, fail-closed). */
const PLACEHOLDER = /^(tbd|todo|fixme|\.\.\.|placeholder)$/i

/**
 * Системно-користувацький промпт планувальника.
 * @param {string} task опис фічі
 * @returns {string} промпт
 */
export function plannerPrompt(task) {
  return [
    'Ти — архітектор. Розбий задачу на суворий покроковий план реалізації.',
    'Кожен крок — ≤ 5 хв розробки, з чіткими критеріями приймання коду.',
    'Поверни ЛИШЕ JSON-масив без коментарів: [{ "task": "...", "acceptance": "..." }, ...].',
    '',
    `Задача: ${task}`
  ].join('\n')
}

/**
 * Парсить і валідує план із тексту відповіді (толерує markdown-огорожу).
 * @param {string} text відповідь субагента
 * @returns {{ step: number, task: string, status: string, retry_count: number, acceptance?: string }[]} нормалізований план
 */
export function parsePlan(text) {
  const str = String(text)
  const start = str.indexOf('[')
  const end = str.lastIndexOf(']')
  if (start === -1 || end === -1 || end < start) {
    throw new Error('planner: не знайдено JSON-масив плану — fail-closed')
  }
  let arr
  try {
    arr = JSON.parse(str.slice(start, end + 1))
  } catch {
    throw new Error('planner: невалідний JSON плану — fail-closed')
  }
  if (!Array.isArray(arr) || arr.length === 0) {
    throw new Error('planner: план має бути непорожнім масивом — fail-closed')
  }
  return arr.map((s, i) => {
    const task = typeof s === 'string' ? s : s?.task
    if (!task || typeof task !== 'string') {
      throw new Error(`planner: крок ${i} без текстового поля task — fail-closed`)
    }
    const trimmed = task.trim()
    if (!trimmed || PLACEHOLDER.test(trimmed)) {
      throw new Error(`planner: крок ${i} — placeholder/порожній task (${task}) — fail-closed`)
    }
    const step = { step: i, task, status: 'pending', retry_count: 0 }
    if (s?.acceptance) step.acceptance = String(s.acceptance)
    return step
  })
}

/**
 * Генерує план через субагента-планувальника.
 * @param {{ runner: { runStep: (prompt: string, opts?: object) => { ok: boolean, output: string } | Promise<{ ok: boolean, output: string }> }, task: string, cwd?: string }} input ін'єкції
 * @returns {Promise<object[]>} нормалізований план
 */
export async function generatePlan({ runner, task, cwd }) {
  const res = await runner.runStep(plannerPrompt(task), { cwd })
  if (!res.ok) {
    const detail = res.output ? `:\n${res.output}` : ''
    throw new Error(`planner: субагент-планувальник завершився помилкою${detail}`)
  }
  return parsePlan(res.output)
}
