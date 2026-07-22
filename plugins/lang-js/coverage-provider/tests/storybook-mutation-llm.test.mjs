/**
 * Тести LLM-джерела мутантів (storybook-mutation-llm.mjs): жорстка валідація
 * пропозицій (рядок/підрядок/покриття/синтаксис), graceful-контракти, opt-out.
 * Все з ін'єкціями callTextFn/makeChain — без мережі.
 */
import { afterEach, describe, expect, test, vi } from 'vitest'

import { proposeLlmMutants } from '../storybook-mutation-llm.mjs'

const SRC = 'export function f(x) {\n  return x.slice(0, 5)\n}\n'

/**
 * Фейкова фабрика ланцюжка (без trace-записів).
 * @returns {{chain: object, end: import('vitest').Mock}} chain-handle і його end-спай
 */
function fakeChain() {
  const end = vi.fn()
  return { chain: { end }, end }
}

/**
 * Викликає proposeLlmMutants з ін'єкціями і відповіддю LLM.
 * @param {string} responseText текст відповіді LLM
 * @param {object} [overrides] перевизначення опцій
 * @returns {Promise<Array<object>>} результат proposeLlmMutants
 */
function propose(responseText, overrides = {}) {
  const { chain } = fakeChain()
  return proposeLlmMutants({
    file: 'src/a.js',
    source: SRC,
    coveredLines: new Set([2]),
    cwd: '/proj',
    callTextFn: () => Promise.resolve(responseText),
    makeChain: () => chain,
    ...overrides
  })
}

describe('proposeLlmMutants — валідація пропозицій', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  test('валідна пропозиція → мутант із коректними offsets і mutantType llm:<category>', async () => {
    const mutants = await propose(
      JSON.stringify([
        { line: 2, original: 'slice(0, 5)', replacement: 'slice(1, 5)', category: 'off-by-one', reason: 'зсув межі' }
      ])
    )
    expect(mutants).toHaveLength(1)
    expect(mutants[0]).toMatchObject({
      line: 2,
      mutantType: 'llm:off-by-one',
      original: 'slice(0, 5)',
      replacement: 'slice(1, 5)',
      tier: 6
    })
    // offsets вказують на реальний підрядок у повному файлі
    expect(SRC.slice(mutants[0].start, mutants[0].end)).toBe('slice(0, 5)')
  })

  test('пропозиція без category → mutantType llm:proposed', async () => {
    const mutants = await propose(JSON.stringify([{ line: 2, original: 'return', replacement: 'if (x) return' }]))
    expect(mutants[0].mutantType).toBe('llm:proposed')
  })

  test('original не є підрядком рядка → відкидається', async () => {
    const mutants = await propose(JSON.stringify([{ line: 2, original: 'NOT_THERE', replacement: 'x' }]))
    expect(mutants).toEqual([])
  })

  test('непокритий рядок → відкидається', async () => {
    const mutants = await propose(JSON.stringify([{ line: 1, original: 'function', replacement: 'async function' }]))
    expect(mutants).toEqual([])
  })

  test('синтаксично невалідна заміна → відкидається (parseAst-перевірка)', async () => {
    const mutants = await propose(JSON.stringify([{ line: 2, original: 'slice(0, 5)', replacement: 'slice((' }]))
    expect(mutants).toEqual([])
  })

  test('replacement === original або порожній original → відкидається', async () => {
    const mutants = await propose(
      JSON.stringify([
        { line: 2, original: 'slice(0, 5)', replacement: 'slice(0, 5)' },
        { line: 2, original: '', replacement: 'x' }
      ])
    )
    expect(mutants).toEqual([])
  })

  test('відповідь без JSON-масиву → []', async () => {
    expect(await propose('вибачте, не можу')).toEqual([])
  })

  test('markdown-обгортка навколо JSON — масив все одно витягується', async () => {
    const mutants = await propose(
      '```json\n' + JSON.stringify([{ line: 2, original: '0, 5', replacement: '1, 5' }]) + '\n```'
    )
    expect(mutants).toHaveLength(1)
  })

  test('.vue: пропозиція у script-блоці мапиться на абсолютний рядок файлу', async () => {
    const vueSrc = '<template><div /></template>\n<script setup>\nconst n = list.slice(0, 3)\n</script>\n'
    const mutants = await proposeLlmMutants({
      file: 'src/Card.vue',
      source: vueSrc,
      coveredLines: new Set([3]),
      cwd: '/proj',
      callTextFn: prompt => {
        // script-блок нумерується абсолютними номерами рядків повного файлу
        expect(prompt).toContain('3: const n = list.slice(0, 3)')
        return Promise.resolve(JSON.stringify([{ line: 3, original: 'slice(0, 3)', replacement: 'slice(0, 2)' }]))
      },
      makeChain: () => fakeChain().chain
    })
    expect(mutants).toHaveLength(1)
    expect(vueSrc.slice(mutants[0].start, mutants[0].end)).toBe('slice(0, 3)')
  })

  test('.vue з lang="ts" → [] без LLM-виклику', async () => {
    const callTextFn = vi.fn()
    const mutants = await proposeLlmMutants({
      file: 'src/Card.vue',
      source: '<script setup lang="ts">\nconst x: number = 1\n</script>\n',
      coveredLines: new Set([2]),
      cwd: '/proj',
      callTextFn,
      makeChain: () => fakeChain().chain
    })
    expect(mutants).toEqual([])
    expect(callTextFn).not.toHaveBeenCalled()
  })

  test('N_7N_TEST_NO_LLM_MUTANTS=1 → [] без LLM-виклику', async () => {
    vi.stubEnv('N_7N_TEST_NO_LLM_MUTANTS', '1')
    const callTextFn = vi.fn()
    const mutants = await propose('', { callTextFn })
    expect(mutants).toEqual([])
    expect(callTextFn).not.toHaveBeenCalled()
  })

  test('помилка LLM-виклику пробивається нагору, chain закривається як fail', async () => {
    const { chain, end } = fakeChain()
    await expect(
      proposeLlmMutants({
        file: 'src/a.js',
        source: SRC,
        coveredLines: new Set([2]),
        cwd: '/proj',
        callTextFn: () => Promise.reject(new Error('no api key')),
        makeChain: () => chain
      })
    ).rejects.toThrow('no api key')
    expect(end).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'fail' }))
  })

  test('успішний виклик закриває chain як success', async () => {
    const { chain, end } = fakeChain()
    await proposeLlmMutants({
      file: 'src/a.js',
      source: SRC,
      coveredLines: new Set([2]),
      cwd: '/proj',
      callTextFn: () => Promise.resolve('[]'),
      makeChain: () => chain
    })
    expect(end).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'success' }))
  })
})
