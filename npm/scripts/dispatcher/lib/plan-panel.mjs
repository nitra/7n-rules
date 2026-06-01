/**
 * Agent↔agent brainstorm (bmad party-mode + superpowers dispatching у наших
 * термінах): персони-субагенти пропонують погляди, суддя-субагент синтезує одну
 * відповідь. Спільний для фази `spec` (mode: 'spec' — підходи) і `plan`
 * (mode: 'plan' — JSON-кроки). Перевикористовує runner-інтерфейс Фасада B
 * (`runStep(prompt, opts) => { ok, output }`, як `planner.mjs`/`active.mjs`).
 *
 * HITL: panel лише ПОВЕРТАЄ синтез — апрув людини й збереження артефакту робить
 * агент за контрактом `flow.mdc` (фіксація — окрема команда `flow spec`/`flow plan`).
 */

/** Персони панелі: [ім'я, системний промпт]. */
const PERSONAS = [
  ['architect', 'Ти — architect. Запропонуй найчистішу архітектуру розв’язання. Стисло, по суті.'],
  ['skeptic', 'Ти — skeptic. Назви ризики, граничні випадки і що може піти не так. Стисло.'],
  ['tester', 'Ти — tester. Опиши, які тести доведуть коректність. Стисло.']
]

/**
 * Промпт судді за режимом.
 * @param {'spec' | 'plan'} mode режим синтезу
 * @param {string} proposals склеєні думки персон
 * @param {string} task опис задачі
 * @returns {string} промпт судді
 */
function judgePrompt(mode, proposals, task) {
  const head =
    mode === 'plan'
      ? [
          'Синтезуй із думок персон ОДИН покроковий план реалізації.',
          'Кожен крок — ≤ 5 хв розробки, з критерієм приймання.',
          'Поверни ЛИШЕ JSON-масив без коментарів: [{ "task": "...", "acceptance": "..." }, ...].'
        ]
      : [
          'Синтезуй із думок персон 2-3 підходи до розв’язання з рекомендацією й коротким дизайном.',
          'Поверни людино-читабельний текст (Markdown).'
        ]
  return [...head, '', proposals, '', `Задача: ${task}`].join('\n')
}

/**
 * Проводить панель і повертає синтез.
 * @param {{ task: string, cwd: string, runner: { runStep: (p: string, o?: object) => { ok: boolean, output: string } | Promise<{ ok: boolean, output: string }> }, log?: (m: string) => void, mode?: 'spec' | 'plan' }} input ін'єкції
 * @returns {Promise<{ task: string, acceptance?: string }[] | string | null>} кроки (plan), текст (spec) або null (фейл)
 */
export async function runPanel({ task, cwd, runner, log = console.error, mode = 'plan' }) {
  if (!runner) {
    log('panel: нема runner — режим --panel недоступний')
    return null
  }
  const proposals = await Promise.all(
    PERSONAS.map(async ([name, sys]) => {
      const r = await runner.runStep(`${sys}\n\nЗадача: ${task}`, { cwd })
      return `### ${name}\n${r.ok ? r.output : '(порожньо)'}`
    })
  )
  const judge = await runner.runStep(judgePrompt(mode, proposals.join('\n\n'), task), { cwd })
  if (!judge.ok) {
    log('panel: суддя-синтез завершився помилкою')
    return null
  }
  if (mode === 'spec') return judge.output

  const start = judge.output.indexOf('[')
  const end = judge.output.lastIndexOf(']')
  if (start === -1 || end === -1 || end < start) {
    log('panel: суддя не повернув JSON-план')
    return null
  }
  try {
    return JSON.parse(judge.output.slice(start, end + 1))
  } catch {
    log('panel: невалідний JSON синтезу')
    return null
  }
}
