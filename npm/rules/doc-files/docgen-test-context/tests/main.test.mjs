import { describe, expect, test } from 'vitest'
import { join } from 'node:path'
import { writeFile } from 'node:fs/promises'

import { ensureDir, withTmpDir } from '../../../../scripts/utils/test-helpers.mjs'
import {
  buildTestEvidenceIndex,
  isDocgenTestFile,
  renderTestScenarios,
  sourceFilesForTest,
  testEvidenceForSource
} from '../main.mjs'

describe('isDocgenTestFile', () => {
  test('розпізнає JS/TS test/spec і Python test naming', () => {
    for (const name of ['foo.test.mjs', 'foo.spec.ts', 'test_foo.py', 'foo_test.py']) {
      expect(isDocgenTestFile(name)).toBe(true)
    }
  })

  test('звичайний source-файл не є тестом', () => {
    expect(isDocgenTestFile('foo.mjs')).toBe(false)
  })
})

describe('buildTestEvidenceIndex', () => {
  test('звʼязує source лише з тестом, що реально посилається на нього', async () => {
    await withTmpDir(async root => {
      const source = join(root, 'src', 'math.mjs')
      const related = join(root, 'src', 'tests', 'math.test.mjs')
      const unrelated = join(root, 'src', 'tests', 'other.test.mjs')
      await ensureDir(join(root, 'src', 'tests'))
      await writeFile(source, 'export const add = (a, b) => a + b\n')
      await writeFile(
        related,
        "import { add } from '../math.mjs'\ntest('додає два числа', () => expect(add(1, 2)).toBe(3))\n"
      )
      await writeFile(unrelated, "test('інший сценарій', () => expect(true).toBe(true))\n")

      const index = buildTestEvidenceIndex(root)
      const evidence = testEvidenceForSource(source, index)

      expect(evidence.files).toEqual([{ path: 'src/tests/math.test.mjs', scenarios: ['додає два числа'] }])
      expect(evidence).not.toHaveProperty('prompt')
      expect(sourceFilesForTest(related, index)).toEqual([source])
      expect(sourceFilesForTest(unrelated, index)).toEqual([])
    })
  })

  test('підтримує import без розширення і vi.mock relative reference', async () => {
    await withTmpDir(async root => {
      const source = join(root, 'src', 'client.ts')
      const testFile = join(root, 'tests', 'client.spec.ts')
      await ensureDir(join(root, 'src'))
      await ensureDir(join(root, 'tests'))
      await writeFile(source, 'export const client = {}\n')
      await writeFile(testFile, "vi.mock('../src/client')\nit('підміняє client', () => {})\n")

      const index = buildTestEvidenceIndex(root)
      expect(testEvidenceForSource(source, index).files[0].scenarios).toEqual(['підміняє client'])
    })
  })

  test('не вважає shared test helper джерелом поведінки лише через import', async () => {
    await withTmpDir(async root => {
      const source = join(root, 'src', 'math.mjs')
      const helper = join(root, 'test-utils', 'test-helpers.mjs')
      const testFile = join(root, 'src', 'tests', 'math.test.mjs')
      await ensureDir(join(root, 'src', 'tests'))
      await ensureDir(join(root, 'test-utils'))
      await writeFile(source, 'export const add = (a, b) => a + b\n')
      await writeFile(helper, 'export const fixture = () => 1\n')
      await writeFile(
        testFile,
        "import { add } from '../math.mjs'\nimport { fixture } from '../../test-utils/test-helpers.mjs'\ntest('додає fixture', () => expect(add(fixture(), 2)).toBe(3))\n"
      )

      const index = buildTestEvidenceIndex(root)
      expect(testEvidenceForSource(source, index).files).toHaveLength(1)
      expect(testEvidenceForSource(helper, index).files).toEqual([])
    })
  })
})

describe('renderTestScenarios', () => {
  test('зберігає test-шлях і назву сценарію дослівно, без LLM-інтерпретації', () => {
    expect(renderTestScenarios([{ path: 'src/tests/math.test.mjs', scenarios: ['додає два числа'] }])).toBe(
      '- `src/tests/math.test.mjs` — додає два числа'
    )
  })

  test('порожній набір сценаріїв не створює вміст секції', () => {
    expect(renderTestScenarios([])).toBe('')
  })
})
