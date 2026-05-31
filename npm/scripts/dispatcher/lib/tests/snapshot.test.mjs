/**
 * Тести completion snapshot (`lib/snapshot.mjs`, spec §3 Ф5/§7).
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, test } from 'vitest'

import { withTmpDir } from '../../../utils/test-helpers.mjs'
import { buildCompletionSnapshot, upsertSummaryBlock, writeSummaryToTaskRecord } from '../snapshot.mjs'

const FIXED = () => 1_700_000_000_000

describe('buildCompletionSnapshot', () => {
  test('зводить status/branch/base_commit/gates/finished_at', () => {
    const snap = buildCompletionSnapshot(
      {
        status: 'done',
        branch: 'feat/x',
        metadata: { base_commit: 'abc' },
        gates: [
          { name: 'lint', ok: true },
          { name: 'coverage', ok: false }
        ]
      },
      FIXED
    )
    expect(snap).toEqual({
      status: 'done',
      branch: 'feat/x',
      base_commit: 'abc',
      gates: { lint: 'ok', coverage: 'fail' },
      change: null,
      notified: null,
      finished_at: '2023-11-14T22:13:20.000Z'
    })
  })

  test('дефолти для порожнього стану', () => {
    const snap = buildCompletionSnapshot({}, FIXED)
    expect(snap.status).toBe('done')
    expect(snap.gates).toEqual({})
  })
})

describe('upsertSummaryBlock', () => {
  test('додає блок, якщо його нема', () => {
    const out = upsertSummaryBlock('# Task\n', { status: 'done' })
    expect(out).toContain('flow:summary:start')
    expect(out).toContain('"status": "done"')
  })

  test('замінює наявний блок (idempotent — один блок)', () => {
    const once = upsertSummaryBlock('# Task\n', { status: 'done', n: 1 })
    const twice = upsertSummaryBlock(once, { status: 'done', n: 2 })
    expect(twice).toContain('"n": 2')
    expect(twice).not.toContain('"n": 1')
    expect(twice.split('flow:summary:start')).toHaveLength(2)
  })
})

describe('writeSummaryToTaskRecord', () => {
  test('створює файл, якщо його нема', async () => {
    await withTmpDir(async dir => {
      const p = join(dir, 'task.md')
      writeSummaryToTaskRecord(p, { status: 'done' })
      expect(readFileSync(p, 'utf8')).toContain('flow:summary:start')
    })
  })

  test('відносний шлях → throw', () => {
    expect(() => writeSummaryToTaskRecord('docs/tasks/x.md', { status: 'done' })).toThrow(/абсолютн/)
  })
})
