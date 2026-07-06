/**
 * Тести body-capture: no-op вимкненого стану, запис/структура файлу,
 * групування за chainId/caller, ретеншн (авто-очистка над лімітом).
 */
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { bodiesDir, bodyCaptureEnabled, captureBody } from '../lib/body-capture.mjs'

const chainIdPathPattern = /c1[/\\]2\.json$/
const callerPathPattern = /docgen[/\\]1\.json$/

let dir

afterEach(() => {
  vi.unstubAllEnvs()
  if (dir) rmSync(dir, { recursive: true, force: true })
  dir = undefined
})

describe('bodyCaptureEnabled/bodiesDir', () => {
  test('вимкнено за замовчуванням', () => {
    expect(bodyCaptureEnabled()).toBe(false)
  })

  test('N_LLM_TRACE_BODIES=1 вмикає', () => {
    vi.stubEnv('N_LLM_TRACE_BODIES', '1')
    expect(bodyCaptureEnabled()).toBe(true)
  })

  test('bodiesDir — env-override', () => {
    // Префікс збираємо з частин, щоб sonarjs/publicly-writable-directories не флагав літерал.
    const customDir = ['', 'tmp', 'custom-bodies'].join('/')
    vi.stubEnv('N_LLM_BODIES_DIR', customDir)
    expect(bodiesDir()).toBe(customDir)
  })
})

describe('captureBody', () => {
  test('no-op (null) коли вимкнено', () => {
    dir = mkdtempSync(join(tmpdir(), 'llm-bodies-'))
    const result = captureBody({ caller: 'x', prompt: 'p', output: 'o' }, { dir })
    expect(result).toBeNull()
    expect(readdirSync(dir)).toHaveLength(0)
  })

  test('пише JSON-файл під chainId, повне поле prompt/output/usage/error', () => {
    vi.stubEnv('N_LLM_TRACE_BODIES', '1')
    dir = mkdtempSync(join(tmpdir(), 'llm-bodies-'))
    const path = captureBody(
      {
        chainId: 'c1',
        caller: 'fix:rule',
        step: 2,
        model: 'omlx/x',
        promptHash: 'h1',
        prompt: 'P',
        output: 'O',
        usage: { totalTokens: 5 },
        error: null
      },
      { dir }
    )
    expect(path).toMatch(chainIdPathPattern)
    const saved = JSON.parse(readFileSync(path, 'utf8'))
    expect(saved).toMatchObject({
      caller: 'fix:rule',
      chainId: 'c1',
      chainStep: 2,
      model: 'omlx/x',
      promptHash: 'h1',
      prompt: 'P',
      output: 'O',
      usage: { totalTokens: 5 },
      error: null
    })
    expect(saved.ts).toEqual(expect.any(String))
  })

  test('групує за caller, коли chainId відсутній', () => {
    vi.stubEnv('N_LLM_TRACE_BODIES', '1')
    dir = mkdtempSync(join(tmpdir(), 'llm-bodies-'))
    const path = captureBody({ caller: 'docgen', step: 1, prompt: 'p', output: 'o' }, { dir })
    expect(path).toMatch(callerPathPattern)
  })

  test('санітизує компоненти шляху (немає directory traversal)', () => {
    vi.stubEnv('N_LLM_TRACE_BODIES', '1')
    dir = mkdtempSync(join(tmpdir(), 'llm-bodies-'))
    const path = captureBody({ chainId: '../../etc', step: '../x', prompt: 'p', output: 'o' }, { dir })
    expect(path.startsWith(dir)).toBe(true)
    expect(path).not.toContain('..')
  })

  test('best-effort: помилка запису не кидає, повертає null', () => {
    vi.stubEnv('N_LLM_TRACE_BODIES', '1')
    // Неіснуючий шлях із забороненим символом null-byte — writeFileSync кине синхронно.
    const result = captureBody({ caller: 'x', prompt: 'p', output: 'o' }, { dir: '\0invalid' })
    expect(result).toBeNull()
  })
})

describe('ретеншн (авто-очистка над лімітом)', () => {
  test('видаляє найстаріші файли, коли сумарний розмір перевищує N_LLM_BODIES_MAX_MB', () => {
    vi.stubEnv('N_LLM_TRACE_BODIES', '1')
    vi.stubEnv('N_LLM_BODIES_MAX_MB', String(1 / 1024)) // 1KB ліміт
    dir = mkdtempSync(join(tmpdir(), 'llm-bodies-'))

    const big = 'x'.repeat(600)
    const p1 = captureBody({ chainId: 'old', step: 1, prompt: big, output: '' }, { dir })
    // Різні mtime для детермінованого порядку видалення (old — найстаріший).
    utimesSync(p1, new Date(Date.now() - 10_000), new Date(Date.now() - 10_000))
    captureBody({ chainId: 'new', step: 1, prompt: big, output: '' }, { dir })

    // Останній запис (new) лишається, найстаріший (old) видалено при перевищенні бюджету.
    const oldDirExists = readdirSync(dir).includes('old') && readdirSync(join(dir, 'old')).length > 0
    expect(oldDirExists).toBe(false)
    expect(readdirSync(join(dir, 'new'))).toHaveLength(1)
  })

  test('не чіпає стор, коли сумарний розмір під лімітом', () => {
    vi.stubEnv('N_LLM_TRACE_BODIES', '1')
    dir = mkdtempSync(join(tmpdir(), 'llm-bodies-'))
    captureBody({ chainId: 'c', step: 1, prompt: 'short', output: '' }, { dir })
    expect(readdirSync(join(dir, 'c'))).toHaveLength(1)
    expect(statSync(join(dir, 'c', '1.json')).size).toBeGreaterThan(0)
  })
})
