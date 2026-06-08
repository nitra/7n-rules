/**
 * Тести prompt.mjs: SYSTEM_PROMPT (статика) + buildUserPrompt (assembly).
 */
import { describe, expect, test } from 'vitest'
import { join } from 'node:path'
import { writeFile } from 'node:fs/promises'

import { buildUserPrompt, SYSTEM_PROMPT } from '../prompt.mjs'
import { ensureDir, withTmpDir } from '../../utils/test-helpers.mjs'

const JSON_RE = /JSON/u
const REASON_RE = /reason/u
const CONFIDENCE_RE = /confidence/u

const SAMPLE_SOURCE = `import { foo } from './foo.mjs'

export function bar() {
  if (x === 1) return 'one'
  if (x === 2) return 'two'
  return 'other'
}
`

describe('SYSTEM_PROMPT', () => {
  test('містить опис усіх 5 категорій verdict', () => {
    expect(SYSTEM_PROMPT).toContain('worth-testing')
    expect(SYSTEM_PROMPT).toContain('equivalent')
    expect(SYSTEM_PROMPT).toContain('defensive')
    expect(SYSTEM_PROMPT).toContain('glue')
    expect(SYSTEM_PROMPT).toContain('wrapper')
  })

  test('вимагає JSON-only output', () => {
    expect(SYSTEM_PROMPT).toMatch(JSON_RE)
  })

  test('містить schema constraints (reason min length, confidence range)', () => {
    expect(SYSTEM_PROMPT).toMatch(REASON_RE)
    expect(SYSTEM_PROMPT).toMatch(CONFIDENCE_RE)
  })
})

describe('buildUserPrompt', () => {
  test('містить mutant location, original→replacement, type', async () => {
    await withTmpDir(async dir => {
      await ensureDir(join(dir, 'pkg'))
      await writeFile(join(dir, 'pkg/foo.mjs'), SAMPLE_SOURCE, 'utf8')
      const mutant = {
        file: 'pkg/foo.mjs',
        line: 4,
        col: 7,
        mutantType: 'EqualityOperator',
        original: '===',
        replacement: '!=='
      }
      const prompt = buildUserPrompt(mutant, dir)
      expect(prompt).toContain('pkg/foo.mjs')
      expect(prompt).toContain('Line: 4:7')
      expect(prompt).toContain('Type: EqualityOperator')
      expect(prompt).toContain('Original code: `===`')
      expect(prompt).toContain('Mutated to: `!==`')
    })
  })

  test('додає source context ±10 рядків з номерами', async () => {
    await withTmpDir(async dir => {
      await ensureDir(join(dir, 'pkg'))
      await writeFile(join(dir, 'pkg/foo.mjs'), SAMPLE_SOURCE, 'utf8')
      const mutant = { file: 'pkg/foo.mjs', line: 4, col: 7, mutantType: 'X', original: 'a', replacement: 'b' }
      const prompt = buildUserPrompt(mutant, dir)
      expect(prompt).toContain('4: ')
      expect(prompt).toContain("if (x === 1) return 'one'")
    })
  })

  test('відсутній source файл → context-placeholder', async () => {
    await withTmpDir(dir => {
      const mutant = { file: 'no/such.mjs', line: 1, col: 1, mutantType: 'X', original: 'a', replacement: 'b' }
      const prompt = buildUserPrompt(mutant, dir)
      expect(prompt).toContain('source file unavailable')
    })
  })

  test('наявний test-файл → секція "Existing tests"', async () => {
    await withTmpDir(async dir => {
      await ensureDir(join(dir, 'pkg/tests'))
      await writeFile(join(dir, 'pkg/foo.mjs'), SAMPLE_SOURCE, 'utf8')
      await writeFile(join(dir, 'pkg/tests/foo.test.mjs'), 'test("bar", () => {})\n', 'utf8')
      const mutant = { file: 'pkg/foo.mjs', line: 4, col: 7, mutantType: 'X', original: 'a', replacement: 'b' }
      const prompt = buildUserPrompt(mutant, dir)
      expect(prompt).toContain('# Existing tests')
      expect(prompt).toContain('test("bar"')
    })
  })

  test('відсутній test-файл → placeholder', async () => {
    await withTmpDir(async dir => {
      await ensureDir(join(dir, 'pkg'))
      await writeFile(join(dir, 'pkg/foo.mjs'), SAMPLE_SOURCE, 'utf8')
      const mutant = { file: 'pkg/foo.mjs', line: 1, col: 1, mutantType: 'X', original: 'a', replacement: 'b' }
      const prompt = buildUserPrompt(mutant, dir)
      expect(prompt).toContain('# Existing tests')
      expect(prompt).toContain('(no test file)')
    })
  })

  test('великий test-файл (>2000 рядків) → list of describe/test titles, не повний text', async () => {
    await withTmpDir(async dir => {
      await ensureDir(join(dir, 'pkg/tests'))
      await writeFile(join(dir, 'pkg/foo.mjs'), SAMPLE_SOURCE, 'utf8')
      const lines = []
      for (let i = 0; i < 2001; i++) lines.push(`// line ${i}`)
      lines.push("describe('outer', () => {", "  test('inner', () => {})", '})')
      await writeFile(join(dir, 'pkg/tests/foo.test.mjs'), lines.join('\n'), 'utf8')
      const mutant = { file: 'pkg/foo.mjs', line: 1, col: 1, mutantType: 'X', original: 'a', replacement: 'b' }
      const prompt = buildUserPrompt(mutant, dir)
      expect(prompt).toContain('describe: outer')
      expect(prompt).toContain('test: inner')
      // Повний текст НЕ повинен бути включений
      expect(prompt).not.toContain('// line 1500')
    })
  })

  test('має секцію Recent activity (git або placeholder)', async () => {
    await withTmpDir(async dir => {
      await ensureDir(join(dir, 'pkg'))
      await writeFile(join(dir, 'pkg/foo.mjs'), SAMPLE_SOURCE, 'utf8')
      const mutant = { file: 'pkg/foo.mjs', line: 1, col: 1, mutantType: 'X', original: 'a', replacement: 'b' }
      const prompt = buildUserPrompt(mutant, dir)
      expect(prompt).toContain('# Recent activity')
    })
  })
})
