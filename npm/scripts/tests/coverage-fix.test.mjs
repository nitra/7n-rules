/**
 * Тести для scripts/coverage-fix.mjs:
 *   - early-return при порожньому `survived[]` з логом про вбитих мутантів;
 *   - buildFixPrompt (опосередковано) — гілки exampleTest/code, контекст ±3 рядки,
 *     graceful fallback коли source-файл недоступний.
 *
 * `@anthropic-ai/claude-agent-sdk` мокається — реальний агент не запускається.
 * Захоплюємо аргументи `query(...)` і перевіряємо текст промпта.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { join } from 'node:path'
import { writeFile } from 'node:fs/promises'

import { ensureDir, withTmpDir } from '../utils/test-helpers.mjs'

/** @type {{ prompt: string, options: { cwd: string, maxTurns: number, allowedTools: string[] } } | null} */
let capturedQuery = null

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: vi.fn(args => {
    capturedQuery = args
    return (async function* () {
      yield { type: 'text', text: 'mock-msg' }
    })()
  })
}))

const { fixSurvivedMutants } = await import('../coverage-fix.mjs')

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
    capturedQuery = null
    logSpy = vi.spyOn(console, 'log').mockReturnValue()
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  test('survived=[] → друкує "Всі мутанти вбиті" і не викликає query', async () => {
    await fixSurvivedMutants([], '/repo')
    expect(logSpy).toHaveBeenCalledWith('✓ Всі мутанти вбиті — доповнення тестів не потрібне')
    expect(capturedQuery).toBeNull()
  })

  test('survived з порожніми mutants[] → той самий early-return', async () => {
    await fixSurvivedMutants([{ file: 'x.mjs', mutants: [], exampleTest: null, recommendationText: null }], '/repo')
    expect(logSpy).toHaveBeenCalledWith('✓ Всі мутанти вбиті — доповнення тестів не потрібне')
    expect(capturedQuery).toBeNull()
  })
})

describe('fixSurvivedMutants — викликає query з rich-промптом (buildFixPrompt)', () => {
  beforeEach(() => {
    capturedQuery = null
    vi.spyOn(console, 'log').mockReturnValue()
    vi.spyOn(process.stdout, 'write').mockReturnValue(true)
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  test('передає cwd, maxTurns=20, allowedTools=[Read,Edit,Bash], permissionMode=bypassPermissions', async () => {
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
        dir
      )
      expect(capturedQuery?.options).toEqual({
        cwd: dir,
        maxTurns: 20,
        allowedTools: ['Read', 'Edit', 'Bash'],
        permissionMode: 'bypassPermissions'
      })
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
        dir
      )
      expect(capturedQuery?.prompt).toContain('## Вцілілі мутанти')
      expect(capturedQuery?.prompt).toContain('### `pkg/foo.mjs`')
      expect(capturedQuery?.prompt).toContain('Рядок 2, колонка 1, тип мутації `ArithmeticOperator`')
      expect(capturedQuery?.prompt).toContain('Оригінал: `a + b`')
      expect(capturedQuery?.prompt).toContain('Вижив варіант: `a - b`')
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
        dir
      )
      expect(capturedQuery?.prompt).toContain('Контекст:')
      expect(capturedQuery?.prompt).toContain('4: ')
      expect(capturedQuery?.prompt).toContain("if (x === 1) return 'one'")
    })
  })

  test('коли source-файл недоступний — секція контексту не додається, query все одно викликається', async () => {
    await withTmpDir(async dir => {
      // pkg/foo.mjs НЕ створюємо
      await fixSurvivedMutants(
        [
          {
            file: 'pkg/foo.mjs',
            mutants: [{ line: 1, col: 1, mutantType: 'BooleanLiteral', original: 'true', replacement: 'false' }],
            exampleTest: null,
            recommendationText: null
          }
        ],
        dir
      )
      expect(capturedQuery?.prompt).not.toContain('Контекст:')
      expect(capturedQuery?.prompt).toContain('Оригінал: `true`')
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
        dir
      )
      expect(capturedQuery?.prompt).toContain('Приклад тесту з `tests/foo.test.mjs`')
      expect(capturedQuery?.prompt).toContain("test('x', () => expect(1).toBe(1))")
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
        dir
      )
      expect(capturedQuery?.prompt).not.toContain('Приклад тесту')
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
        dir
      )
      expect(capturedQuery?.prompt).not.toContain('Приклад тесту')
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
        dir
      )
      expect(capturedQuery?.prompt).toContain('### `a.mjs`')
      expect(capturedQuery?.prompt).toContain('### `b.mjs`')
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
        dir
      )
      const prompt = capturedQuery?.prompt ?? ''
      expect(prompt).toContain('## Правила')
      expect(prompt).toContain('Не змінюй source-файли')
      expect(prompt).toContain('bun test')
    })
  })
})
