/**
 * Тести pi-trace: append-only JSONL, best-effort (IO-помилка не кидає), env-override шляху.
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { tracePath, writeTrace } from '../pi-trace.mjs'

let dir
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true })
  vi.unstubAllEnvs()
})

describe('writeTrace', () => {
  test('дописує JSONL-запис із ts і полями', () => {
    dir = mkdtempSync(join(tmpdir(), 'trace-'))
    const path = join(dir, 'nested', 'llm-trace.jsonl')
    writeTrace({ caller: 'fix:n-ci4:local-min', backend: 'pi-ai', kind: 'agent', model: 'omlx/x' }, path)
    writeTrace({ caller: 'one-shot', kind: 'one-shot' }, path)
    const lines = readFileSync(path, 'utf8').trim().split('\n')
    expect(lines).toHaveLength(2)
    const rec = JSON.parse(lines[0])
    expect(rec).toMatchObject({ caller: 'fix:n-ci4:local-min', backend: 'pi-ai', kind: 'agent' })
    expect(typeof rec.ts).toBe('string')
  })

  test('best-effort: помилка IO не кидає', () => {
    dir = mkdtempSync(join(tmpdir(), 'trace-'))
    const asFile = join(dir, 'file')
    writeFileSync(asFile, 'x')
    // dirname — це файл → mkdirSync кине ENOTDIR, має ковтнутись
    expect(() => writeTrace({ caller: 't' }, join(asFile, 'sub', 'trace.jsonl'))).not.toThrow()
  })
})

describe('tracePath', () => {
  test('env-override N_CURSOR_TRACE_PATH', () => {
    vi.stubEnv('N_CURSOR_TRACE_PATH', '/tmp/custom-trace.jsonl')
    expect(tracePath()).toBe('/tmp/custom-trace.jsonl')
  })

  test('дефолт — під ~/.n-cursor/', () => {
    vi.stubEnv('N_CURSOR_TRACE_PATH', '')
    expect(tracePath()).toMatch(/\.n-cursor[/\\]llm-trace\.jsonl$/)
  })
})
