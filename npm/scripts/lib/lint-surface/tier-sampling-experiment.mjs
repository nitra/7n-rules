/**
 * Експериментальний harness для перевірки sampling/consensus поверх lint fix ladder.
 *
 * Модуль не підключений до production `runFixPipeline`: він моделює isolated candidates
 * для заданого tier-а, кожен раз відкочує робоче дерево до S1, вибирає тільки candidate,
 * який пройшов canonical detect, і лишає judge/consensus лише джерелом feedback.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

import { createSnapshot } from './snapshot.mjs'

/** Порядок tier-ів експериментального ladder — від локальної моделі до найсильнішої хмарної. */
export const EXPERIMENT_TIER_ORDER = Object.freeze(['local-min', 'cloud-min', 'cloud-avg', 'cloud-max'])

const DEFAULT_LOCAL_TIMEOUT_MS = 300_000
const DEFAULT_CLOUD_TIMEOUT_MS = 300_000

const DEFAULT_PROFILES_BY_TIER = Object.freeze({
  'local-min': ['conservative'],
  'cloud-min': ['conservative', 'exploratory'],
  'cloud-avg': ['conservative', 'exploratory'],
  'cloud-max': ['conservative']
})

/**
 * @typedef {object} ExperimentRung
 * @property {'local-min'|'cloud-min'|'cloud-avg'|'cloud-max'} tier Ідентифікатор tier-а в експериментальному ladder.
 * @property {string} model Назва моделі, що виконує fix на цьому rung-і.
 * @property {boolean} feedback Чи передавати judge-feedback у контекст fix-у.
 * @property {boolean} local Чи виконується rung локальною моделлю.
 * @property {boolean} isAvg Чи це rung рівня cloud-avg.
 * @property {boolean} isMax Чи це rung рівня cloud-max.
 * @property {boolean} experimentOnly Позначка, що rung існує лише в експерименті, не в production ladder.
 * @property {number} timeoutMs Стеля часу виконання одного кандидата, мс.
 */

/**
 * @typedef {object} SamplingCandidate
 * @property {string} id Унікальний ідентифікатор кандидата в межах прогону.
 * @property {'conservative'|'exploratory'|'judge'|string} samplingProfile Sampling-профіль, з яким запускається кандидат.
 */

/**
 * @typedef {object} CandidateAttempt
 * @property {number} index Порядковий номер кандидата у списку.
 * @property {string} id Ідентифікатор кандидата.
 * @property {string} samplingProfile Sampling-профіль кандидата.
 * @property {string} tier Tier rung-а, на якому виконувався кандидат.
 * @property {string} model Модель, що виконувала fix.
 * @property {boolean} clean Чи пройшов кандидат canonical detect без залишкових порушень.
 * @property {string[]} touchedFiles Абсолютні шляхи файлів, які кандидат змінив.
 * @property {number} changedBytes Сумарний розмір captured patch у байтах.
 * @property {number} wallMs Тривалість спроби, мс.
 * @property {string|null} error Повідомлення помилки worker-а або null.
 * @property {import('./types.mjs').LintViolation[]} violations Порушення, що лишилися після спроби.
 * @property {object|undefined} telemetry Телеметрія worker-а, якщо він її повернув.
 * @property {Array<{ absPath: string, exists: boolean, content: string }>} patch Знімок змінених файлів чистого кандидата.
 */

/**
 * Будує experiment-only ladder із `cloud-max`. Production ladder це не змінює.
 * @param {{ localMin?: string, cloudMin?: string, cloudAvg?: string, cloudMax?: string }} models - Об'єкт, що містить імена моделей для кожного tier.
 * @param {{ localTimeoutMs?: number, cloudTimeoutMs?: number }} [opts] - Опції для встановлення timeout для локального та хмарного етапу.
 * @returns {ExperimentRung[]} Масив експериментальних rung'ів (етапів).
 */
