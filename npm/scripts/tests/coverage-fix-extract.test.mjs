/**
 * Тести для scripts/coverage-fix-extract.mjs:
 *   - parseSurvivedBlock: 3- і 4-бектикова огорожа, відсутня секція/блок,
 *     невалідний JSON, не-масив;
 *   - buildIndex: згортка у {file, mutants} + фільтр зіпсованих груп;
 *   - runCoverageFixCli: index/slice/помилки, read-only через cwd-ін'єкцію.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { withTmpDir } from '../utils/test-helpers.mjs'
import { buildIndex, parseSurvivedBlock, readSurvived, runCoverageFixCli } from '../coverage-fix-extract.mjs'

/** @returns {object[]} дві групи вцілілих для фікстур */
function sampleSurvived() {
  return [
    {
      file: 'pkg/a.mjs',
      mutants: [
        { line: 2, col: 1, mutantType: 'ArithmeticOperator', original: 'a + b', replacement: 'a - b' },
        { line: 5, col: 3, mutantType: 'BooleanLiteral', original: 'true', replacement: 'false' }
      ]
    },
    {
      file: 'pkg/b.mjs',
      mutants: [{ line: 9, col: 1, mutantType: 'StringLiteral', original: "'x'", replacement: '""' }]
    }
  ]
}

/**
 * Рендерить мінімальний COVERAGE.md з JSON-блоком заданої довжини огорожі.
 * @param {object[]} survived групи
 * @param {string} fence огорожа з 3 або 4 бектиків
 * @returns {string} текст COVERAGE.md
 */
function renderCoverageMd(survived, fence = '```') {
  return [
    '# Coverage',
    '',
    '## Вцілілі мутанти',
    '',
    `${fence}json`,
    JSON.stringify(survived, null, 2),
    fence,
    ''
  ].join('\n')
}

describe('parseSurvivedBlock', () => {
  test('3-бектикова огорожа → масив груп', () => {
    expect(parseSurvivedBlock(renderCoverageMd(sampleSurvived(), '```'))).toHaveLength(2)
  })

  test('4-бектикова огорожа (oxfmt підвищує, коли вміст містить ```) → масив груп', () => {
    const survived = [
      {
        file: 'pkg/c.mjs',
        mutants: [{ line: 1, col: 1, mutantType: 'X', original: 'md ```code```', replacement: '``' }]
      }
    ]
    const parsed = parseSurvivedBlock(renderCoverageMd(survived, '````'))
    expect(parsed).toHaveLength(1)
    expect(parsed[0].file).toBe('pkg/c.mjs')
  })

  test('немає секції → []', () => {
    expect(parseSurvivedBlock('# Coverage\n\nнічого тут')).toEqual([])
  })

  test('секція без json-блоку → []', () => {
    expect(parseSurvivedBlock('## Вцілілі мутанти\n\nтекст без огорожі')).toEqual([])
  })

  test('невалідний JSON → []', () => {
    expect(parseSurvivedBlock('## Вцілілі мутанти\n\n```json\n{не json\n```\n')).toEqual([])
  })

  test('валідний JSON, але не масив → []', () => {
    expect(parseSurvivedBlock('## Вцілілі мутанти\n\n```json\n{"file":"x"}\n```\n')).toEqual([])
  })
})

describe('readSurvived', () => {
  test('читає COVERAGE.md із cwd і повертає групи', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'COVERAGE.md'), renderCoverageMd(sampleSurvived()), 'utf8')
      expect(await readSurvived(dir)).toHaveLength(2)
    })
  })

  test('немає COVERAGE.md → []', async () => {
    await withTmpDir(async dir => {
      expect(await readSurvived(dir)).toEqual([])
    })
  })
})

describe('buildIndex', () => {
  test('згортає у {file, mutants}', () => {
    expect(buildIndex(sampleSurvived())).toEqual([
      { file: 'pkg/a.mjs', mutants: 2 },
      { file: 'pkg/b.mjs', mutants: 1 }
    ])
  })

  test('фільтрує групи без file або без масиву mutants', () => {
    const dirty = [{ file: 'ok.mjs', mutants: [{}] }, { file: 42, mutants: [] }, { mutants: [] }, null]
    expect(buildIndex(dirty)).toEqual([{ file: 'ok.mjs', mutants: 1 }])
  })
})

describe('runCoverageFixCli', () => {
  let outSpy
  let errSpy
  beforeEach(() => {
    outSpy = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
    errSpy = vi.spyOn(console, 'error').mockReturnValue()
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  test('index → друкує компактний JSON, exit 0', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'COVERAGE.md'), renderCoverageMd(sampleSurvived()), 'utf8')
      const code = await runCoverageFixCli(['index'], dir)
      expect(code).toBe(0)
      const printed = outSpy.mock.calls.at(-1)[0]
      expect(JSON.parse(printed)).toEqual([
        { file: 'pkg/a.mjs', mutants: 2 },
        { file: 'pkg/b.mjs', mutants: 1 }
      ])
    })
  })

  test('index без COVERAGE.md → [] і exit 0', async () => {
    await withTmpDir(async dir => {
      const code = await runCoverageFixCli(['index'], dir)
      expect(code).toBe(0)
      expect(outSpy.mock.calls.at(-1)[0].trim()).toBe('[]')
    })
  })

  test('slice --file <known> → промпт із ### `file`, exit 0', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'COVERAGE.md'), renderCoverageMd(sampleSurvived()), 'utf8')
      const code = await runCoverageFixCli(['slice', '--file', 'pkg/a.mjs'], dir)
      expect(code).toBe(0)
      const printed = outSpy.mock.calls.at(-1)[0]
      expect(printed).toContain('### `pkg/a.mjs`')
      expect(printed).toContain('ArithmeticOperator')
      expect(printed).not.toContain('pkg/b.mjs')
    })
  })

  test('slice без --file → exit 1', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'COVERAGE.md'), renderCoverageMd(sampleSurvived()), 'utf8')
      expect(await runCoverageFixCli(['slice'], dir)).toBe(1)
      expect(errSpy).toHaveBeenCalled()
    })
  })

  test('slice --file <unknown> → exit 1', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'COVERAGE.md'), renderCoverageMd(sampleSurvived()), 'utf8')
      expect(await runCoverageFixCli(['slice', '--file', 'nope.mjs'], dir)).toBe(1)
    })
  })

  test('невідома підкоманда → exit 1', async () => {
    await withTmpDir(async dir => {
      expect(await runCoverageFixCli(['bogus'], dir)).toBe(1)
      expect(errSpy).toHaveBeenCalled()
    })
  })
})
