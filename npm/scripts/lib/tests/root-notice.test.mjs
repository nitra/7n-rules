/**
 * Тести `injectRootNotice`: вшивання/видалення root-guard блоку у `SKILL.md`
 * для in-place скілів (`requireRoot:true`, `worktree:false`).
 */
import { describe, expect, test } from 'vitest'

import { ROOT_END, ROOT_START, injectRootNotice } from '../root-notice.mjs'

const SKILL = `---
name: n-taze
---

# n-taze

Тіло скіла.
`

describe('injectRootNotice', () => {
  test('enabled=true → вставляє блок після frontmatter, перед H1', () => {
    const out = injectRootNotice(SKILL, true)
    expect(out).toContain(ROOT_START)
    expect(out).toContain(ROOT_END)
    expect(out.indexOf(ROOT_START)).toBeLessThan(out.indexOf('# n-taze'))
    expect(out.indexOf('name: n-taze')).toBeLessThan(out.indexOf(ROOT_START))
  })

  test('enabled=true → preflight з pwd + toplevel і STOP на піддиректорії', () => {
    const out = injectRootNotice(SKILL, true)
    expect(out).toContain('[!IMPORTANT]')
    expect(out).toContain('pwd')
    expect(out).toContain('git rev-parse --show-toplevel')
    expect(out).toContain('STOP')
    expect(out).toContain('cd <toplevel>')
  })

  test('ідемпотентність: повторний виклик не дублює блок', () => {
    const once = injectRootNotice(SKILL, true)
    const twice = injectRootNotice(once, true)
    expect(twice).toBe(once)
    expect(twice.split(ROOT_START).length - 1).toBe(1)
  })

  test('enabled=false → блоку немає, контент незмінний', () => {
    const out = injectRootNotice(SKILL, false)
    expect(out).not.toContain(ROOT_START)
    expect(out).toBe(SKILL)
  })

  test('enabled=false прибирає наявний блок', () => {
    const withBlock = injectRootNotice(SKILL, true)
    const stripped = injectRootNotice(withBlock, false)
    expect(stripped).not.toContain(ROOT_START)
    expect(stripped).toContain('# n-taze')
    expect(stripped).toContain('name: n-taze')
  })

  test('без frontmatter → блок на початку файла', () => {
    const out = injectRootNotice('# Заголовок\n\nтекст\n', true)
    expect(out.indexOf(ROOT_START)).toBe(0)
    expect(out).toContain('# Заголовок')
  })
})
