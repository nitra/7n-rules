/**
 * Тести pi-write-guard (§12 safety-critical): veto-логіка, pre-image snapshot, rollback.
 *   - Core (інжектований root + checkIgnore, реальна tmp-fs для snapshot)
 *   - Integration (справжній git-репо: gitRoot + git check-ignore)
 * Фабрика shape-сумісна з ExtensionAPI: `attach` дістає `tool_call`-хендлер.
 */

import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { createWriteGuard, gitRoot, NEW_FILE } from '../lib/write-guard.mjs'

/**
 * Дістає зареєстрований `tool_call`-хендлер із фабрики (fake pi).
 * @param {object} guard write-guard із `.factory`
 * @returns {(event: object) => void} зареєстрований tool_call-хендлер
 */
function attach(guard) {
  let handler
  guard.factory({
    on: (ev, h) => {
      if (ev === 'tool_call') handler = h
    }
  })
  return handler
}

const edit = path => ({ toolName: 'edit', input: { path } })
const anchored = (path, edits) => ({ toolName: 'edit_anchored', input: { path, edits } })

let dir
beforeEach(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), 'wg-')))
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('veto-логіка (інжектований root + checkIgnore)', () => {
  /**
   * Write-guard на поточну tmp-дир з фейковим checkIgnore (шлях містить "ignored").
   * @returns {object} write-guard
   */
  function guardFor() {
    return createWriteGuard({ cwd: dir, root: dir, checkIgnore: (_r, abs) => abs.includes('ignored') })
  }

  test('запис у tracked-файл під root → allow + pre-image знятий', () => {
    writeFileSync(join(dir, 'src.mjs'), 'OLD')
    const guard = guardFor()
    const h = attach(guard)
    expect(guard.state.attached).toBe(true)
    expect(h(edit('src.mjs'))).toBeUndefined()
    expect(guard.state.preImages.get(join(dir, 'src.mjs'))).toBe('OLD')
  })

  test('edit_anchored (A2) — той самий veto/snapshot, що й built-in edit', () => {
    writeFileSync(join(dir, 'src.mjs'), 'OLD')
    const guard = guardFor()
    const h = attach(guard)
    // allow + pre-image + editLog з anchored-формою правок
    expect(h(anchored('src.mjs', [{ anchor: 'abc', line: 1, newText: 'NEW' }]))).toBeUndefined()
    expect(guard.state.preImages.get(join(dir, 'src.mjs'))).toBe('OLD')
    expect(guard.state.editLog.at(-1)).toMatchObject({ tool: 'edit_anchored', edits: [{ anchor: 'abc', line: 1 }] })
    // veto поза root і на git-ignored — ідентичний built-in
    expect(h(anchored('/etc/passwd', []))).toMatchObject({ block: true })
    expect(h(anchored('ignored/x.mjs', []))).toMatchObject({ block: true })
  })

  test('git-ignored → block, без pre-image', () => {
    const guard = guardFor()
    const h = attach(guard)
    const r = h(edit('ignored.log'))
    expect(r).toMatchObject({ block: true })
    expect(guard.state.preImages.size).toBe(0)
  })

  test('запис поза git-root (..-escape) → block', () => {
    const guard = guardFor()
    expect(attach(guard)(edit('../outside.txt'))).toMatchObject({ block: true })
  })

  test('запис у .git/ → block', () => {
    const guard = guardFor()
    expect(attach(guard)(edit('.git/config'))).toMatchObject({ block: true })
  })

  test('не-write tool (read) ігнорується', () => {
    const guard = guardFor()
    expect(attach(guard)({ toolName: 'read', input: { path: 'src.mjs' } })).toBeUndefined()
    expect(guard.state.preImages.size).toBe(0)
  })

  test('новий файл → pre-image = NEW_FILE', () => {
    const guard = guardFor()
    attach(guard)(edit('brand-new.mjs'))
    expect(guard.state.preImages.get(join(dir, 'brand-new.mjs'))).toBe(NEW_FILE)
  })
})

describe('rollback', () => {
  test('відновлює змінений tracked-файл і видаляє NEW', () => {
    writeFileSync(join(dir, 'keep.mjs'), 'ORIGINAL')
    const guard = createWriteGuard({ cwd: dir, root: dir, checkIgnore: () => false })
    const h = attach(guard)

    h(edit('keep.mjs')) // snapshot ORIGINAL
    h(edit('created.mjs')) // snapshot NEW_FILE
    // агент «застосував» зміни:
    writeFileSync(join(dir, 'keep.mjs'), 'MUTATED')
    writeFileSync(join(dir, 'created.mjs'), 'NEW CONTENT')

    guard.rollback()
    expect(readFileSync(join(dir, 'keep.mjs'), 'utf8')).toBe('ORIGINAL')
    expect(existsSync(join(dir, 'created.mjs'))).toBe(false)
  })

  test('touchedFiles повертає зачеплені шляхи', () => {
    writeFileSync(join(dir, 'a.mjs'), 'a')
    const guard = createWriteGuard({ cwd: dir, root: dir, checkIgnore: () => false })
    const h = attach(guard)
    h(edit('a.mjs'))
    expect(guard.touchedFiles()).toEqual([join(dir, 'a.mjs')])
  })
})

describe('integration: справжній git-репо', () => {
  beforeEach(() => {
    spawnSync('git', ['init', '-q'], { cwd: dir })
    spawnSync('git', ['config', 'user.email', 't@t'], { cwd: dir })
    spawnSync('git', ['config', 'user.name', 't'], { cwd: dir })
    writeFileSync(join(dir, '.gitignore'), 'build/\n*.log\n')
    mkdirSync(join(dir, 'build'), { recursive: true })
    writeFileSync(join(dir, 'src.mjs'), 'OLD')
  })

  test('gitRoot повертає toplevel', () => {
    expect(gitRoot(dir)).toBe(dir)
  })

  test('gitRoot поза git → null', () => {
    const bare = realpathSync(mkdtempSync(join(tmpdir(), 'nogit-')))
    expect(gitRoot(bare)).toBeNull()
    rmSync(bare, { recursive: true, force: true })
  })

  test('реальний git check-ignore блокує build/ і *.log, пускає src.mjs', () => {
    const guard = createWriteGuard({ cwd: dir }) // root обчислюється, реальний check-ignore
    const h = attach(guard)
    expect(h(edit('src.mjs'))).toBeUndefined()
    expect(h(edit('build/out.js'))).toMatchObject({ block: true })
    expect(h(edit('debug.log'))).toMatchObject({ block: true })
  })
})
