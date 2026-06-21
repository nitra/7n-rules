/**
 * Тести npm/lib/omlx.mjs:
 *   - isOmlxModel / omlxModelId — конвенція префікса `omlx/`
 *   - callOmlx — body, маршрут моделі, retry transient, помилки
 *
 * spawnSync('curl', …) мокається — жодних реальних мережевих викликів.
 */
import { env } from 'node:process'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const { spawnSyncMock, readFileSyncMock } = vi.hoisted(() => ({ spawnSyncMock: vi.fn(), readFileSyncMock: vi.fn() }))
vi.mock('node:child_process', () => ({ spawnSync: spawnSyncMock }))
vi.mock('node:fs', () => ({ readFileSync: readFileSyncMock }))

const { callOmlx, callOmlxRaw, extractReasoning, isOmlxModel, omlxModelId, resolveOmlxApiKey } =
  await import('../omlx.mjs')

const ERR_CURL_EXIT_7 = /omlx curl exit 7/
const ERR_BAD_JSON = /omlx bad json/
const ERR_API = /omlx api/
const ERR_EMPTY = /omlx empty content/
const ERR_CURL_ERROR = /omlx curl error/

/**
 * Будує успішну відповідь spawnSync із заданим контентом.
 * @param {string} content контент choices[0].message.content
 * @returns {{status:number, stdout:string, stderr:string}} mock-результат spawnSync
 */
function okResult(content) {
  return { status: 0, stdout: JSON.stringify({ choices: [{ message: { content } }] }), stderr: '' }
}

/**
 * Багата omlx-відповідь spawnSync із reasoning_content/usage/finish_reason.
 * @param {{content?:string, reasoning?:string, finish?:string, usage?:object}} fields поля message/usage/finish
 * @returns {{status:number, stdout:string, stderr:string}} mock-результат spawnSync
 */
function richResult(fields = {}) {
  const { content = 'x', reasoning, finish = 'stop', usage } = fields
  const message = { content, ...(reasoning ? { reasoning_content: reasoning } : {}) }
  return {
    status: 0,
    stdout: JSON.stringify({ choices: [{ message, finish_reason: finish }], ...(usage ? { usage } : {}) }),
    stderr: ''
  }
}

/**
 * Парсить JSON-body, переданий у spawnSync через opts.input.
 * @param {number} [idx] індекс виклику spawnSync (default 0)
 * @returns {object} розпарсений request body
 */
function sentBody(idx = 0) {
  return JSON.parse(spawnSyncMock.mock.calls[idx][2].input)
}

describe('isOmlxModel', () => {
  test('true лише для префікса omlx/', () => {
    expect(isOmlxModel('omlx/gemma')).toBe(true)
    expect(isOmlxModel('ollama/gemma3:4b')).toBe(false)
    expect(isOmlxModel('openai/gpt-5')).toBe(false)
    expect(isOmlxModel('')).toBe(false)
    expect(isOmlxModel(null)).toBe(false)
    expect(isOmlxModel()).toBe(false)
  })
})

describe('omlxModelId', () => {
  test('зрізає omlx/ префікс, решту лишає без змін', () => {
    expect(omlxModelId('omlx/mlx-community--gemma')).toBe('mlx-community--gemma')
    expect(omlxModelId('ollama/gemma3:4b')).toBe('ollama/gemma3:4b')
    expect(omlxModelId('')).toBe('')
  })
})

