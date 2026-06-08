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
  test('chain-лінки зі статусом ok/розрив + breaking', () => {
    const artifacts = [
      {
        file: 'docs/specs/a.md',
        fm: { kind: 'nitra-spec', id: 'x', status: 'planned', plan: 'docs/plans/a.md', adr: 'docs/adr/missing.md' }
      }
    ]
    const a = analyze(artifacts, t => t === 'docs/plans/a.md')
    expect(a[0].links).toEqual([
      { field: 'adr', target: 'docs/adr/missing.md', ok: false, breaking: true },
      { field: 'plan', target: 'docs/plans/a.md', ok: true, breaking: true }
    ])
  })
  test('лінк flow — інформаційний (breaking:false), навіть коли не резолвиться', () => {
    const a = analyze(
      [{ file: 'docs/plans/p.md', fm: { kind: 'nitra-plan', flow: '../../.worktrees/x.flow.json' } }],
      () => false
    )
    expect(a[0].links.find(l => l.field === 'flow')).toEqual({
      field: 'flow',
      target: '../../.worktrees/x.flow.json',
      ok: false,
      breaking: false
    })
  })
  test('resolve отримує (target, artifactFile)', () => {
    const seen = []
    analyze([{ file: 'docs/plans/p.md', fm: { spec: '../specs/s.md' } }], (t, file) => {
      seen.push([t, file])
      return true
    })
    expect(seen).toEqual([['../specs/s.md', 'docs/plans/p.md']])
  })
})

describe('render', () => {
  test('→ для ok, ✗ для chain-розриву', () => {
    const out = render([
      {
        file: 'f',
        kind: 'nitra-spec',
        id: 'x',
        status: 'planned',
        links: [{ field: 'plan', target: 'p', ok: false, breaking: true }]
      }
    ])
    expect(out).toContain('nitra-spec · x [planned]')
    expect(out).toContain('✗ plan: p')
  })
  test('~ для нерезолвленого info-поля (flow), не ✗', () => {
    const out = render([
      {
        file: 'f',
        kind: 'nitra-plan',
        id: 'p',
        status: 'planned',
        links: [{ field: 'flow', target: 'rt.json', ok: false, breaking: false }]
      }
    ])
    expect(out).toContain('~ flow: rt.json')
    expect(out).not.toContain('✗')
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
    log: () => { /* noop */ }
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

  test('file-relative лінк (../plans/) резолвиться відносно артефакту → exit 0', () => {
    const deps = {
      cwd: '/root',
      readFile: () => '---\nkind: nitra-spec\nid: x\nstatus: planned\nplan: ../plans/a.md\n---',
      readdir: dir => (dir.endsWith('docs/specs') ? ['a-design.md'] : []),
      log: () => { /* noop */ },
      // лінк існує лише за резолвом відносно теки артефакту (docs/specs/ + ../plans/ = docs/plans/)
      exists: t => t === '/root/docs/plans/a.md'
    }
    expect(runTraceCli([], deps)).toBe(0)
  })

  test('лише flow не резолвиться → НЕ розрив, exit 0', () => {
    const deps = {
      cwd: '/root',
      readFile: () => '---\nkind: nitra-plan\nid: p\nstatus: planned\nflow: ../../.worktrees/x.flow.json\n---',
      readdir: dir => (dir.endsWith('docs/plans') ? ['p.md'] : []),
      log: () => { /* noop */ },
      exists: () => false
    }
    expect(runTraceCli([], deps)).toBe(0)
  })

  test('chain-поле (spec) не резолвиться → розрив, exit 1', () => {
    const deps = {
      cwd: '/root',
      readFile: () => '---\nkind: nitra-plan\nid: p\nstatus: planned\nspec: ../specs/missing.md\n---',
      readdir: dir => (dir.endsWith('docs/plans') ? ['p.md'] : []),
      log: () => { /* noop */ },
      exists: () => false
    }
    expect(runTraceCli([], deps)).toBe(1)
  })
})
