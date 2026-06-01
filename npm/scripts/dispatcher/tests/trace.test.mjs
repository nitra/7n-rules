/**
 * Тести `n-cursor trace` (`dispatcher/trace.mjs`, spec §5.4/§7). FS ін'єктується.
 */
import { describe, expect, test } from 'vitest'

import { analyze, parseFrontMatter, render, runTraceCli } from '../trace.mjs'

describe('parseFrontMatter', () => {
  test('плаский front-matter + відрізає інлайн-коментар', () => {
    const fm = parseFrontMatter('---\nid: x\nstatus: planned   # коментар\nplan: docs/plans/a.md\n---\nтіло')
    expect(fm).toEqual({ id: 'x', status: 'planned', plan: 'docs/plans/a.md' })
  })
  test('null-значення', () => {
    expect(parseFrontMatter('---\nadr: null\n---')).toEqual({ adr: null })
  })
  test('без front-matter → null', () => {
    expect(parseFrontMatter('# просто заголовок')).toBe(null)
  })
  test('незакритий front-matter → null', () => {
    expect(parseFrontMatter('---\nid: x')).toBe(null)
  })
})

describe('analyze', () => {
  test('лінки зі статусом ok/розрив', () => {
    const artifacts = [{ file: 'docs/specs/a.md', fm: { kind: 'nitra-spec', id: 'x', status: 'planned', plan: 'docs/plans/a.md', adr: 'docs/adr/missing.md' } }]
    const a = analyze(artifacts, t => t === 'docs/plans/a.md')
    expect(a[0].links).toEqual([
      { field: 'adr', target: 'docs/adr/missing.md', ok: false },
      { field: 'plan', target: 'docs/plans/a.md', ok: true }
    ])
  })
  test('лінк flow аналізується як ланка ланцюга', () => {
    const a = analyze([{ file: 'docs/plans/p.md', fm: { kind: 'nitra-plan', flow: '../../.worktrees/x.flow.json' } }], () => false)
    expect(a[0].links.find(l => l.field === 'flow')).toEqual({
      field: 'flow',
      target: '../../.worktrees/x.flow.json',
      ok: false
    })
  })
})

describe('render', () => {
  test('→ для ok, ✗ для розриву', () => {
    const out = render([{ file: 'f', kind: 'nitra-spec', id: 'x', status: 'planned', links: [{ field: 'plan', target: 'p', ok: false }] }])
    expect(out).toContain('nitra-spec · x [planned]')
    expect(out).toContain('✗ plan: p')
  })
  test('порожньо → повідомлення', () => {
    expect(render([])).toContain('не знайдено')
  })
})

describe('runTraceCli', () => {
  const base = {
    cwd: '/root',
    readFile: () => '---\nkind: nitra-spec\nid: x\nstatus: planned\nplan: docs/plans/a.md\n---',
    readdir: dir => (dir.endsWith('docs/specs') ? ['a-design.md'] : []),
    log: () => {}
  }

  test('цілий ланцюг → exit 0', () => {
    expect(runTraceCli([], { ...base, exists: t => t === '/root/docs/plans/a.md' })).toBe(0)
  })

  test('розрив лінка → exit 1', () => {
    expect(runTraceCli([], { ...base, exists: () => false })).toBe(1)
  })

  test('--json → валідний JSON у лог', () => {
    let out = ''
    runTraceCli(['--json'], { ...base, exists: () => true, log: m => (out = m) })
    expect(JSON.parse(out)[0].id).toBe('x')
  })
})