describe('callOmlx', () => {
  beforeEach(() => {
    spawnSyncMock.mockReset()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  test('успіх → повертає trimmed content', () => {
    spawnSyncMock.mockReturnValue(okResult('  hello  '))
    const out = callOmlx([{ role: 'user', content: 'hi' }], 'omlx/gemma')
    expect(out).toBe('hello')
    expect(spawnSyncMock).toHaveBeenCalledTimes(1)
  })

  test('зрізає omlx/ префікс у body.model', () => {
    spawnSyncMock.mockReturnValue(okResult('x'))
    callOmlx([{ role: 'user', content: 'hi' }], 'omlx/mlx-community--gemma')
    expect(sentBody().model).toBe('mlx-community--gemma')
  })

  test('порожній model + N_CURSOR_OMLX_MODEL → fallback на env', () => {
    spawnSyncMock.mockReturnValue(okResult('x'))
    const prev = env.N_CURSOR_OMLX_MODEL
    env.N_CURSOR_OMLX_MODEL = 'env-fallback-model'
    try {
      callOmlx([{ role: 'user', content: 'hi' }], '')
      expect(sentBody().model).toBe('env-fallback-model')
    } finally {
      if (prev === undefined) delete env.N_CURSOR_OMLX_MODEL
      else env.N_CURSOR_OMLX_MODEL = prev
    }
  })

  test('порожній model без fallback → throw (fail-loud, без spawn)', () => {
    spawnSyncMock.mockReturnValue(okResult('x'))
    const prev = env.N_CURSOR_OMLX_MODEL
    delete env.N_CURSOR_OMLX_MODEL
    try {
      expect(() => callOmlx([{ role: 'user', content: 'hi' }], '')).toThrow(/модель не задано/)
      expect(spawnSyncMock).not.toHaveBeenCalled()
    } finally {
      if (prev !== undefined) env.N_CURSOR_OMLX_MODEL = prev
    }
  })

  test('body містить messages, temperature, max_tokens', () => {
    spawnSyncMock.mockReturnValue(okResult('x'))
    const messages = [
      { role: 'system', content: 's' },
      { role: 'user', content: 'u' }
    ]
    callOmlx(messages, 'omlx/g', { temperature: 0.7, maxTokens: 256 })
    const body = sentBody()
    expect(body.messages).toEqual(messages)
    expect(body.temperature).toBe(0.7)
    expect(body.max_tokens).toBe(256)
  })

  test('transient curl-код (52) → retry → успіх', () => {
    spawnSyncMock
      .mockReturnValueOnce({ status: 52, stdout: '', stderr: 'empty reply' })
      .mockReturnValueOnce(okResult('after-retry'))
    const out = callOmlx([{ role: 'user', content: 'hi' }], 'omlx/g', { backoffMs: [0, 0] })
    expect(out).toBe('after-retry')
    expect(spawnSyncMock).toHaveBeenCalledTimes(2)
  })

  test('spawnSync ETIMEDOUT → retry з backoff → успіх', () => {
    const timeout = Object.assign(new Error('spawnSync curl ETIMEDOUT'), { code: 'ETIMEDOUT' })
    spawnSyncMock.mockReturnValueOnce({ error: timeout }).mockReturnValueOnce(okResult('after-timeout'))
    const out = callOmlx([{ role: 'user', content: 'hi' }], 'omlx/g', { backoffMs: [0, 0] })
    expect(out).toBe('after-timeout')
    expect(spawnSyncMock).toHaveBeenCalledTimes(2)
  })

  test('не-transient curl-код → кидає одразу без retry', () => {
    spawnSyncMock.mockReturnValue({ status: 7, stdout: '', stderr: 'connection refused' })
    expect(() => callOmlx([{ role: 'user', content: 'hi' }], 'omlx/g')).toThrow(ERR_CURL_EXIT_7)
    expect(spawnSyncMock).toHaveBeenCalledTimes(1)
  })

  test('поганий JSON → кидає omlx bad json', () => {
    spawnSyncMock.mockReturnValue({ status: 0, stdout: 'not json', stderr: '' })
    expect(() => callOmlx([{ role: 'user', content: 'hi' }], 'omlx/g')).toThrow(ERR_BAD_JSON)
  })

  test('api-помилка у відповіді → кидає omlx api', () => {
    spawnSyncMock.mockReturnValue({ status: 0, stdout: JSON.stringify({ error: { message: 'boom' } }), stderr: '' })
    expect(() => callOmlx([{ role: 'user', content: 'hi' }], 'omlx/g')).toThrow(ERR_API)
  })

  test('порожній контент → кидає omlx empty content', () => {
    spawnSyncMock.mockReturnValue({
      status: 0,
      stdout: JSON.stringify({ choices: [{ message: { content: '' }, finish_reason: 'length' }] }),
      stderr: ''
    })
    expect(() => callOmlx([{ role: 'user', content: 'hi' }], 'omlx/g')).toThrow(ERR_EMPTY)
  })

  test('spawnSync.error (curl відсутній) → кидає omlx curl error', () => {
    spawnSyncMock.mockReturnValue({ error: new Error('spawn curl ENOENT') })
    expect(() => callOmlx([{ role: 'user', content: 'hi' }], 'omlx/g')).toThrow(ERR_CURL_ERROR)
  })
})

describe('auth (resolveOmlxApiKey + Authorization-заголовок)', () => {
  beforeEach(() => {
    spawnSyncMock.mockReset()
    readFileSyncMock.mockReset()
    readFileSyncMock.mockImplementation(() => {
      throw new Error('ENOENT')
    })
    delete env.N_CURSOR_OMLX_KEY
  })

  afterEach(() => {
    delete env.N_CURSOR_OMLX_KEY
  })

  test('пріоритет: явний apiKey → env → settings.json → null', () => {
    env.N_CURSOR_OMLX_KEY = 'env-key'
    expect(resolveOmlxApiKey('explicit')).toBe('explicit')
    expect(resolveOmlxApiKey()).toBe('env-key')

    delete env.N_CURSOR_OMLX_KEY
    readFileSyncMock.mockReturnValue(JSON.stringify({ auth: { api_key: 'settings-key' } }))
    expect(resolveOmlxApiKey()).toBe('settings-key')

    readFileSyncMock.mockImplementation(() => {
      throw new Error('ENOENT')
    })
    expect(resolveOmlxApiKey()).toBeNull()
  })

  test('з ключем → curl шле Authorization: Bearer', () => {
    env.N_CURSOR_OMLX_KEY = 'secret-1234'
    spawnSyncMock.mockReturnValue(okResult('x'))
    callOmlx([{ role: 'user', content: 'hi' }], 'omlx/g')
    expect(spawnSyncMock.mock.calls[0][1]).toContain('Authorization: Bearer secret-1234')
  })

  test('без ключа → заголовка Authorization немає', () => {
    spawnSyncMock.mockReturnValue(okResult('x'))
    callOmlx([{ role: 'user', content: 'hi' }], 'omlx/g')
    expect(spawnSyncMock.mock.calls[0][1].join(' ')).not.toContain('Authorization')
  })
})

describe('extractReasoning', () => {
  test('reasoning_content → source=field', () => {
    const r = extractReasoning({ content: '391', reasoning_content: 'Okay…' }, 'stop')
    expect(r).toEqual({ reasoning: 'Okay…', reasoningSource: 'field' })
  })

  test('<think>…</think> у content → source=think_tag, обрізаний внутрішній текст', () => {
    const r = extractReasoning({ content: '<think> hmm </think>answer' }, 'stop')
    expect(r).toEqual({ reasoning: 'hmm', reasoningSource: 'think_tag' })
  })

  test('finish=length без поля/тега → source=truncated, reasoning=content', () => {
    const r = extractReasoning({ content: 'Okay, the user…' }, 'length')
    expect(r).toEqual({ reasoning: 'Okay, the user…', reasoningSource: 'truncated' })
  })

  test('звичайний content (finish=stop) → reasoning=null', () => {
    expect(extractReasoning({ content: '391' }, 'stop')).toEqual({ reasoning: null, reasoningSource: null })
  })
})

describe('callOmlxRaw', () => {
  beforeEach(() => {
    spawnSyncMock.mockReset()
  })

  test('успіх → багатий обʼєкт із content/reasoning/finish/usage/attempts', () => {
    spawnSyncMock.mockReturnValue(richResult({ content: '391', reasoning: 'Okay…', usage: { completion_tokens: 308 } }))
    const r = callOmlxRaw([{ role: 'user', content: 'hi' }], 'omlx/g')
    expect(r).toMatchObject({
      content: '391',
      reasoning: 'Okay…',
      reasoningSource: 'field',
      finishReason: 'stop',
      attempts: 1
    })
    expect(r.usage.completion_tokens).toBe(308)
  })

  test('без usage/reasoning → usage=null, reasoning=null', () => {
    spawnSyncMock.mockReturnValue(richResult({ content: 'plain' }))
    const r = callOmlxRaw([{ role: 'user', content: 'hi' }], 'omlx/g')
    expect(r.usage).toBeNull()
    expect(r.reasoning).toBeNull()
  })

  test('transient retry → attempts відображає номер успішної спроби', () => {
    spawnSyncMock
      .mockReturnValueOnce({ status: 52, stdout: '', stderr: 'empty reply' })
      .mockReturnValueOnce(richResult({ content: 'after-retry' }))
    expect(callOmlxRaw([{ role: 'user', content: 'hi' }], 'omlx/g', { backoffMs: [0, 0] }).attempts).toBe(2)
  })

  test('callOmlx — обгортка, повертає лише .content', () => {
    spawnSyncMock.mockReturnValue(richResult({ content: '  391  ', reasoning: 'r' }))
    expect(callOmlx([{ role: 'user', content: 'hi' }], 'omlx/g')).toBe('391')
  })
})