export function buildExperimentLadder(models, opts = {}) {
  const localTimeoutMs = opts.localTimeoutMs ?? DEFAULT_LOCAL_TIMEOUT_MS
  const cloudTimeoutMs = opts.cloudTimeoutMs ?? DEFAULT_CLOUD_TIMEOUT_MS
  return [
    {
      tier: 'local-min',
      model: models.localMin ?? '',
      feedback: false,
      local: true,
      isAvg: false,
      isMax: false,
      experimentOnly: true,
      timeoutMs: localTimeoutMs
    },
    {
      tier: 'cloud-min',
      model: models.cloudMin ?? '',
      feedback: true,
      local: false,
      isAvg: false,
      isMax: false,
      experimentOnly: true,
      timeoutMs: cloudTimeoutMs
    },
    {
      tier: 'cloud-avg',
      model: models.cloudAvg ?? '',
      feedback: true,
      local: false,
      isAvg: true,
      isMax: false,
      experimentOnly: true,
      timeoutMs: cloudTimeoutMs
    },
    {
      tier: 'cloud-max',
      model: models.cloudMax ?? '',
      feedback: true,
      local: false,
      isAvg: false,
      isMax: true,
      experimentOnly: true,
      timeoutMs: cloudTimeoutMs
    }
  ].filter(r => r.model)
}

/**
 * Повертає можливі sampling profiles для заданого tier-а.
 * @param {string} tier - Назва tier (наприклад, 'local-min').
 * @param {Record<string, Array<string|SamplingCandidate>>} [overrides] - Об'єкт з перевизначеними profiles для конкретного tier.
 * @returns {SamplingCandidate[]} Масив об'єктів SamplingCandidate для даного tier.
 */
export function samplingProfilesForTier(tier, overrides = {}) {
  const raw = overrides[tier] ?? DEFAULT_PROFILES_BY_TIER[tier] ?? ['conservative']
  return raw.map((p, index) => {
    if (typeof p === 'string') return { id: `${tier}:${p}:${index}`, samplingProfile: p }
    return { id: p.id ?? `${tier}:${p.samplingProfile}:${index}`, samplingProfile: p.samplingProfile }
  })
}

/**
 * Дефолтний вибір найкращого (clean) кандидата серед усіх спроб.
 * Вибір відбувається за критеріями: менша кількість змінених файлів, менший розмір patch, менша латентність.
 * @param {CandidateAttempt[]} attempts - Масив усіх спроб (candidates).
 * @returns {CandidateAttempt|null} Найкращий чистий кандидат, або null, якщо жоден не знайдено.
 */
export function chooseCleanCandidate(attempts) {
  const clean = attempts.filter(a => a.clean)
  if (clean.length === 0) return null
  return clean.toSorted((a, b) => {
    const byTouched = a.touchedFiles.length - b.touchedFiles.length
    if (byTouched !== 0) return byTouched
    const byBytes = a.changedBytes - b.changedBytes
    if (byBytes !== 0) return byBytes
    const byTime = a.wallMs - b.wallMs
    if (byTime !== 0) return byTime
    return a.index - b.index
  })[0]
}

/**
 * Виконує послідовність випробувань (sampling) для одного tier.
 * Для кожного кандидата виконується rollback до S1, запускається worker,
 * оцінюється чистота, і якщо кандидат обраний, застосовується його patch.
 * @param {object} args - Аргументи для експерименту.
 * @param {import('./types.mjs').LintViolation[]} args.violations - Початкові порушення для перевірки.
 * @param {object} args.ctx - Базовий контекст для фіксації.
 * @param {ExperimentRung} args.rung - Конфігурація поточного експерименту.
 * @param {SamplingCandidate[]} args.candidates - Список кандидатів для тестування.
 * @param {(violations: import('./types.mjs').LintViolation[], ctx: object) => Promise<{ touchedFiles?: string[], telemetry?: object }|void>} args.worker - Функція для виконання фіксу.
 * @param {(ctx: object) => Promise<import('./types.mjs').LintViolation[]> | import('./types.mjs').LintViolation[]} args.detect - Функція для перевірки порушень після застосування/умовами.
 * @param {(attempts: CandidateAttempt[]) => CandidateAttempt|null} [args.choose] - Стратегія вибору найкращого кандидата.
 * @param {(ctx: object) => Promise<object|null> | object | null} [args.judge] - Функція для відгуку судді (judge).
 * @param {() => number} [args.clock] - Функція для отримання часу.
 * @returns {Promise<{ clean: boolean, selected: CandidateAttempt|null, attempts: CandidateAttempt[], finalViolations: import('./types.mjs').LintViolation[], judgeFeedback: object|null }>} Результат виконання експерименту.
 */
