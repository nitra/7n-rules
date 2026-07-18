/**
 * Тести фрагментів SKILL.md від плагінів: збір конвенційних
 * `skills/<id>/SKILL.fragment.md`, ідемпотентне вшивання/заміна/прибирання
 * блоку між маркерами.
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'

import { withTmpDir } from '../../utils/test-helpers.mjs'
import { collectSkillFragments, FRAGMENTS_END, FRAGMENTS_START, injectSkillFragments } from '../skill-fragments.mjs'

const BASE = '---\nname: taze\n---\n\n# taze\n\nОсновний текст.\n'

describe('collectSkillFragments', () => {
  test('збирає фрагменти активних плагінів у порядку списку', async () => {
    await withTmpDir(async dir => {
      const a = join(dir, 'plug-a')
      const b = join(dir, 'plug-b')
      await mkdir(join(a, 'skills', 'taze'), { recursive: true })
      await writeFile(join(a, 'skills', 'taze', 'SKILL.fragment.md'), '## Rust-гілка\n\nтекст A\n')
      await mkdir(join(b, 'skills', 'other'), { recursive: true })

      const fragments = collectSkillFragments('taze', [
        { name: '@x/a', packageRoot: a },
        { name: '@x/b', packageRoot: b }
      ])
      expect(fragments).toEqual([{ pluginName: '@x/a', content: '## Rust-гілка\n\nтекст A' }])
    })
  })

  test('порожній фрагмент — ігнорується', async () => {
    await withTmpDir(async dir => {
      await mkdir(join(dir, 'skills', 'taze'), { recursive: true })
      await writeFile(join(dir, 'skills', 'taze', 'SKILL.fragment.md'), '\n  \n')
      expect(collectSkillFragments('taze', [{ name: '@x/a', packageRoot: dir }])).toEqual([])
    })
  })
})

describe('injectSkillFragments', () => {
  test('доклеює блок у кінець з маркерами плагінів', () => {
    const out = injectSkillFragments(BASE, [{ pluginName: '@x/a', content: '## Rust-гілка\n\nтекст' }])
    expect(out).toContain(FRAGMENTS_START)
    expect(out).toContain('<!-- n-rules:plugin:@x/a:start -->')
    expect(out).toContain('## Rust-гілка')
    expect(out.trimEnd().endsWith(FRAGMENTS_END)).toBe(true)
  })

  test('ре-синк ідемпотентний: блок замінюється, не дублюється', () => {
    const first = injectSkillFragments(BASE, [{ pluginName: '@x/a', content: 'стара версія' }])
    const second = injectSkillFragments(first, [{ pluginName: '@x/a', content: 'нова версія' }])
    expect(second).not.toContain('стара версія')
    expect(second).toContain('нова версія')
    expect(second.split(FRAGMENTS_START)).toHaveLength(2)
  })

  test('без фрагментів — наявний блок прибирається', () => {
    const withBlock = injectSkillFragments(BASE, [{ pluginName: '@x/a', content: 'текст' }])
    const out = injectSkillFragments(withBlock, [])
    expect(out).not.toContain(FRAGMENTS_START)
    expect(out.trimEnd().endsWith('Основний текст.')).toBe(true)
  })

  test('без фрагментів і без блоку — текст не змінюється', () => {
    expect(injectSkillFragments(BASE, [])).toBe(BASE)
  })
})
