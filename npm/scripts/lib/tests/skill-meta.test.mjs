import { describe, expect, test } from 'vitest'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { SKILL_ALWAYS, parseSkillAutoSpec, readSkillMetaRaw, skillRequiresRoot } from '../skill-meta.mjs'
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
    expect(parseSkillAutoSpec()).toBeNull()
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
    await withTmpDir(dir => {
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

describe('skillRequiresRoot', () => {
  test('worktree:true → true (корінь неявно через worktree)', () => {
    expect(skillRequiresRoot({ worktree: true })).toBe(true)
  })

  test('requireRoot:true без worktree → true', () => {
    expect(skillRequiresRoot({ worktree: false, requireRoot: true })).toBe(true)
  })

  test('worktree:false без requireRoot → false', () => {
    expect(skillRequiresRoot({ worktree: false })).toBe(false)
    expect(skillRequiresRoot({ worktree: false, requireRoot: false })).toBe(false)
  })

  test('null / порожнє → false', () => {
    expect(skillRequiresRoot(null)).toBe(false)
    expect(skillRequiresRoot({})).toBe(false)
  })
})
