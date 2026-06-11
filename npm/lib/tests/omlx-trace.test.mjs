/**
 * Тести npm/lib/omlx-trace.mjs:
 *   - tracePath — дефолт (.n-cursor) / override / kill-switch
 *   - capMessages — cap 8k + sha256 повного масиву + прапор обрізки
 *   - buildTraceRecord — rich-схема (omlx) / null-поля (pi) / error-форма
 *   - rotateIfNeeded — недеструктивна ротація за розміром
 *   - writeTrace — kill-switch, послідовність IO, fail-safe
 *
 * node:fs мокається — жодних реальних файлових операцій.
 */
import { env } from 'node:process'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const fs = vi.hoisted(() => ({
  appendFileSyncMock: vi.fn(),
  existsSyncMock: vi.fn(),
  mkdirSyncMock: vi.fn(),
  renameSyncMock: vi.fn(),
  statSyncMock: vi.fn()
}))
vi.mock('node:fs', () => ({
  appendFileSync: fs.appendFileSyncMock,
  existsSync: fs.existsSyncMock,
  mkdirSync: fs.mkdirSyncMock,
  renameSync: fs.renameSyncMock,
  statSync: fs.statSyncMock
}))

const { MAX_MSG_CHARS, ROTATE_BYTES, tracePath, capMessages, buildTraceRecord, rotateIfNeeded, writeTrace } =
  await import('../omlx-trace.mjs')

const MESSAGES = [
  { role: 'system', content: 'Ти технічний письменник.' },
  { role: 'user', content: 'Опиши файл.' }
]

/** Форма sha256-hex (64 hex-символи). */
const SHA256_RE = /^[a-f0-9]{64}$/

beforeEach(() => {
  for (const m of Object.values(fs)) m.mockReset()
  delete env.N_CURSOR_LLM_TRACE
})

afterEach(() => {
  delete env.N_CURSOR_LLM_TRACE
})

describe('tracePath', () => {
  test('дефолт → <cwd>/.n-cursor/llm-trace.jsonl', () => {
    expect(tracePath().endsWith('/.n-cursor/llm-trace.jsonl')).toBe(true)
  })

  test('явний шлях у env → повертає його', () => {
    env.N_CURSOR_LLM_TRACE = '/custom/trace.jsonl'
    expect(tracePath()).toBe('/custom/trace.jsonl')
  })

  test('kill-switch (0/false/off/no) → null', () => {
    for (const v of ['0', 'false', 'FALSE', 'off', 'no']) {
      env.N_CURSOR_LLM_TRACE = v
      expect(tracePath()).toBeNull()
    }
  })
})

describe('capMessages', () => {
  test('короткі messages → без обрізки, контент збережено', () => {
    const r = capMessages(MESSAGES)
    expect(r.messages_truncated).toBe(false)
    expect(r.messages).toEqual(MESSAGES)
    expect(r.messages_sha256).toMatch(SHA256_RE)
  })

  test('довге content → обрізка до MAX_MSG_CHARS, прапор true', () => {
    const big = [{ role: 'user', content: 'x'.repeat(MAX_MSG_CHARS + 500) }]
    const r = capMessages(big)
    expect(r.messages_truncated).toBe(true)
    expect(r.messages[0].content.length).toBe(MAX_MSG_CHARS)
  })

  test('sha256 рахується з повного (необрізаного) масиву — детермінований', () => {
    const big = [{ role: 'user', content: 'y'.repeat(MAX_MSG_CHARS + 100) }]
    const a = capMessages(big)
    const b = capMessages(big)
    expect(a.messages_sha256).toBe(b.messages_sha256)
    // hash повного ≠ hash обрізаного
    expect(a.messages_sha256).not.toBe(capMessages(a.messages).messages_sha256)
  })
})

