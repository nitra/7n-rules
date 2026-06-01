/**
 * Тести `syncGitignoreWorktree`: гарантія рядка `.worktrees/` у кореневому
 * `.gitignore` під час sync (idempotent, append-only, без видалення наявного).
 */
import { describe, expect, test } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { syncGitignoreWorktree } from '../sync-gitignore-worktree.mjs'

/**
 * Кількість входжень підрядка у тексті.
 * @param {string} text текст для пошуку
 * @param {string} patt підрядок
 * @returns {number} кількість входжень
 */
function count(text, patt) {
  return text.split(patt).length - 1
}

describe('syncGitignoreWorktree', () => {
  test('свіже репо без .gitignore → written:true і додає .worktrees/', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'wt-gitignore-create-'))
    const { written } = await syncGitignoreWorktree(dir)
    expect(written).toBe(true)
    const content = readFileSync(join(dir, '.gitignore'), 'utf8')
    expect(content).toContain('.worktrees/')
    rmSync(dir, { recursive: true, force: true })
  })

  test('idempotent — повторний виклик written:false і не дублює рядок', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'wt-gitignore-idem-'))
    await syncGitignoreWorktree(dir)
    const { written } = await syncGitignoreWorktree(dir)
    expect(written).toBe(false)
    const content = readFileSync(join(dir, '.gitignore'), 'utf8')
    expect(count(content, '.worktrees/')).toBe(1)
    rmSync(dir, { recursive: true, force: true })
  })

  test('append-only — зберігає наявний кастомний .gitignore', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'wt-gitignore-append-'))
    writeFileSync(join(dir, '.gitignore'), 'node_modules/\ndist/\n')
    const { written } = await syncGitignoreWorktree(dir)
    expect(written).toBe(true)
    const content = readFileSync(join(dir, '.gitignore'), 'utf8')
    expect(content).toContain('node_modules/')
    expect(content).toContain('dist/')
    expect(content).toContain('.worktrees/')
    rmSync(dir, { recursive: true, force: true })
  })

  test('no-op коли .worktrees/ уже присутній → written:false', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'wt-gitignore-present-'))
    writeFileSync(join(dir, '.gitignore'), 'node_modules/\n.worktrees/\n')
    const { written } = await syncGitignoreWorktree(dir)
    expect(written).toBe(false)
    rmSync(dir, { recursive: true, force: true })
  })
})
