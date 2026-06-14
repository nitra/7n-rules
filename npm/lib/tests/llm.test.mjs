/**
 * Тести npm/lib/llm.mjs:
 *   - pickBackend — маршрутизація виключно за префіксом `omlx/`
 *   - callLlm — omlx-гілка (curl) vs pi-гілка (CLI), помилки, always-on wire-trace
 *   - omlxHealthCheck — ok / memory-guard / down / порожній контент
 *
 * spawnSync мокається; запис трейсу — через мок `writeTrace` (IO омлх-trace
 * тестується окремо в omlx-trace.test.mjs), `buildTraceRecord` лишається справжній.
 */
import { env } from 'node:process'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const { spawnSyncMock, readFileSyncMock, writeTraceMock } = vi.hoisted(() => ({
  spawnSyncMock: vi.fn(),
  readFileSyncMock: vi.fn(() => {
    // settings.json відсутній → resolveOmlxApiKey → null → без Authorization
    throw new Error('ENOENT')
  }),
  writeTraceMock: vi.fn()
}))
vi.mock('node:child_process', () => ({ spawnSync: spawnSyncMock }))
vi.mock('node:fs', () => ({ readFileSync: readFileSyncMock }))
vi.mock('../omlx-trace.mjs', async importOriginal => ({
  ...(await importOriginal()),
  writeTrace: writeTraceMock
}))

const { callLlm, omlxHealthCheck, pickBackend, classifyOmlxError } = await import('../llm.mjs')

const ERR_PI_EXIT_1 = /pi exit 1/
const ERR_PI_EXIT_3 = /pi exit 3/
const RE_MEMORY_CEILING = /memory ceiling/
/** Форма sha256-hex (64 hex-символи). */
const SHA256_RE = /^[a-f0-9]{64}$/

/**
 * Успішна omlx-відповідь spawnSync('curl', …) із заданим контентом.
 * @param {string} content контент choices[0].message.content
 * @returns {{status:number, stdout:string, stderr:string}} mock-результат spawnSync
 */
function curlOk(content) {
  return { status: 0, stdout: JSON.stringify({ choices: [{ message: { content } }] }), stderr: '' }
}

/**
 * Багата omlx-curl-відповідь із reasoning_content + usage.
 * @param {string} content контент відповіді
 * @returns {{status:number, stdout:string, stderr:string}} mock spawnSync
 */
function curlRich(content) {
  return {
    status: 0,
    stdout: JSON.stringify({
      choices: [{ message: { content, reasoning_content: 'Думаю…' }, finish_reason: 'stop' }],
      usage: { completion_tokens: 7 }
    }),
    stderr: ''
  }
}

const MESSAGES = [
  { role: 'system', content: 'Ти технічний письменник.' },
  { role: 'user', content: 'Опиши файл.' }
]

beforeEach(() => {
  spawnSyncMock.mockReset()
  writeTraceMock.mockReset()
  delete env.N_CURSOR_LLM_TRACE
})

afterEach(() => {
  delete env.N_CURSOR_LLM_TRACE
})

describe('pickBackend', () => {
  test('omlx/-префікс → omlx', () => {
    expect(pickBackend('omlx/mlx-community--gemma-4-e2b-it-4bit')).toBe('omlx')
  })

  test('хмарний id і порожній рядок → pi', () => {
    expect(pickBackend('openai/gpt-5.4-mini')).toBe('pi')
    expect(pickBackend('')).toBe('pi')
  })
})

describe('callLlm — маршрутизація', () => {
  test('omlx/<m> іде через curl зі збереженим system-role', () => {
    spawnSyncMock.mockReturnValue(curlOk('Текст доки.'))
    const out = callLlm(MESSAGES, 'omlx/test-model')
    expect(out).toBe('Текст доки.')
    const [cmd, , opts] = spawnSyncMock.mock.calls[0]
    expect(cmd).toBe('curl')
    const body = JSON.parse(opts.input)
    expect(body.model).toBe('test-model')
    expect(body.messages[0]).toEqual(MESSAGES[0])
  })

  test('не-omlx model іде через pi CLI з --model і конкатенованим prompt', () => {
    spawnSyncMock.mockReturnValue({ status: 0, stdout: 'відповідь pi\n', stderr: '' })
    const out = callLlm(MESSAGES, 'openai/gpt-5.4-mini')
    expect(out).toBe('відповідь pi')
    const [cmd, args] = spawnSyncMock.mock.calls[0]
    expect(cmd).toBe('pi')
    expect(args).toContain('--model')
    expect(args).toContain('openai/gpt-5.4-mini')
    expect(args).toContain('--no-tools')
    expect(args[1]).toBe(MESSAGES.map(m => m.content).join('\n\n'))
  })

  test('порожній model → pi без --model (pi-дефолт)', () => {
    spawnSyncMock.mockReturnValue({ status: 0, stdout: 'ok', stderr: '' })
    callLlm(MESSAGES, '')
    const [cmd, args] = spawnSyncMock.mock.calls[0]
    expect(cmd).toBe('pi')
    expect(args).not.toContain('--model')
  })

  test('pi non-zero exit → помилка з кодом', () => {
    spawnSyncMock.mockReturnValue({ status: 3, stdout: '', stderr: 'boom' })
    expect(() => callLlm(MESSAGES, 'openai/gpt-5.4-mini')).toThrow(ERR_PI_EXIT_3)
  })
})

