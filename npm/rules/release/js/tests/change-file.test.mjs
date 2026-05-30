import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { describe, expect, test } from 'vitest'

import { changeFileName, readChangeFiles, parseChangeFile, serializeChangeFile, VALID_BUMPS, VALID_SECTIONS } from '../../lib/change-file.mjs'
import { withTmpDir } from '../../../../scripts/utils/test-helpers.mjs'

const RE_ОПИС = /опис/u
const RE_BUMP = /bump/u
const RE_SECTION = /section/u
const RE_FRONTMATTER = /frontmatter/u

describe('parseChangeFile', () => {
  test('парсить валідний frontmatter + опис', () => {
    const text = '---\nbump: minor\nsection: Added\n---\nДодав підтримку X\n'
    expect(parseChangeFile(text)).toEqual({ bump: 'minor', section: 'Added', description: 'Додав підтримку X' })
  })

  test('обрізає зайві пробіли в описі та кидає на порожньому описі', () => {
    const text = '---\nbump: patch\nsection: Fixed\n---\n\n  Виправив Y  \n\n'
    expect(parseChangeFile(text).description).toBe('Виправив Y')
    expect(() => parseChangeFile('---\nbump: patch\nsection: Fixed\n---\n   \n')).toThrow(RE_ОПИС)
  })

  test('кидає на невалідному bump/section та без frontmatter', () => {
    expect(() => parseChangeFile('---\nbump: huge\nsection: Added\n---\nx')).toThrow(RE_BUMP)
    expect(() => parseChangeFile('---\nbump: patch\nsection: Nope\n---\nx')).toThrow(RE_SECTION)
    expect(() => parseChangeFile('просто текст')).toThrow(RE_FRONTMATTER)
  })

  test('VALID_* — очікувані множини', () => {
    expect(VALID_BUMPS).toEqual(['major', 'minor', 'patch'])
    expect(VALID_SECTIONS).toEqual(['Added', 'Changed', 'Fixed', 'Removed'])
  })
})

describe('serializeChangeFile', () => {
  test('round-trip із parseChangeFile', () => {
    const entry = { bump: 'major', section: 'Removed', description: 'Прибрав Z' }
    expect(parseChangeFile(serializeChangeFile(entry))).toEqual(entry)
  })
})

describe('changeFileName', () => {
  test('формат <timestamp>-<rand>.md, детермінований за входами', () => {
    expect(changeFileName(1748505600000, 'a1b2c3')).toBe('1748505600000-a1b2c3.md')
  })
})

describe('readChangeFiles', () => {
  test('зчитує всі .md з <ws>/.changes, ігнорує не-.md, повертає {file, entry}', async () => {
    await withTmpDir(async dir => {
      const changesDir = join(dir, 'pkg', '.changes')
      await mkdir(changesDir, { recursive: true })
      await writeFile(join(changesDir, '1-aaa.md'), '---\nbump: patch\nsection: Fixed\n---\nA\n')
      await writeFile(join(changesDir, '2-bbb.md'), '---\nbump: minor\nsection: Added\n---\nB\n')
      await writeFile(join(changesDir, 'README.txt'), 'ignore me')

      const result = await readChangeFiles('pkg', dir)
      expect(result.map(r => r.entry.description).toSorted()).toEqual(['A', 'B'])
      expect(result.every(r => r.file.endsWith('.md'))).toBe(true)
    })
  })

  test('відсутній .changes → порожній масив', async () => {
    await withTmpDir(async dir => {
      expect(await readChangeFiles('pkg', dir)).toEqual([])
    })
  })
})
