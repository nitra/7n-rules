/**
 * Тести `resolveJsRoot`: резолвить JS-root проєкту (workspaces[0] якщо є,
 * інакше cwd; null без кореневого package.json).
 */
import { describe, expect, test } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { resolveAllJsRoots, resolveJsRoot } from '../resolve-js-root.mjs'

/**
 * Створює тимчасовий проєкт із заданими package.json у корені і опційним workspace.
 * @param {object} root0 параметри
 * @param {Record<string, unknown>} [root0.root] вміст root package.json
 * @param {Record<string, unknown>} [root0.workspace] вміст app/package.json
 * @returns {string} шлях до тимчасового каталогу
 */
function makeProj({ root, workspace }) {
  const dir = mkdtempSync(join(tmpdir(), 'resolve-js-root-'))
  if (root) writeFileSync(join(dir, 'package.json'), JSON.stringify(root))
  if (workspace) {
    mkdirSync(join(dir, 'app'), { recursive: true })
    writeFileSync(join(dir, 'app', 'package.json'), JSON.stringify(workspace))
  }
  return dir
}

describe('resolveJsRoot', () => {
  test('single-package — повертає cwd', async () => {
    const dir = makeProj({ root: { name: 'foo' } })
    expect(await resolveJsRoot(dir)).toBe(dir)
    rmSync(dir, { recursive: true, force: true })
  })

  test('workspaces[0] з package.json — повертає workspace', async () => {
    const dir = makeProj({ root: { workspaces: ['app'] }, workspace: { name: 'app' } })
    expect(await resolveJsRoot(dir)).toBe(join(dir, 'app'))
    rmSync(dir, { recursive: true, force: true })
  })

  test('workspaces є, але без package.json у workspaces[0] — fallback на cwd', async () => {
    const dir = makeProj({ root: { workspaces: ['app'] } })
    mkdirSync(join(dir, 'app'), { recursive: true })
    expect(await resolveJsRoot(dir)).toBe(dir)
    rmSync(dir, { recursive: true, force: true })
  })

  test('кореневий package.json відсутній — null', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'resolve-js-root-empty-'))
    expect(await resolveJsRoot(dir)).toBe(null)
    rmSync(dir, { recursive: true, force: true })
  })
})

describe('resolveAllJsRoots', () => {
  test('single-package — повертає [cwd]', async () => {
    const dir = makeProj({ root: { name: 'foo' } })
    expect(await resolveAllJsRoots(dir)).toEqual([dir])
    rmSync(dir, { recursive: true, force: true })
  })

  test('кілька workspaces з package.json — повертає всі', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'resolve-js-roots-multi-'))
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ workspaces: ['app', 'scripts'] }))
    mkdirSync(join(dir, 'app'), { recursive: true })
    mkdirSync(join(dir, 'scripts'), { recursive: true })
    writeFileSync(join(dir, 'app', 'package.json'), JSON.stringify({ name: 'app' }))
    writeFileSync(join(dir, 'scripts', 'package.json'), JSON.stringify({ name: 'scripts' }))
    expect(await resolveAllJsRoots(dir)).toEqual([join(dir, 'app'), join(dir, 'scripts')])
    rmSync(dir, { recursive: true, force: true })
  })

  test('workspace без package.json — пропускається; решта повертається', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'resolve-js-roots-partial-'))
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ workspaces: ['app', 'demo'] }))
    mkdirSync(join(dir, 'app'), { recursive: true })
    mkdirSync(join(dir, 'demo'), { recursive: true })
    writeFileSync(join(dir, 'app', 'package.json'), JSON.stringify({ name: 'app' }))
    // demo/package.json не створено
    expect(await resolveAllJsRoots(dir)).toEqual([join(dir, 'app')])
    rmSync(dir, { recursive: true, force: true })
  })

  test('всі workspaces без package.json — fallback на [cwd]', async () => {
    const dir = makeProj({ root: { workspaces: ['app'] } })
    expect(await resolveAllJsRoots(dir)).toEqual([dir])
    rmSync(dir, { recursive: true, force: true })
  })

  test('кореневий package.json відсутній — []', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'resolve-js-roots-empty-'))
    expect(await resolveAllJsRoots(dir)).toEqual([])
    rmSync(dir, { recursive: true, force: true })
  })
})
