/**
 * Тести фрагментів SKILL.md від плагінів: збір `skills.fragment@1` contributions зі slot
 * graph (Фаза 2 — slot bus), ідемпотентне вшивання/заміна/прибирання блоку між маркерами.
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'

import { withTmpDir } from '../../utils/test-helpers.mjs'
import { clearSlotResolveCache, resolveSlotGraph } from '../plugin-slots.mjs'
import { clearPluginResolveCache } from '../resolve-plugins.mjs'
import { collectSkillFragments, FRAGMENTS_END, FRAGMENTS_START, injectSkillFragments } from '../skill-fragments.mjs'

const BASE = '---\nname: taze\n---\n\n# taze\n\nОсновний текст.\n'

afterEach(() => {
  clearSlotResolveCache()
  clearPluginResolveCache()
})

/**
 * Ставить у tmp-репо фейковий плагін API v2 з `skills.fragment@1` contribution.
 * @param {string} dir корінь tmp-репо
 * @param {string} name npm-ім'я плагіна
 * @param {{ skillId?: string, content?: string | null }} [opts] `content: null` — без ресурсу взагалі
 * @returns {Promise<void>}
 */
async function writeFakeFragmentPlugin(dir, name, { skillId = 'taze', content = '## Rust-гілка\n\nтекст A\n' } = {}) {
  const packageRoot = join(dir, 'node_modules', name)
  await mkdir(packageRoot, { recursive: true })
  const provides =
    content === null
      ? []
      : [{ slot: 'skills.fragment', version: 1, id: skillId, resource: `./skills/${skillId}/SKILL.fragment.md` }]
  await writeFile(
    join(packageRoot, 'package.json'),
    JSON.stringify({
      name,
      version: '1.0.0',
      'n-rules': { requiresPluginApi: 2, contributes: { rules: false }, slots: { provides } }
    })
  )
  if (content !== null) {
    await mkdir(join(packageRoot, 'skills', skillId), { recursive: true })
    await writeFile(join(packageRoot, 'skills', skillId, 'SKILL.fragment.md'), content)
  }
}

describe('collectSkillFragments', () => {
  test('збирає фрагменти активних плагінів у порядку графа', async () => {
    await withTmpDir(async dir => {
      await writeFakeFragmentPlugin(dir, '@x/a', { content: '## Rust-гілка\n\nтекст A\n' })
      await writeFakeFragmentPlugin(dir, '@x/b', { skillId: 'other', content: 'інший скіл' })
      const graph = resolveSlotGraph(dir, { plugins: ['@x/a', '@x/b'] }, { allowInstall: false, quiet: true })
      expect(collectSkillFragments('taze', graph)).toEqual([
        { pluginName: '@x/a', content: '## Rust-гілка\n\nтекст A' }
      ])
    })
  })

  test('порожній фрагмент — ігнорується', async () => {
    await withTmpDir(async dir => {
      await writeFakeFragmentPlugin(dir, '@x/a', { content: '\n  \n' })
      const graph = resolveSlotGraph(dir, { plugins: ['@x/a'] }, { allowInstall: false, quiet: true })
      expect(collectSkillFragments('taze', graph)).toEqual([])
    })
  })

  test('плагін без жодного skills.fragment contribution — не впливає на результат', async () => {
    await withTmpDir(async dir => {
      await writeFakeFragmentPlugin(dir, '@x/a', { content: null })
      const graph = resolveSlotGraph(dir, { plugins: ['@x/a'] }, { allowInstall: false, quiet: true })
      expect(collectSkillFragments('taze', graph)).toEqual([])
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
