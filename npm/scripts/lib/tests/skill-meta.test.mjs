import { describe, expect, test } from 'vitest'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { SKILL_ALWAYS, parseSkillAutoSpec, readSkillMetaRaw } from '../skill-meta.mjs'
import { withTmpDir, writeJson } from '../../utils/test-helpers.mjs'

describe('parseSkillAutoSpec', () => {
  test('"завжди" → { always: true }', () => {
    expect(parseSkillAutoSpec(SKILL_ALWAYS)).toEqual({ always: true })
  })

  test('масив правил → { rules }', () => {
    expect(parseSkillAutoSpec(['adr'])).toEqual({ rules: ['adr'] })
    expect(parseSkillAutoSpec(['vue', 'image-compress'])).toEqual({ rules: ['vue', 'image-compress'] })
  })

  test('trim і відсів порожніх у масиві', () => {
    expect(parseSkillAutoSpec([' bun ', ''])).toEqual({ rules: ['bun'] })
  })

  test('порожній масив → null', () => {
    expect(parseSkillAutoSpec([])).toBeNull()
  })

  test('undefined / невідоме значення → null', () => {
    expect(parseSkillAutoSpec(undefined)).toBeNull()
    expect(parseSkillAutoSpec('always')).toBeNull()
    expect(parseSkillAutoSpec(42)).toBeNull()
  })
})

describe('readSkillMetaRaw', () => {
  test('валідний meta.json → обʼєкт', async () => {
    await withTmpDir(async dir => {
      await writeJson(join(dir, 'meta.json'), { auto: 'завжди', worktree: true })
      expect(readSkillMetaRaw(dir)).toEqual({ auto: 'завжди', worktree: true })
    })
  })

  test('відсутній meta.json → null', async () => {
    await withTmpDir(async dir => {
      expect(readSkillMetaRaw(dir)).toBeNull()
    })
  })

  test('невалідний JSON → null (не кидає)', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'meta.json'), 'NOT JSON{{{', 'utf8')
      expect(readSkillMetaRaw(dir)).toBeNull()
    })
  })

  test('масив на верхньому рівні → null', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'meta.json'), '[1,2]', 'utf8')
      expect(readSkillMetaRaw(dir)).toBeNull()
    })
  })
})
