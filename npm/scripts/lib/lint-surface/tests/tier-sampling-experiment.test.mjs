import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'

import {
  buildExperimentLadder,
  runTierSamplingExperiment,
  samplingProfilesForTier
} from '../tier-sampling-experiment.mjs'
import { withTmpDir } from '../../../utils/test-helpers.mjs'

const VIOLATIONS = [{ ruleId: 'probe', concernId: 'check', reason: 'not-done', message: 'out.txt is not done' }]

describe('tier sampling experiment', () => {
  test('experiment ladder включає cloud-max, але маркує всі rungs як experiment-only', () => {
    const ladder = buildExperimentLadder(
      {
        localMin: 'omlx/local',
        cloudMin: 'openai/min',
        cloudAvg: 'openai/avg',
        cloudMax: 'openai/max'
      },
      { localTimeoutMs: 1, cloudTimeoutMs: 2 }
    )

    expect(ladder.map(r => r.tier)).toEqual(['local-min', 'cloud-min', 'cloud-avg', 'cloud-max'])
    expect(ladder.every(r => r.experimentOnly)).toBe(true)
    expect(ladder.at(-1)).toMatchObject({ tier: 'cloud-max', isMax: true, timeoutMs: 2 })
  })

  test('sampling profiles можна override-ити per tier', () => {
    expect(samplingProfilesForTier('cloud-min').map(p => p.samplingProfile)).toEqual([
      'conservative',
      'exploratory'
    ])
    expect(
      samplingProfilesForTier('cloud-max', {
        'cloud-max': [{ id: 'judge-max', samplingProfile: 'judge' }]
      })
    ).toEqual([{ id: 'judge-max', samplingProfile: 'judge' }])
  })

  test('кожен candidate стартує з S1, а clean вибирається за меншим touched set', async () => {
    await withTmpDir(async dir => {
      const out = join(dir, 'out.txt')
      const extra = join(dir, 'extra.txt')
      const observed = []
      const rung = {
        tier: 'cloud-min',
        model: 'fake/cloud-min',
        feedback: true,
        local: false,
        isAvg: false,
        isMax: false,
        experimentOnly: true,
        timeoutMs: 1000
      }
      const worker = async (_violations, ctx) => {
        observed.push({
          profile: ctx.samplingProfile,
          before: existsSync(out) ? readFileSync(out, 'utf8') : 'absent'
        })
        if (ctx.samplingProfile === 'conservative') {
          ctx.recordWrite(out)
          writeFileSync(out, 'done with extra text')
          ctx.recordWrite(extra)
          writeFileSync(extra, 'noise')
          return { touchedFiles: [out, extra] }
        }
        ctx.recordWrite(out)
        writeFileSync(out, 'done')
        return { touchedFiles: [out] }
      }
      const detect = () =>
        existsSync(out) && readFileSync(out, 'utf8').startsWith('done')
          ? []
          : [{ ruleId: 'probe', concernId: 'check', reason: 'not-done', message: 'out.txt is not done' }]

      const result = await runTierSamplingExperiment({
        violations: VIOLATIONS,
        ctx: { cwd: dir, ruleId: 'probe', concernId: 'check' },
        rung,
        candidates: [
          { id: 'candidate-a', samplingProfile: 'conservative' },
          { id: 'candidate-b', samplingProfile: 'exploratory' }
        ],
        worker,
        detect
      })

      expect(result.clean).toBe(true)
      expect(result.selected).toMatchObject({ id: 'candidate-b', samplingProfile: 'exploratory' })
      expect(readFileSync(out, 'utf8')).toBe('done')
      expect(existsSync(extra)).toBe(false)
      expect(observed).toEqual([
        { profile: 'conservative', before: 'absent' },
        { profile: 'exploratory', before: 'absent' }
      ])
    })
  })

  test('judge повертає тільки feedback і не override-ить failed detect', async () => {
    await withTmpDir(async dir => {
      const out = join(dir, 'out.txt')
      const rung = {
        tier: 'cloud-max',
        model: 'fake/cloud-max',
        feedback: true,
        local: false,
        isAvg: false,
        isMax: true,
        experimentOnly: true,
        timeoutMs: 1000
      }
      const worker = async (_violations, ctx) => {
        ctx.recordWrite(out)
        writeFileSync(out, 'still-bad')
        return { touchedFiles: [out] }
      }
      const detect = () => [{ ruleId: 'probe', concernId: 'check', reason: 'not-done', message: 'still bad' }]

      const result = await runTierSamplingExperiment({
        violations: VIOLATIONS,
        ctx: { cwd: dir, ruleId: 'probe', concernId: 'check' },
        rung,
        candidates: [{ id: 'max-judge', samplingProfile: 'judge' }],
        worker,
        detect,
        judge: ({ attempts }) => ({ advice: 'try a narrower patch', attempts: attempts.length })
      })

      expect(result.clean).toBe(false)
      expect(result.selected).toBeNull()
      expect(result.judgeFeedback).toEqual({ advice: 'try a narrower patch', attempts: 1 })
      expect(existsSync(out)).toBe(false)
    })
  })
})
