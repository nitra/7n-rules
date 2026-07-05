/**
 * Тести pi-telemetry-store: signature, persist, collapse-з-лічильником, secret-redaction,
 * openCount, best-effort. Стор у temp-дир (N_CURSOR_TELEMETRY_DIR не потрібен — dir-опція).
 */

import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { openCount, recordFixTelemetry, signatureOf } from '../lib/telemetry-store.mjs'

const RE_SECRET = /sk-abcdef/

let dir
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'tel-'))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const rec = (over = {}) => ({
  rule: 'n-ci4',
  rung: 'local-min',
  model: 'omlx/gemma',
  cwd: '/proj',
  violationSignature: '❌ bad',
  edits: [{ path: 'a.mjs', tool: 'edit', edits: [{ oldText: 'OLD', newText: 'NEW' }] }],
  ...over
})

describe('signatureOf', () => {
  test('стабільна для однакових edits, різна для різних', () => {
    expect(signatureOf(rec())).toBe(signatureOf(rec()))
    expect(signatureOf(rec())).not.toBe(signatureOf(rec({ edits: [{ edits: [{ oldText: 'X', newText: 'Y' }] }] })))
  })

  test('whitespace в old/new не впливає (trim)', () => {
    const a = signatureOf(rec({ edits: [{ edits: [{ oldText: 'OLD', newText: 'NEW' }] }] }))
    const b = signatureOf(rec({ edits: [{ edits: [{ oldText: '  OLD ', newText: 'NEW  ' }] }] }))
    expect(a).toBe(b)
  })
})

describe('recordFixTelemetry', () => {
  test('перший запис → файл під <rule>/open/<sig>.json', () => {
    const r = recordFixTelemetry(rec(), { dir })
    expect(r).toMatchObject({ occurrences: 1, redacted: false })
    const files = readdirSync(join(dir, 'n-ci4', 'open'))
    expect(files).toEqual([`${r.signature}.json`])
    const entry = JSON.parse(readFileSync(join(dir, 'n-ci4', 'open', files[0]), 'utf8'))
    expect(entry).toMatchObject({ rule: 'n-ci4', status: 'open', occurrences: 1 })
    expect(entry.edits[0].edits[0]).toEqual({ oldText: 'OLD', newText: 'NEW' })
  })

  test('ідентичні схлопуються з лічильником + provenance', () => {
    recordFixTelemetry(rec({ cwd: '/p1' }), { dir })
    const r2 = recordFixTelemetry(rec({ cwd: '/p2' }), { dir })
    expect(r2.occurrences).toBe(2)
    const files = readdirSync(join(dir, 'n-ci4', 'open'))
    expect(files).toHaveLength(1) // схлопнуто в один файл
    const entry = JSON.parse(readFileSync(join(dir, 'n-ci4', 'open', files[0]), 'utf8'))
    expect(entry.occurrences).toBe(2)
    expect(entry.provenance.map(p => p.cwd)).toEqual(['/p1', '/p2'])
  })

  test('секрет → redacted, повний вміст не зберігається', () => {
    const r = recordFixTelemetry(
      rec({ edits: [{ path: '.env', tool: 'write', content: 'API_KEY=sk-abcdef0123456789abcd' }] }),
      {
        dir
      }
    )
    expect(r.redacted).toBe(true)
    const files = readdirSync(join(dir, 'n-ci4', 'open'))
    const raw = readFileSync(join(dir, 'n-ci4', 'open', files[0]), 'utf8')
    expect(raw).not.toMatch(RE_SECRET)
    expect(JSON.parse(raw).redacted).toBe(true)
  })

  test('best-effort: невалідний dir не кидає', () => {
    expect(() => recordFixTelemetry(rec(), { dir: '\0invalid' })).not.toThrow()
  })
})

describe('openCount', () => {
  test('рахує open-сигнатури правила', () => {
    expect(openCount('n-ci4', { dir })).toBe(0)
    recordFixTelemetry(rec(), { dir })
    recordFixTelemetry(rec({ edits: [{ edits: [{ oldText: 'P', newText: 'Q' }] }] }), { dir })
    expect(openCount('n-ci4', { dir })).toBe(2)
  })
})