describe('callLlm — wire-trace (always-on)', () => {
  test('omlx-успіх → writeTrace з backend/ok + reasoning/usage/caller', () => {
    spawnSyncMock.mockReturnValue(curlRich('x'))
    callLlm(MESSAGES, 'omlx/m', { caller: 'doc-files' })
    const rec = writeTraceMock.mock.calls[0][0]
    expect(rec).toMatchObject({
      backend: 'omlx',
      model: 'omlx/m',
      caller: 'doc-files',
      reasoning: 'Думаю…',
      reasoning_source: 'field',
      finish_reason: 'stop',
      ok: true
    })
    expect(rec.usage.completion_tokens).toBe(7)
    expect(rec.messages_sha256).toMatch(SHA256_RE)
  })

  test('pi-успіх → rich-поля null, caller=unknown за замовчуванням', () => {
    spawnSyncMock.mockReturnValue({ status: 0, stdout: 'pi-out', stderr: '' })
    callLlm(MESSAGES, 'openai/gpt-5.4-mini')
    const rec = writeTraceMock.mock.calls[0][0]
    expect(rec).toMatchObject({ backend: 'pi', caller: 'unknown', ok: true })
    expect(rec.reasoning).toBeNull()
    expect(rec.usage).toBeNull()
  })

  test('помилка → writeTrace ok=false з текстом, виняток прокидається далі', () => {
    spawnSyncMock.mockReturnValue({ status: 1, stdout: '', stderr: 'err' })
    expect(() => callLlm(MESSAGES, '')).toThrow(ERR_PI_EXIT_1)
    const rec = writeTraceMock.mock.calls[0][0]
    expect(rec.ok).toBe(false)
    expect(rec.error).toMatch(ERR_PI_EXIT_1)
    expect(rec.content).toBeNull()
  })
})

describe('omlxHealthCheck', () => {
  test('живий сервер із контентом → ok', () => {
    spawnSyncMock.mockReturnValue(curlOk('Ok'))
    expect(omlxHealthCheck({ model: 'omlx/m' })).toEqual({ ok: true, reason: null, detail: '' })
  })

  test('memory-guard → reason=memory-guard (машина зайнята, не помилка моделі)', () => {
    spawnSyncMock.mockReturnValue({
      status: 0,
      stdout: JSON.stringify({
        error: { message: "Model 'm' (3.50GB) does not fit under the memory ceiling (2.56GB)." }
      }),
      stderr: ''
    })
    const r = omlxHealthCheck({ model: 'omlx/m' })
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('memory-guard')
    expect(r.detail).toMatch(RE_MEMORY_CEILING)
  })

  test('curl не достукався → reason=down', () => {
    spawnSyncMock.mockReturnValue({ status: 7, stdout: '', stderr: 'Failed to connect' })
    const r = omlxHealthCheck({ model: 'omlx/m' })
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('down')
  })

  test('порожній контент при max_tokens=1 → сервер живий, ok', () => {
    spawnSyncMock.mockReturnValue({
      status: 0,
      stdout: JSON.stringify({ choices: [{ message: { content: '' }, finish_reason: 'length' }] }),
      stderr: ''
    })
    expect(omlxHealthCheck({ model: 'omlx/m' }).ok).toBe(true)
  })

  test('вимога API-ключа → reason=auth', () => {
    spawnSyncMock.mockReturnValue({
      status: 0,
      stdout: JSON.stringify({ error: { message: 'API key required', type: 'authentication_error' } }),
      stderr: ''
    })
    const r = omlxHealthCheck({ model: 'omlx/m' })
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('auth')
  })

  test('інша API-помилка → reason=error', () => {
    spawnSyncMock.mockReturnValue({
      status: 0,
      stdout: JSON.stringify({ error: { message: 'model not found' } }),
      stderr: ''
    })
    const r = omlxHealthCheck({ model: 'omlx/m' })
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('error')
  })
})

describe('classifyOmlxError', () => {
  test('permanent — завеликий контекст / модель відсутня', () => {
    expect(classifyOmlxError('omlx api: Prompt too long: 9177917 tokens exceeds max context window')).toBe('permanent')
    expect(classifyOmlxError("Model 'x' not found. Available models: y")).toBe('permanent')
  })

  test('systemic — memory-guard / auth / down (каскадить)', () => {
    expect(classifyOmlxError('omlx api: ... memory ceiling 11.84GB')).toBe('systemic')
    expect(classifyOmlxError('omlx api: {"type":"authentication_error"}')).toBe('systemic')
    expect(classifyOmlxError('omlx curl exit 7: connection refused')).toBe('systemic')
    expect(classifyOmlxError('omlx curl error: spawnSync curl ETIMEDOUT')).toBe('systemic')
  })

  test('transient — решта (empty content, bad json)', () => {
    expect(classifyOmlxError('omlx empty content (finish=length)')).toBe('transient')
    expect(classifyOmlxError('omlx bad json: <html>')).toBe('transient')
  })
})
