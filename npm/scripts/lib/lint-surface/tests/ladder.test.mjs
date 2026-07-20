import { afterEach, describe, expect, test, vi } from 'vitest'

import { classifyFixError, decideAfterFailure } from '../ladder.mjs'

/**
 * Свіжий імпорт ladder.mjs після stubEnv — per-tier дефолти читаються з env
 * на завантаженні модуля, тож звичайний статичний імпорт їх би не перечитав.
 * @returns {Promise<typeof import('../ladder.mjs')>} перезавантажений модуль ladder.
 */
function freshLadder() {
  vi.resetModules()
  return import('../ladder.mjs')
}

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('buildLadder — per-tier таймаути (ADR 260620-0556)', () => {
  test('дефолти без env: local 45s, cloud-min 120s, cloud-avg 180s', async () => {
    vi.stubEnv('N_LOCAL_FIX_TIMEOUT_MS', '')
    vi.stubEnv('N_CLOUD_FIX_TIMEOUT_MS', '')
    vi.stubEnv('N_CLOUD_AVG_FIX_TIMEOUT_MS', '')
    const { buildLadder } = await freshLadder()
    const ladder = buildLadder({ localMin: 'l/min', cloudMin: 'c/min', cloudAvg: 'c/avg' })
    expect(ladder.map(r => [r.tier, r.timeoutMs])).toEqual([
      ['local-min', 45_000],
      ['local-min-retry', 45_000],
      ['cloud-min', 120_000],
      ['cloud-avg', 180_000]
    ])
  })

  test('env-override: N_LOCAL_FIX_TIMEOUT_MS / N_CLOUD_FIX_TIMEOUT_MS керують без зміни коду', async () => {
    vi.stubEnv('N_LOCAL_FIX_TIMEOUT_MS', '1000')
    vi.stubEnv('N_CLOUD_FIX_TIMEOUT_MS', '2000')
    vi.stubEnv('N_CLOUD_AVG_FIX_TIMEOUT_MS', '')
    const { buildLadder } = await freshLadder()
    const ladder = buildLadder({ localMin: 'l/min', cloudMin: 'c/min', cloudAvg: 'c/avg' })
    expect(ladder.find(r => r.tier === 'local-min').timeoutMs).toBe(1000)
    expect(ladder.find(r => r.tier === 'cloud-min').timeoutMs).toBe(2000)
    expect(ladder.find(r => r.tier === 'cloud-avg').timeoutMs).toBe(180_000)
  })

  test('env-override: N_CLOUD_AVG_FIX_TIMEOUT_MS керує cloud-avg окремо від cloud-min', async () => {
    vi.stubEnv('N_CLOUD_FIX_TIMEOUT_MS', '2000')
    vi.stubEnv('N_CLOUD_AVG_FIX_TIMEOUT_MS', '3000')
    const { buildLadder } = await freshLadder()
    const ladder = buildLadder({ localMin: 'l/min', cloudMin: 'c/min', cloudAvg: 'c/avg' })
    expect(ladder.find(r => r.tier === 'cloud-min').timeoutMs).toBe(2000)
    expect(ladder.find(r => r.tier === 'cloud-avg').timeoutMs).toBe(3000)
  })
})

describe('класифікація timeout-помилки — ladder іде далі, не обривається', () => {
  test('"fix timeout …" → quality (ескалація), навіть попри "timed out" у TRANSPORT_RE', () => {
    expect(classifyFixError('fix timeout 45000ms')).toBe('quality')
  })

  test('decideAfterFailure на cloud-рунгу з fix timeout → null (продовжити ladder)', () => {
    const cloudRung = { tier: 'cloud-min', model: 'c/min', feedback: true, local: false, isAvg: false }
    expect(decideAfterFailure(cloudRung, 'fix timeout 120000ms')).toBeNull()
  })
})
