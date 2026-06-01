/**
 * Тести handler-а `flow spec` (`lib/spec.mjs`). FS — на тимчасовому каталозі;
 * `trace`/`runner` ін'єктуються (без реального trace/субагентів).
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, test } from 'vitest'

import { withTmpDir } from '../../../utils/test-helpers.mjs'
import { spec } from '../spec.mjs'
import { flowStatePath, readState, writeState } from '../state-store.mjs'

const noop = () => {}
const okTrace = () => 0

describe('spec', () => {
  test('без стану → 1', async () => {
    await withTmpDir(async dir => {
      const wt = join(dir, '.worktrees', 'feat-x')
      mkdirSync(wt, { recursive: true })
      expect(await spec([], { cwd: wt, log: noop, trace: okTrace })).toBe(1)
    })
  })

  test('нема spec-doc → 1', async () => {
    await withTmpDir(async dir => {
      const wt = join(dir, '.worktrees', 'feat-x')
      mkdirSync(wt, { recursive: true })
      writeState(flowStatePath(wt), { branch: 'feat/x', status: 'in_progress' })
      expect(await spec([], { cwd: wt, log: noop, trace: okTrace })).toBe(1)
    })
  })

  test('валідний spec-doc → status spec, spec_doc у стані', async () => {
    await withTmpDir(async dir => {
      const wt = join(dir, '.worktrees', 'feat-x')
      mkdirSync(join(wt, 'docs', 'specs'), { recursive: true })
      writeState(flowStatePath(wt), { branch: 'feat/x', status: 'in_progress' })
      const doc = join(wt, 'docs', 'specs', '2026-06-01-feat-x.md')
      writeFileSync(doc, '---\nkind: nitra-spec\nplan: null\n---\n# Дизайн\n')
      const code = await spec([], { cwd: wt, log: noop, trace: okTrace })
      expect(code).toBe(0)
      const s = readState(flowStatePath(wt))
      expect(s.status).toBe('spec')
      expect(s.spec_doc).toBe(doc)
    })
  })

  test('risk зі spec-frontmatter override-ить стан', async () => {
    await withTmpDir(async dir => {
      const wt = join(dir, '.worktrees', 'feat-r')
      mkdirSync(join(wt, 'docs', 'specs'), { recursive: true })
      writeState(flowStatePath(wt), { branch: 'feat/r', status: 'in_progress', risk: 'low' })
      writeFileSync(join(wt, 'docs', 'specs', '2026-06-01-feat-r.md'), '---\nkind: nitra-spec\nrisk: high\n---\n# Дизайн\n')
      await spec([], { cwd: wt, log: noop, trace: okTrace })
      expect(readState(flowStatePath(wt)).risk).toBe('high')
    })
  })

  test('розрив trace → попередження, але код 0', async () => {
    await withTmpDir(async dir => {
      const wt = join(dir, '.worktrees', 'feat-z')
      mkdirSync(join(wt, 'docs', 'specs'), { recursive: true })
      writeState(flowStatePath(wt), { branch: 'feat/z', status: 'in_progress' })
      writeFileSync(join(wt, 'docs', 'specs', '2026-06-01-z.md'), '# Дизайн\n')
      const msgs = []
      const code = await spec([], { cwd: wt, log: m => msgs.push(m), trace: () => 1 })
      expect(code).toBe(0)
      expect(msgs.join('\n')).toMatch(/розрив/i)
    })
  })

  test('--panel із ін\'єктованим runner: синтезує підходи (далі чекає doc)', async () => {
    await withTmpDir(async dir => {
      const wt = join(dir, '.worktrees', 'feat-p')
      mkdirSync(wt, { recursive: true })
      writeState(flowStatePath(wt), { branch: 'feat/p', status: 'in_progress' })
      const runner = { runStep: async () => ({ ok: true, output: '## Підхід A' }) }
      const msgs = []
      const code = await spec(['--panel'], { cwd: wt, runner, log: m => msgs.push(m), trace: okTrace })
      expect(code).toBe(1) // doc ще нема — панель лише підказала
      expect(msgs.join('\n')).toContain('Підхід A')
    })
  })
})
