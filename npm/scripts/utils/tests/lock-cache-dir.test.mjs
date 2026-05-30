import { describe, expect, it } from 'vitest'
import { join } from 'node:path'
import { resolveLockCacheDir } from '../lock-cache-dir.mjs'

/**
 * Будує spawnSync-стаб, що повертає успішний git із заданим stdout.
 * @param {string} stdout вміст stdout, який поверне git-команда
 * @returns {() => {status: 0, stdout: string, error: undefined}} стаб spawnSync для resolveLockCacheDir
 */
const gitOk = stdout => () => ({ status: 0, stdout, error: undefined })
/**
 * spawnSync-стаб, що імітує не-git-репо (ненульовий статус).
 * @returns {{status: 128, stdout: string, error: undefined}} результат failing git invocation
 */
const gitFail = () => ({ status: 128, stdout: '', error: undefined })

describe('resolveLockCacheDir', () => {
  it('кладе стан під git-common-dir (відносний .git → абсолютний від cwd)', () => {
    const dir = resolveLockCacheDir('lint-ga', { cwd: '/repo', spawn: gitOk('.git\n') })
    expect(dir).toBe(join('/repo/.git', 'n-cursor', 'lint-ga'))
  })

  it('використовує абсолютний git-common-dir з linked-worktree', () => {
    const dir = resolveLockCacheDir('lint-ga', { cwd: '/repo/.wt/feat', spawn: gitOk('/repo/.git\n') })
    expect(dir).toBe(join('/repo/.git', 'n-cursor', 'lint-ga'))
  })

  it('той самий ключ із головного checkout і worktree → той самий шлях (крос-worktree mutex)', () => {
    const main = resolveLockCacheDir('fix-bun', { cwd: '/repo', spawn: gitOk('/repo/.git\n') })
    const wt = resolveLockCacheDir('fix-bun', { cwd: '/repo/.wt/x', spawn: gitOk('/repo/.git\n') })
    expect(main).toBe(wt)
  })

  it('fallback на node_modules/.cache поза git-репо (ненульовий статус)', () => {
    const dir = resolveLockCacheDir('lint-ga', { cwd: '/tmp/x', spawn: gitFail })
    expect(dir).toBe(join('/tmp/x', 'node_modules/.cache/n-cursor', 'lint-ga'))
  })

  it('fallback коли git недоступний (spawn кидає error)', () => {
    const dir = resolveLockCacheDir('lint-ga', {
      cwd: '/tmp/x',
      spawn: () => ({ status: null, stdout: '', error: new Error('ENOENT') })
    })
    expect(dir).toBe(join('/tmp/x', 'node_modules/.cache/n-cursor', 'lint-ga'))
  })
})
