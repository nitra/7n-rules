/**
 * Тести для scripts/coverage-fix.mjs:
 *   - early-return при порожньому `survived[]` з логом про вбитих мутантів;
 *   - buildFixPrompt — гілки exampleTest/code, контекст ±3 рядки,
 *     graceful fallback коли source-файл недоступний.
 *
 * callPi ін'єктується через opts.callPi — реальний агент не запускається.
 * Захоплюємо (prompt, model, piOpts) і перевіряємо текст промпту.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { join } from 'node:path'
import { writeFile } from 'node:fs/promises'

import { ensureDir, withTmpDir } from '../utils/test-helpers.mjs'
import { fixSurvivedMutants } from '../coverage-fix.mjs'

const SAMPLE_SOURCE = `import { foo } from './foo.mjs'

export function bar() {
  if (x === 1) return 'one'
  if (x === 2) return 'two'
  return 'other'
}
`

describe('fixSurvivedMutants — early return', () => {
  let logSpy
  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockReturnValue()
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  test('survived=[] → друкує "Всі мутанти вбиті" і не викликає callPi', async () => {
    const mockCallPi = vi.fn()
    await fixSurvivedMutants([], '/repo', { callPi: mockCallPi })
    expect(logSpy).toHaveBeenCalledWith('✓ Всі мутанти вбиті — доповнення тестів не потрібне')
    expect(mockCallPi).not.toHaveBeenCalled()
  })

  test('survived з порожніми mutants[] → той самий early-return', async () => {
    const mockCallPi = vi.fn()
    await fixSurvivedMutants([{ file: 'x.mjs', mutants: [], exampleTest: null, recommendationText: null }], '/repo', {
      callPi: mockCallPi
    })
    expect(logSpy).toHaveBeenCalledWith('✓ Всі мутанти вбиті — доповнення тестів не потрібне')
    expect(mockCallPi).not.toHaveBeenCalled()
  })
})

describe('fixSurvivedMutants — викликає pi з rich-промптом (buildFixPrompt)', () => {
  let capturedArgs

  beforeEach(() => {
    capturedArgs = null
    vi.spyOn(console, 'log').mockReturnValue()
    vi.spyOn(process.stdout, 'write').mockReturnValue(true)
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  /**
   * Хелпер: повертає opts.callPi mock, що зберігає аргументи.
   * @returns {(prompt: string, model: string, opts: { cwd: string }) => void} mock-функція callPi
   */
  function captureCallPi() {
    return (prompt, model, piOpts) => {
      capturedArgs = { prompt, model, cwd: piOpts?.cwd }
    }
  }

  test('передає cwd проєкту до pi', async () => {
    await withTmpDir(async dir => {
      await fixSurvivedMutants(
        [
          {
            file: 'x.mjs',
            mutants: [{ line: 1, col: 1, mutantType: 'BooleanLiteral', original: 'true', replacement: 'false' }],
            exampleTest: null,
            recommendationText: null
          }
        ],
        dir,
        { callPi: captureCallPi() }
      )
      expect(capturedArgs?.cwd).toBe(dir)
    })
  })

  test('містить заголовок "## Вцілілі мутанти" і блок ### `<file>`', async () => {
    await withTmpDir(async dir => {
      await fixSurvivedMutants(
        [
          {
            file: 'pkg/foo.mjs',
            mutants: [{ line: 2, col: 1, mutantType: 'ArithmeticOperator', original: 'a + b', replacement: 'a - b' }],
            exampleTest: null,
            recommendationText: null
          }
        ],
        dir,
        { callPi: captureCallPi() }
      )
      expect(capturedArgs?.prompt).toContain('## Вцілілі мутанти')
      expect(capturedArgs?.prompt).toContain('### `pkg/foo.mjs`')
      expect(capturedArgs?.prompt).toContain('Рядок 2, колонка 1, тип мутації `ArithmeticOperator`')
      expect(capturedArgs?.prompt).toContain('Оригінал: `a + b`')
      expect(capturedArgs?.prompt).toContain('Вижив варіант: `a - b`')
    })
  })

  test('коли source-файл доступний — додає контекст ±3 рядки навколо мутанта', async () => {
    await withTmpDir(async dir => {
      await ensureDir(join(dir, 'pkg'))
      await writeFile(join(dir, 'pkg/foo.mjs'), SAMPLE_SOURCE, 'utf8')
      await fixSurvivedMutants(
        [
          {
            file: 'pkg/foo.mjs',
            mutants: [{ line: 4, col: 1, mutantType: 'EqualityOperator', original: '===', replacement: '!==' }],
            exampleTest: null,
            recommendationText: null
          }
        ],
        dir,
        { callPi: captureCallPi() }
      )
      expect(capturedArgs?.prompt).toContain('Контекст:')
      expect(capturedArgs?.prompt).toContain('4: ')
      expect(capturedArgs?.prompt).toContain("if (x === 1) return 'one'")
    })
  })

  test('коли source-файл недоступний — секція контексту не додається, pi все одно викликається', async () => {
    await withTmpDir(async dir => {
      await fixSurvivedMutants(
        [
          {
            file: 'pkg/foo.mjs',
            mutants: [{ line: 1, col: 1, mutantType: 'BooleanLiteral', original: 'true', replacement: 'false' }],
            exampleTest: null,
            recommendationText: null
          }
        ],
        dir,
        { callPi: captureCallPi() }
      )
      expect(capturedArgs?.prompt).not.toContain('Контекст:')
      expect(capturedArgs?.prompt).toContain('Оригінал: `true`')
    })
  })

  test('exampleTest з code → секція "Приклад тесту з ..." з ```js блоком', async () => {
    await withTmpDir(async dir => {
      await fixSurvivedMutants(
        [
          {
            file: 'foo.mjs',
            mutants: [{ line: 1, col: 1, mutantType: 'X', original: 'a', replacement: 'b' }],
            exampleTest: { testFile: 'tests/foo.test.mjs', code: "test('x', () => expect(1).toBe(1))" },
            recommendationText: null
          }
        ],
        dir,
        { callPi: captureCallPi() }
      )
      expect(capturedArgs?.prompt).toContain('Приклад тесту з `tests/foo.test.mjs`')
      expect(capturedArgs?.prompt).toContain("test('x', () => expect(1).toBe(1))")
    })
  })

  test('exampleTest === null → секція "Приклад тесту" відсутня', async () => {
    await withTmpDir(async dir => {
      await fixSurvivedMutants(
        [
          {
            file: 'foo.mjs',
            mutants: [{ line: 1, col: 1, mutantType: 'X', original: 'a', replacement: 'b' }],
            exampleTest: null,
            recommendationText: null
          }
        ],
        dir,
        { callPi: captureCallPi() }
      )
      expect(capturedArgs?.prompt).not.toContain('Приклад тесту')
    })
  })

  test('exampleTest.code === null → теж без секції "Приклад тесту"', async () => {
    await withTmpDir(async dir => {
      await fixSurvivedMutants(
        [
          {
            file: 'foo.mjs',
            mutants: [{ line: 1, col: 1, mutantType: 'X', original: 'a', replacement: 'b' }],
            exampleTest: { testFile: 'tests/foo.test.mjs', code: null },
            recommendationText: null
          }
        ],
        dir,
        { callPi: captureCallPi() }
      )
      expect(capturedArgs?.prompt).not.toContain('Приклад тесту')
    })
  })

  test('кілька файлів-груп — у промпті є ### для кожного', async () => {
    await withTmpDir(async dir => {
      await fixSurvivedMutants(
        [
          {
            file: 'a.mjs',
            mutants: [{ line: 1, col: 1, mutantType: 'X', original: 'a', replacement: 'b' }],
            exampleTest: null,
            recommendationText: null
          },
          {
            file: 'b.mjs',
            mutants: [{ line: 2, col: 1, mutantType: 'X', original: 'c', replacement: 'd' }],
            exampleTest: null,
            recommendationText: null
          }
        ],
        dir,
        { callPi: captureCallPi() }
      )
      expect(capturedArgs?.prompt).toContain('### `a.mjs`')
      expect(capturedArgs?.prompt).toContain('### `b.mjs`')
    })
  })

  test('містить "## Правила" з фіксованими інструкціями', async () => {
    await withTmpDir(async dir => {
      await fixSurvivedMutants(
        [
          {
            file: 'a.mjs',
            mutants: [{ line: 1, col: 1, mutantType: 'X', original: 'a', replacement: 'b' }],
            exampleTest: null,
            recommendationText: null
          }
        ],
        dir,
        { callPi: captureCallPi() }
      )
      expect(capturedArgs?.prompt).toContain('## Правила')
      expect(capturedArgs?.prompt).toContain('Не змінюй source-файли')
      expect(capturedArgs?.prompt).toContain('bun test')
    })
  })
})