export async function runTierSamplingExperiment(args) {
  const choose = args.choose ?? chooseCleanCandidate
  const clock = args.clock ?? (() => Date.now())
  const snapshot = createSnapshot()
  /** @type {CandidateAttempt[]} */
  const attempts = []

  for (const [index, candidate] of args.candidates.entries()) {
    snapshot.rollback()
    const recordedThisCandidate = new Set()
    const startedAt = clock()
    let error = null
    let telemetry
    /** @type {string[]} */
    let touchedFiles

    const candidateCtx = {
      ...args.ctx,
      tier: args.rung.tier,
      model: args.rung.model,
      feedback: args.rung.feedback ? args.ctx.feedback : undefined,
      samplingProfile: candidate.samplingProfile,
      candidateId: candidate.id,
      recordWrite(absPath) {
        recordedThisCandidate.add(absPath)
        snapshot.record(absPath)
      }
    }

    try {
      const res = await args.worker(args.violations, candidateCtx)
      touchedFiles = uniqueStrings(res?.touchedFiles?.length ? res.touchedFiles : [...recordedThisCandidate])
      telemetry = res?.telemetry
    } catch (workerError) {
      error = workerError.message
      touchedFiles = uniqueStrings([...recordedThisCandidate])
    }

    const detected = await args.detect({ ...candidateCtx, phase: 'candidate-detect' })
    const patch = detected.length === 0 && !error ? captureFiles(touchedFiles) : []
    attempts.push({
      index,
      id: candidate.id,
      samplingProfile: candidate.samplingProfile,
      tier: args.rung.tier,
      model: args.rung.model,
      clean: detected.length === 0 && !error,
      touchedFiles,
      changedBytes: patchSize(patch),
      wallMs: clock() - startedAt,
      error,
      violations: detected,
      telemetry,
      patch
    })
  }

  snapshot.rollback()
  const selected = choose(attempts)
  if (!selected) {
    const judgeFeedback = args.judge ? await args.judge({ ...args.ctx, rung: args.rung, attempts }) : null
    return { clean: false, selected: null, attempts, finalViolations: attempts.at(-1)?.violations ?? [], judgeFeedback }
  }

  applyCapturedFiles(selected.patch, snapshot)
  const finalViolations = await args.detect({
    ...args.ctx,
    tier: args.rung.tier,
    model: args.rung.model,
    samplingProfile: selected.samplingProfile,
    candidateId: selected.id,
    phase: 'final-detect'
  })
  if (finalViolations.length > 0) {
    snapshot.rollback()
    return { clean: false, selected: null, attempts, finalViolations, judgeFeedback: null }
  }
  return { clean: true, selected, attempts, finalViolations, judgeFeedback: null }
}

/**
 * Видаляє дублікати з масиву рядків.
 * @param {string[]} values - Вхідний масив рядків.
 * @returns {string[]} Масив унікальних рядків.
 */
function uniqueStrings(values) {
  return [...new Set(values.filter(v => typeof v === 'string' && v.length > 0))]
}

/**
 * Збирає вміст файлів, зазначених у шляхах.
 * @param {string[]} paths - Масив абсолютних шляхів до файлів.
 * @returns {Array<{ absPath: string, exists: boolean, content: string }>} Масив об'єктів з інформацією про файли.
 */
function captureFiles(paths) {
  return paths.map(absPath => ({
    absPath,
    exists: existsSync(absPath),
    content: existsSync(absPath) ? readFileSync(absPath, 'utf8') : ''
  }))
}

/**
 * Застосовує зміни (patch) до робочого дерева через snapshot.
 * @param {Array<{ absPath: string, exists: boolean, content: string }>} patch - Патч для застосування.
 * @param {object} snapshot - Об'єкт з функцією для запису змін.
 */
function applyCapturedFiles(patch, snapshot) {
  for (const file of patch) {
    snapshot.record(file.absPath)
    if (!file.exists) {
      rmSync(file.absPath, { force: true })
      continue
    }
    mkdirSync(dirname(file.absPath), { recursive: true })
    writeFileSync(file.absPath, file.content, 'utf8')
  }
}

/**
 * Обчислює загальний розмір патчу.
 * @param {Array<{ absPath: string, exists: boolean, content: string }>} patch - Масив файлів патчу.
 * @returns {number} Загальна кількість байтів.
 */
function patchSize(patch) {
  return patch.reduce((sum, file) => sum + file.content.length, 0)
}
