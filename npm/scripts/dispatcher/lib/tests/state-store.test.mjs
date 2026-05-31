/**
 * Тести crash-safe сховища стану (`lib/state-store.mjs`, spec §4.1).
 * Усе у git-незалежних tmp-каталогах через `withTmpDir` (без `process.chdir`,
 * абсолютні шляхи).
 */
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, test } from 'vitest'

import { withTmpDir } from '../../../utils/test-helpers.mjs'
import { readEvents } from '../events.mjs'
import {
  SCHEMA_VERSION,
  cleanupFlowSiblings,
  flowStatePath,
  readState,
  recordTransition,
  removeState,
  updateState,
  writeState
} from '../state-store.mjs'

const FIXED = () => 1_700_000_000_000

describe('flowStatePath', () => {
  test('sibling поруч із checkout (не всередині)', () => {
    expect(flowStatePath('/abs/.worktrees/feat-x')).toBe('/abs/.worktrees/feat-x.flow.json')
  })
  test('відносний шлях → throw', () => {
    expect(() => flowStatePath('.worktrees/feat-x')).toThrow(/абсолютн/)
  })
})

describe('writeState / readState', () => {
  test('round-trip + додає schema_version', async () => {
    await withTmpDir(async dir => {
      const p = join(dir, 'feat.flow.json')
      const written = writeState(p, { branch: 'feat/x', status: 'in_progress' })
      expect(written.schema_version).toBe(SCHEMA_VERSION)
      const read = readState(p)
      expect(read).toEqual({ schema_version: SCHEMA_VERSION, branch: 'feat/x', status: 'in_progress' })
    })
  })

  test('atomic: після запису нема залишкових .tmp', async () => {
    await withTmpDir(async dir => {
      const p = join(dir, 'feat.flow.json')
      writeState(p, { a: 1 })
      const leftovers = readdirSync(dir).filter(n => n.endsWith('.tmp'))
      expect(leftovers).toEqual([])
    })
  })

  test('readState відсутнього файла → null', async () => {
    await withTmpDir(async dir => {
      expect(readState(join(dir, 'nope.flow.json'))).toBe(null)
    })
  })

  test('пошкоджений JSON → throw (fail-closed)', async () => {
    await withTmpDir(async dir => {
      const p = join(dir, 'bad.flow.json')
      writeFileSync(p, '{ not json', 'utf8')
      expect(() => readState(p)).toThrow(/fail-closed/)
    })
  })

  test('несумісний schema_version → throw (fail-closed)', async () => {
    await withTmpDir(async dir => {
      const p = join(dir, 'old.flow.json')
      writeFileSync(p, JSON.stringify({ schema_version: 999, a: 1 }), 'utf8')
      expect(() => readState(p)).toThrow(/fail-closed/)
    })
  })
})

describe('updateState', () => {
  test('застосовує трансформер до наявного стану', async () => {
    await withTmpDir(async dir => {
      const p = join(dir, 'feat.flow.json')
      writeState(p, { n: 1 })
      updateState(p, s => ({ ...s, n: s.n + 1 }))
      expect(readState(p).n).toBe(2)
    })
  })
  test('на відсутньому файлі fn отримує {}', async () => {
    await withTmpDir(async dir => {
      const p = join(dir, 'fresh.flow.json')
      updateState(p, s => ({ ...s, created: true }))
      expect(readState(p).created).toBe(true)
    })
  })
})

describe('removeState', () => {
  test('ідемпотентне видалення', async () => {
    await withTmpDir(async dir => {
      const p = join(dir, 'feat.flow.json')
      writeState(p, { a: 1 })
      expect(existsSync(p)).toBe(true)
      removeState(p)
      expect(existsSync(p)).toBe(false)
      expect(() => removeState(p)).not.toThrow()
    })
  })
})

describe('recordTransition (WAL)', () => {
  test('подія + зміна статусу', async () => {
    await withTmpDir(async dir => {
      const statePath = join(dir, 'feat.flow.json')
      const eventsPath = join(dir, 'feat.events.jsonl')
      recordTransition({ statePath, eventsPath }, { type: 'step_done', step: 1 }, s => ({ ...s, status: 'in_progress' }), FIXED)
      expect(readState(statePath).status).toBe('in_progress')
      expect(readEvents(eventsPath)[0].type).toBe('step_done')
    })
  })

  test('подія durable, навіть якщо запис стану падає (WAL-інваріант)', async () => {
    await withTmpDir(async dir => {
      const statePath = join(dir, 'feat.flow.json')
      const eventsPath = join(dir, 'feat.events.jsonl')
      expect(() =>
        recordTransition(
          { statePath, eventsPath },
          { type: 'attempt' },
          () => {
            throw new Error('boom')
          },
          FIXED
        )
      ).toThrow('boom')
      expect(readEvents(eventsPath).map(e => e.type)).toEqual(['attempt'])
    })
  })
})

describe('cleanupFlowSiblings', () => {
  test('прибирає .flow.json / .events.jsonl / lock-каталог; ідемпотентно', async () => {
    await withTmpDir(async dir => {
      const parent = join(dir, '.worktrees')
      const wt = join(parent, 'feat-x')
      mkdirSync(wt, { recursive: true })
      writeState(join(parent, 'feat-x.flow.json'), { a: 1 })
      writeFileSync(join(parent, 'feat-x.events.jsonl'), '{}\n', 'utf8')
      mkdirSync(join(parent, '.flow-lock-feat-x'), { recursive: true })

      cleanupFlowSiblings(wt)

      expect(existsSync(join(parent, 'feat-x.flow.json'))).toBe(false)
      expect(existsSync(join(parent, 'feat-x.events.jsonl'))).toBe(false)
      expect(existsSync(join(parent, '.flow-lock-feat-x'))).toBe(false)
      expect(() => cleanupFlowSiblings(wt)).not.toThrow()
    })
  })
})