describe('buildTraceRecord', () => {
  const base = {
    ts: '2026-06-10T00:00:00.000Z',
    caller: 'doc-files',
    backend: 'omlx',
    model: 'omlx/m',
    temperature: 0.2,
    maxTokens: 4096,
    messages: MESSAGES,
    ms: 1234,
    ok: true
  }

  test('omlx ok → rich-поля присутні', () => {
    const r = buildTraceRecord({
      ...base,
      content: '391',
      reasoning: 'Okay…',
      reasoningSource: 'field',
      finishReason: 'stop',
      usage: { prompt_tokens: 22, completion_tokens: 308 },
      attempts: 1
    })
    expect(r).toMatchObject({
      caller: 'doc-files',
      backend: 'omlx',
      content: '391',
      reasoning: 'Okay…',
      reasoning_source: 'field',
      finish_reason: 'stop',
      attempts: 1,
      ok: true,
      error: null
    })
    expect(r.usage.completion_tokens).toBe(308)
    expect(r.messages_sha256).toMatch(SHA256_RE)
  })

  test('pi → rich-поля null за побудовою', () => {
    const r = buildTraceRecord({ ...base, backend: 'pi', maxTokens: undefined, content: 'pi-out', attempts: 1 })
    expect(r.reasoning).toBeNull()
    expect(r.reasoning_source).toBeNull()
    expect(r.finish_reason).toBeNull()
    expect(r.usage).toBeNull()
    expect(r.max_tokens).toBeNull()
  })

  test('error-форма → ok=false, content null, error заданий', () => {
    const r = buildTraceRecord({ ...base, ok: false, attempts: null, error: 'omlx curl exit 7' })
    expect(r.ok).toBe(false)
    expect(r.content).toBeNull()
    expect(r.error).toBe('omlx curl exit 7')
    expect(r.attempts).toBeNull()
  })
})

describe('rotateIfNeeded', () => {
  test('файл під порогом → без ротації', () => {
    fs.statSyncMock.mockReturnValue({ size: ROTATE_BYTES - 1 })
    rotateIfNeeded('/t/llm-trace.jsonl')
    expect(fs.renameSyncMock).not.toHaveBeenCalled()
  })

  test('файл над порогом → rename у перший вільний .<seq>.jsonl', () => {
    fs.statSyncMock.mockReturnValue({ size: ROTATE_BYTES + 1 })
    fs.existsSyncMock.mockReturnValue(false) // .1 вільний
    rotateIfNeeded('/t/llm-trace.jsonl')
    expect(fs.renameSyncMock).toHaveBeenCalledWith('/t/llm-trace.jsonl', '/t/llm-trace.1.jsonl')
  })

  test('зайнятий .1 → ротує в .2 (недеструктивно)', () => {
    fs.statSyncMock.mockReturnValue({ size: ROTATE_BYTES + 1 })
    fs.existsSyncMock.mockImplementation(p => p === '/t/llm-trace.1.jsonl')
    rotateIfNeeded('/t/llm-trace.jsonl')
    expect(fs.renameSyncMock).toHaveBeenCalledWith('/t/llm-trace.jsonl', '/t/llm-trace.2.jsonl')
  })

  test('файлу нема (statSync кидає) → no-op', () => {
    fs.statSyncMock.mockImplementation(() => {
      throw new Error('ENOENT')
    })
    rotateIfNeeded('/t/llm-trace.jsonl')
    expect(fs.renameSyncMock).not.toHaveBeenCalled()
  })
})

describe('writeTrace', () => {
  const record = { ts: 't', ok: true }

  test('kill-switch → нічого не пишеться', () => {
    env.N_CURSOR_LLM_TRACE = '0'
    writeTrace(record)
    expect(fs.appendFileSyncMock).not.toHaveBeenCalled()
  })

  test('норма → ротація + mkdir + append JSONL-рядка', () => {
    env.N_CURSOR_LLM_TRACE = '/t/llm-trace.jsonl'
    fs.statSyncMock.mockImplementation(() => {
      throw new Error('ENOENT')
    })
    writeTrace(record)
    expect(fs.mkdirSyncMock).toHaveBeenCalledWith('/t', { recursive: true })
    expect(fs.appendFileSyncMock).toHaveBeenCalledWith('/t/llm-trace.jsonl', JSON.stringify(record) + '\n')
  })

  test('помилка append → ковтається (fail-safe), не кидає', () => {
    env.N_CURSOR_LLM_TRACE = '/t/llm-trace.jsonl'
    fs.statSyncMock.mockImplementation(() => {
      throw new Error('ENOENT')
    })
    fs.appendFileSyncMock.mockImplementation(() => {
      throw new Error('disk full')
    })
    expect(() => writeTrace(record)).not.toThrow()
  })
})
