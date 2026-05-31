/**
 * Тести WAL-журналу подій (`lib/events.mjs`, spec §4.1.2). Годинник
 * ін'єктується (`FIXED`) — без реального `Date.now()` у перевірках.
 */
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, test } from 'vitest'

import { withTmpDir } from '../../../utils/test-helpers.mjs'
import { appendEvent, flowEventsPath, readEvents } from '../events.mjs'

const FIXED = () => 1_700_000_000_000 // 2023-11-14T22:13:20.000Z

describe('flowEventsPath', () => {
  test('sibling .events.jsonl поруч із checkout', () => {
    expect(flowEventsPath('/abs/.worktrees/feat-x')).toBe('/abs/.worktrees/feat-x.events.jsonl')
  })
  test('відносний шлях → throw', () => {
    expect(() => flowEventsPath('.worktrees/feat-x')).toThrow(/абсолютн/)
  })
})

describe('appendEvent / readEvents', () => {
  test('append додає рядки з міткою at; read повертає в порядку запису', async () => {
    await withTmpDir(async dir => {
      const p = join(dir, 'feat.events.jsonl')
      appendEvent(p, { type: 'step_started', step: 1 }, FIXED)
      appendEvent(p, { type: 'step_done', step: 1 }, FIXED)
      const ev = readEvents(p)
      expect(ev).toHaveLength(2)
      expect(ev[0]).toEqual({ at: '2023-11-14T22:13:20.000Z', type: 'step_started', step: 1 })
      expect(ev[1].type).toBe('step_done')
    })
  })

  test('readEvents відсутнього → []', async () => {
    await withTmpDir(async dir => {
      expect(readEvents(join(dir, 'nope.events.jsonl'))).toEqual([])
    })
  })

  test('торваний останній рядок толерується (пропускається)', async () => {
    await withTmpDir(async dir => {
      const p = join(dir, 'torn.events.jsonl')
      writeFileSync(p, `${JSON.stringify({ at: 'x', type: 'ok' })}\n{ partial`, 'utf8')
      const ev = readEvents(p)
      expect(ev).toHaveLength(1)
      expect(ev[0].type).toBe('ok')
    })
  })
})
