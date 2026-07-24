/**
 * Регрес: `toViolation` має віддавати posix-relative шлях без ".." навіть коли
 * `process.cwd()` (worktree auto-create не робить chdir) відрізняється від `ctx.cwd`
 * і finding.file — відносний (oxlint `--format=json`, на відміну від eslint API,
 * що завжди дає абсолютний filePath). `cwd` тут — навмисно НЕ `process.cwd()`
 * (тестовий процес запускається з кореня репо) — саме ця розбіжність і відтворює баг.
 *
 * `lint()` мокає зовнішні тули (ESLint API, oxlint-спавн, git-diff) — реальний прогін
 * зав'язаний на конфіг репо й перевірений вручну + e2e (`js/eslint.mdc`).
 */
import { describe, expect, test, vi } from 'vitest'

const lintFilesMock = vi.fn()
vi.mock('eslint', () => ({
  ESLint: class {
    lintFiles(...args) {
      return lintFilesMock(...args)
    }
  }
}))

const spawnAsyncMock = vi.fn()
vi.mock('@7n/rules/scripts/utils/spawn-async.mjs', () => ({ spawnAsync: spawnAsyncMock }))

const addedLinesByFileMock = vi.fn()
vi.mock('@7n/rules/scripts/lib/diff-added-lines.mjs', async importOriginal => {
  const actual = await importOriginal()
  return { ...actual, addedLinesByFile: addedLinesByFileMock }
})

const { filterJsFiles, lint, toViolation } = await import('../main.mjs')

describe('toViolation', () => {
  test('відносний finding.file (oxlint-стиль) → relative без "..", навіть коли process.cwd() ≠ cwd', () => {
    const cwd = '/root/.worktrees/some-branch-lint'
    const v = toViolation(
      { file: 'run/export-table/src/a.mjs', line: 1, rule: 'x', message: 'm', tool: 'oxlint' },
      cwd,
      'error'
    )
    expect(v.file).toBe('run/export-table/src/a.mjs')
    expect(v.file.split('/')).not.toContain('..')
  })

  test('абсолютний finding.file (eslint API) → relative проти cwd', () => {
    const cwd = '/root/.worktrees/some-branch-lint'
    const v = toViolation(
      { file: '/root/.worktrees/some-branch-lint/run/a.mjs', line: 1, rule: 'x', message: 'm', tool: 'eslint' },
      cwd,
      'error'
    )
    expect(v.file).toBe('run/a.mjs')
  })
})

describe('filterJsFiles', () => {
  test('лишає лише js-подібні розширення', () => {
    expect(filterJsFiles(['a.mjs', 'b.rs', 'c.vue', 'd.md', 'e.ts'])).toEqual(['a.mjs', 'c.vue', 'e.ts'])
  })

  test('порожній вхід → порожній вихід', () => {
    expect(filterJsFiles([])).toEqual([])
  })
})

describe('lint', () => {
  test('files === undefined → whole-project, oxlint + eslint через relative(cwd, resolve(cwd, …))', async () => {
    lintFilesMock.mockResolvedValueOnce([
      { filePath: '/root/proj/src/a.mjs', messages: [{ line: 3, ruleId: 'no-unused-vars', message: 'x' }] }
    ])
    spawnAsyncMock.mockResolvedValueOnce({
      exitCode: 0,
      stdout: JSON.stringify({
        diagnostics: [
          {
            filename: 'src/b.mjs',
            labels: [{ span: { line: 5 } }],
            code: 'eslint(no-unused-vars)',
            message: 'y'
          }
        ]
      }),
      stderr: ''
    })

    const result = await lint({ cwd: '/root/proj', files: undefined })

    expect(result.violations).toHaveLength(2)
    expect(result.violations.map(v => v.file).toSorted()).toEqual(['src/a.mjs', 'src/b.mjs'])
    expect(result.violations.every(v => v.severity === 'error')).toBe(true)
  })

  test('files=[] → без виклику лінтерів, порожній результат', async () => {
    lintFilesMock.mockClear()
    spawnAsyncMock.mockClear()
    const result = await lint({ cwd: '/root/proj', files: [] })
    expect(result).toEqual({ violations: [] })
    expect(lintFilesMock).not.toHaveBeenCalled()
    expect(spawnAsyncMock).not.toHaveBeenCalled()
  })

  test('per-file: introduced (added lines) → error, pre-existing → warn', async () => {
    lintFilesMock.mockResolvedValueOnce([
      {
        filePath: '/root/proj/src/a.mjs',
        messages: [
          { line: 1, ruleId: 'new-rule', message: 'introduced' },
          { line: 99, ruleId: 'old-rule', message: 'pre-existing' }
        ]
      }
    ])
    spawnAsyncMock.mockResolvedValueOnce({ exitCode: 0, stdout: '{"diagnostics":[]}', stderr: '' })
    addedLinesByFileMock.mockReturnValueOnce(new Map([['src/a.mjs', new Set([1])]]))

    const result = await lint({ cwd: '/root/proj', files: ['src/a.mjs'] })

    expect(result.violations).toHaveLength(2)
    const introduced = result.violations.find(v => v.reason === 'new-rule')
    const preExisting = result.violations.find(v => v.reason === 'old-rule')
    expect(introduced.severity).toBe('error')
    expect(preExisting.severity).toBe('warn')
  })
})
