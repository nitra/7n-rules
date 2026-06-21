/**
 * Юніт-тести analyze-escalation.mjs — читання записів від зсуву, чанкінг за бюджетом,
 * map-reduce аналіз з інжектованим callLlm (без мережі), kill-switch.
 */
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { appendFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { env } from 'node:process'

import {
  analysisEnabled,
  analyzeEscalations,
  chunkRecords,
  escalationLogSize,
  readEscalationRecords,
  summarizeCalls,
  writeAnalysisReport
} from '../analyze-escalation.mjs'

const rec = (over = {}) => ({
  ts: 't',
  ruleId: 'rego',
  tier: 'cloud-min',
  model: 'openai/min',
  callOk: false,
  recheckOk: false,
  callError: 'x',
  diagnosis: 'd',
  remainingViolation: 'v',
  ms: 1,
  ...over
})

describe('analysisEnabled', () => {
  const KEY = 'N_CURSOR_FIX_ANALYZE'
  let prev
  beforeEach(() => {
    prev = env[KEY]
  })
  afterEach(() => {
    if (prev === undefined) delete env[KEY]
    else env[KEY] = prev
  })

  test('default — увімкнено', () => {
    delete env[KEY]
    expect(analysisEnabled()).toBe(true)
  })
  test('kill-switch вимикає', () => {
    for (const v of ['0', 'false', 'OFF', 'no']) {
      env[KEY] = v
      expect(analysisEnabled()).toBe(false)
    }
  })
})

describe('readEscalationRecords / escalationLogSize', () => {
  let dir
  let file
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'esc-an-'))
    file = join(dir, 'log.jsonl')
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  test('читає всі записи з нуля; биті рядки пропускає', () => {
    appendFileSync(file, JSON.stringify(rec()) + '\n', 'utf8')
    appendFileSync(file, 'НЕ JSON\n', 'utf8')
    appendFileSync(file, JSON.stringify(rec({ ruleId: 'bun' })) + '\n', 'utf8')
    const records = readEscalationRecords(file, 0)
    expect(records.map(r => r.ruleId)).toEqual(['rego', 'bun'])
  })

  test('від зсуву читає лише нові записи (this-run)', () => {
    appendFileSync(file, JSON.stringify(rec({ ruleId: 'old' })) + '\n', 'utf8')
    const offset = escalationLogSize(file)
    appendFileSync(file, JSON.stringify(rec({ ruleId: 'new' })) + '\n', 'utf8')
    const records = readEscalationRecords(file, offset)
    expect(records.map(r => r.ruleId)).toEqual(['new'])
  })

  test('зсув коректний за наявності мультибайтних символів', () => {
    appendFileSync(file, JSON.stringify(rec({ diagnosis: 'кирилиця діагноз' })) + '\n', 'utf8')
    const offset = escalationLogSize(file)
    appendFileSync(file, JSON.stringify(rec({ ruleId: 'після' })) + '\n', 'utf8')
    expect(readEscalationRecords(file, offset).map(r => r.ruleId)).toEqual(['після'])
  })

  test('немає файлу → []  і  size 0', () => {
    expect(readEscalationRecords(join(dir, 'none.jsonl'), 0)).toEqual([])
    expect(escalationLogSize(join(dir, 'none.jsonl'))).toBe(0)
  })
})

describe('chunkRecords', () => {
  test('малий обсяг → один чанк', () => {
    expect(chunkRecords([rec(), rec()], 40_000)).toHaveLength(1)
  })

  test('перевищення бюджету → кілька чанків', () => {
    const records = Array.from({ length: 10 }, () => rec({ remainingViolation: 'y'.repeat(200) }))
    const chunks = chunkRecords(records, 300)
    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks.flat()).toHaveLength(10)
  })
})

describe('summarizeCalls', () => {
  test('рахує виклики за тирами; skip-запис avg-кепу не рахується', () => {
    const records = [
      rec({ tier: 'local-min' }),
      rec({ tier: 'local-min-retry' }),
      rec({ tier: 'cloud-min' }),
      rec({ tier: 'cloud-avg' }),
      rec({ tier: 'cloud-avg', callError: 'cloud-avg cap reached' }) // skip — не виклик
    ]
    expect(summarizeCalls(records)).toEqual({ local: 2, cloudMin: 1, cloudAvg: 1 })
  })

  test('порожній лог → нулі', () => {
    expect(summarizeCalls([])).toEqual({ local: 0, cloudMin: 0, cloudAvg: 0 })
  })
})

describe('analyzeEscalations', () => {
  test('немає записів → reason no-records', async () => {
    expect(await analyzeEscalations([], { model: 'o/avg' })).toMatchObject({ reason: 'no-records', report: null })
  })

  test('немає моделі → reason no-cloud-avg-model', async () => {
    expect(await analyzeEscalations([rec()], { model: '' })).toMatchObject({ reason: 'no-cloud-avg-model' })
  })

  test('один чанк → звіт = відповідь моделі (без синтезу)', async () => {
    const calls = []
    const callLlm = (msgs, model) => {
      calls.push({ model, prompt: msgs[0].content })
      return '## report A'
    }
    const res = await analyzeEscalations([rec()], { model: 'o/avg', callLlm })
    expect(res).toMatchObject({ reason: 'ok', chunks: 1, report: '## report A' })
    expect(calls).toHaveLength(1)
    expect(calls[0].model).toBe('o/avg')
  })

  test('кілька чанків → синтез останнім викликом', async () => {
    const records = Array.from({ length: 6 }, (_, i) => rec({ remainingViolation: 'z'.repeat(200), ruleId: `r${i}` }))
    const prompts = []
    const callLlm = msgs => {
      prompts.push(msgs[0].content)
      return prompts.length <= 99 ? `partial ${prompts.length}` : 'x'
    }
    const res = await analyzeEscalations(records, { model: 'o/avg', callLlm, maxChars: 300 })
    expect(res.chunks).toBeGreaterThan(1)
    // останній prompt — синтез часткових
    expect(prompts.at(-1)).toContain('partial analyses of separate log chunks')
    expect(res.report).toBe(`partial ${prompts.length}`)
  })

  test('помилка моделі → ковтається у null, не кидає', () => {
    const res = analyzeEscalations([rec()], {
      model: 'o/avg',
      callLlm: () => {
        throw new Error('cloud down')
      }
    })
    expect(res).toMatchObject({ reason: 'empty-responses', report: null })
  })
})

describe('writeAnalysisReport', () => {
  test('дописує звіт із timestamp-заголовком у .n-cursor/', () => {
    const dir = mkdtempSync(join(tmpdir(), 'esc-rep-'))
    try {
      const p1 = writeAnalysisReport('## перший', dir, '2026-06-19T00:00:00.000Z')
      const p2 = writeAnalysisReport('## другий', dir, '2026-06-19T01:00:00.000Z')
      expect(p1).toBe(p2)
      const text = readFileSync(p1, 'utf8')
      expect(text).toContain('## Аналіз 2026-06-19T00:00:00.000Z')
      expect(text).toContain('## перший')
      expect(text).toContain('## Аналіз 2026-06-19T01:00:00.000Z')
      expect(text.indexOf('перший')).toBeLessThan(text.indexOf('другий'))
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
