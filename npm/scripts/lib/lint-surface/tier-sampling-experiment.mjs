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
 * @property {'local-min'|'cloud-min'|'cloud-avg'|'cloud-max'} tier
 * @property {string} model
 * @property {boolean} feedback
 * @property {boolean} local
 * @property {boolean} isAvg
 * @property {boolean} isMax
 * @property {boolean} experimentOnly
 * @property {number} timeoutMs
 */

/**
 * @typedef {object} SamplingCandidate
 * @property {string} id
 * @property {'conservative'|'exploratory'|'judge'|string} samplingProfile
 */

/**
 * @typedef {object} CandidateAttempt
 * @property {number} index
 * @property {string} id
 * @property {string} samplingProfile
 * @property {string} tier
 * @property {string} model
 * @property {boolean} clean
 * @property {string[]} touchedFiles
 * @property {number} changedBytes
 * @property {number} wallMs
 * @property {string|null} error
 * @property {import('./types.mjs').LintViolation[]} violations
 * @property {object|undefined} telemetry
 * @property {Array<{ absPath: string, exists: boolean, content: string }>} patch
 */

/**
 * Будує experiment-only ladder із `cloud-max`. Production ladder це не змінює.
 * @param {{ localMin?: string, cloudMin?: string, cloudAvg?: string, cloudMax?: string }} models
 * @param {{ localTimeoutMs?: number, cloudTimeoutMs?: number }} [opts]
 * @returns {ExperimentRung[]}
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
 * Повертає sampling profiles для tier-а, з опційним override-ом для smoke/bench.
 * @param {string} tier
 * @param {Record<string, Array<string|SamplingCandidate>>} [overrides]
 * @returns {SamplingCandidate[]}
 */
export function samplingProfilesForTier(tier, overrides = {}) {
  const raw = overrides[tier] ?? DEFAULT_PROFILES_BY_TIER[tier] ?? ['conservative']
  return raw.map((p, index) => {
    if (typeof p === 'string') return { id: `${tier}:${p}:${index}`, samplingProfile: p }
    return { id: p.id ?? `${tier}:${p.samplingProfile}:${index}`, samplingProfile: p.samplingProfile }
  })
}

/**
 * Дефолтний вибір серед clean candidates: менше touched files, менший patch, нижча latency.
 * @param {CandidateAttempt[]} attempts
 * @returns {CandidateAttempt|null}
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
 * Запускає candidates одного experiment tier-а із rollback до S1 між спробами.
 * @param {object} args
 * @param {import('./types.mjs').LintViolation[]} args.violations
 * @param {object} args.ctx базовий FixContext без samplingProfile
 * @param {ExperimentRung} args.rung
 * @param {SamplingCandidate[]} args.candidates
 * @param {(violations: import('./types.mjs').LintViolation[], ctx: object) => Promise<{ touchedFiles?: string[], telemetry?: object }|void>} args.worker
 * @param {(ctx: object) => Promise<import('./types.mjs').LintViolation[]> | import('./types.mjs').LintViolation[]} args.detect
 * @param {(attempts: CandidateAttempt[]) => CandidateAttempt|null} [args.choose]
 * @param {(ctx: object) => Promise<object|null> | object | null} [args.judge]
 * @param {() => number} [args.clock]
 * @returns {Promise<{ clean: boolean, selected: CandidateAttempt|null, attempts: CandidateAttempt[], finalViolations: import('./types.mjs').LintViolation[], judgeFeedback: object|null }>}
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
    let touchedFiles = []

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
    } catch (err) {
      error = err.message
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

function uniqueStrings(values) {
  return [...new Set(values.filter(v => typeof v === 'string' && v.length > 0))]
}

function captureFiles(paths) {
  return paths.map(absPath => ({
    absPath,
    exists: existsSync(absPath),
    content: existsSync(absPath) ? readFileSync(absPath, 'utf8') : ''
  }))
}

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

function patchSize(patch) {
  return patch.reduce((sum, file) => sum + file.content.length, 0)
}
