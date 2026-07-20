/**
 * Спільний vitest-набір для мосту auto-worktree: той самий поведінковий
 * контракт `bringChangesBackToOriginal`/`removeAutoCreatedWorktree`
 * перевіряється і на прямому імпорті з `scripts/lib/auto-worktree.mjs`
 * (auto-worktree.test.mjs), і на реекспорті зі `skills/taze/js/orchestrate.mjs`
 * (orchestrate.test.mjs) — тіла тестів існують в одному місці.
 */
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'

import { ensureDir, withTmpDir } from '../test-helpers.mjs'

/** Заглушка `log`/`mkdir`/`rm` для тестів, де побічний ефект не перевіряється. */
function noop() {
  /* no-op: цей тест не перевіряє вивід/файлову дію */
}

/**
 * Реєструє describe-блоки контракту повернення змін з worktree в оригінал.
 * @param {object} opts параметри набору
 * @param {typeof import('../../lib/auto-worktree.mjs')['bringChangesBackToOriginal']} opts.bringChangesBackToOriginal функція під тестом (прямий імпорт або реекспорт)
 * @param {typeof import('../../lib/auto-worktree.mjs')['removeAutoCreatedWorktree']} opts.removeAutoCreatedWorktree функція під тестом (прямий імпорт або реекспорт)
 * @param {string} opts.branch назва worktree-гілки у тестах remove (наприклад `main-lint`)
 */
export function describeAutoWorktreeBridge({ bringChangesBackToOriginal, removeAutoCreatedWorktree, branch }) {
  describe('bringChangesBackToOriginal', () => {
    test('порожній git status → нічого не копіює, повертає { brought: [], failed: false }', async () => {
      const copied = []
      const result = await bringChangesBackToOriginal(
        '/wt',
        '/orig',
        () => ({ status: 0, stdout: '', stderr: '' }),
        noop,
        {
          copyFile: (src, dest) => {
            copied.push([src, dest])
            return Promise.resolve()
          },
          mkdir: noop,
          rm: noop
        }
      )
      expect(result).toEqual({ brought: [], failed: false })
      expect(copied).toHaveLength(0)
    })

    test('копіює наявний у worktree файл, видаляє в оригіналі той, якого там уже нема', async () => {
      await withTmpDir(async wtDir => {
        await ensureDir(join(wtDir, 'src'))
        await writeFile(join(wtDir, 'src', 'a.ts'), 'x', 'utf8')

        const copied = []
        const removed = []
        const { brought, failed } = await bringChangesBackToOriginal(
          wtDir,
          '/orig',
          () => ({ status: 0, stdout: ' M src/a.ts\n D src/b.ts\n', stderr: '' }),
          noop,
          {
            copyFile: (src, dest) => {
              copied.push([src, dest])
              return Promise.resolve()
            },
            mkdir: noop,
            rm: path => {
              removed.push(path)
              return Promise.resolve()
            }
          }
        )

        expect(failed).toBe(false)
        expect(brought).toEqual(['src/a.ts', 'src/b.ts'])
        expect(copied).toEqual([[join(wtDir, 'src/a.ts'), join('/orig', 'src/a.ts')]])
        expect(removed).toEqual([join('/orig', 'src/b.ts')])
      })
    })

    test('перейменований файл (`old -> new` у porcelain) — переносить лише нову назву', async () => {
      await withTmpDir(async wtDir => {
        await writeFile(join(wtDir, 'b.ts'), 'x', 'utf8')

        const copied = []
        const { brought, failed } = await bringChangesBackToOriginal(
          wtDir,
          '/orig',
          () => ({ status: 0, stdout: 'R  a.ts -> b.ts\n', stderr: '' }),
          noop,
          {
            copyFile: (src, dest) => {
              copied.push([src, dest])
              return Promise.resolve()
            },
            mkdir: noop,
            rm: noop
          }
        )

        expect(failed).toBe(false)
        expect(brought).toEqual(['b.ts'])
        expect(copied).toEqual([[join(wtDir, 'b.ts'), join('/orig', 'b.ts')]])
      })
    })

    test('git status провалився → лог-попередження, нічого не переносить, failed: true', async () => {
      const logs = []
      const { brought, failed } = await bringChangesBackToOriginal(
        '/wt',
        '/orig',
        () => ({ status: 1, stdout: '', stderr: 'not a git repository' }),
        line => {
          logs.push(line)
        },
        {}
      )
      expect(brought).toEqual([])
      expect(failed).toBe(true)
      expect(logs.some(l => l.includes('НЕ перенесені назад'))).toBe(true)
    })

    test('untracked-директорія цілком (porcelain-рядок з `/` на кінці) — копіює весь вміст рекурсивно', async () => {
      await withTmpDir(async wtDir => {
        await ensureDir(join(wtDir, 'relay', '.changes'))
        await writeFile(join(wtDir, 'relay', '.changes', 'one.md'), '1', 'utf8')
        await writeFile(join(wtDir, 'relay', '.changes', 'two.md'), '2', 'utf8')
        await ensureDir(join(wtDir, 'relay', '.changes', 'nested'))
        await writeFile(join(wtDir, 'relay', '.changes', 'nested', 'three.md'), '3', 'utf8')

        const copied = []
        const dirsMade = []
        const { brought, failed } = await bringChangesBackToOriginal(
          wtDir,
          '/orig',
          () => ({ status: 0, stdout: '?? relay/.changes/\n', stderr: '' }),
          noop,
          {
            copyFile: (src, dest) => {
              copied.push([src, dest])
              return Promise.resolve()
            },
            mkdir: path => {
              dirsMade.push(path)
              return Promise.resolve()
            }
          }
        )

        expect(failed).toBe(false)
        expect(brought.toSorted()).toEqual(
          [
            'relay/.changes/one.md',
            'relay/.changes/two.md',
            join('relay/.changes/nested', 'three.md').replaceAll('\\', '/')
          ].toSorted()
        )
        expect(copied).toHaveLength(3)
        expect(copied).toContainEqual([join(wtDir, 'relay/.changes/one.md'), join('/orig', 'relay/.changes/one.md')])
        expect(dirsMade).toContainEqual(join('/orig', 'relay/.changes/nested'))
      })
    })

    test('провал одного файлу (copyFile кидає) не обриває цикл — далі йдуть далі й failed: true', async () => {
      await withTmpDir(async wtDir => {
        await ensureDir(join(wtDir, 'src'))
        await writeFile(join(wtDir, 'src', 'a.ts'), 'x', 'utf8')
        await writeFile(join(wtDir, 'src', 'b.ts'), 'y', 'utf8')

        const copied = []
        const logs = []
        const { brought, failed } = await bringChangesBackToOriginal(
          wtDir,
          '/orig',
          () => ({ status: 0, stdout: ' M src/a.ts\n M src/b.ts\n', stderr: '' }),
          line => {
            logs.push(line)
          },
          {
            copyFile: (src, dest) => {
              if (src.endsWith('a.ts')) return Promise.reject(new Error('ENOENT boom'))
              copied.push([src, dest])
              return Promise.resolve()
            },
            mkdir: noop
          }
        )

        expect(failed).toBe(true)
        expect(brought).toEqual(['src/b.ts'])
        expect(copied).toHaveLength(1)
        expect(logs.some(l => l.includes('src/a.ts'))).toBe(true)
      })
    })
  })

  describe('removeAutoCreatedWorktree', () => {
    test('викликає npx @7n/mt worktree remove <branch> з cwd=originalCwd', () => {
      const calls = []
      removeAutoCreatedWorktree(
        branch,
        '/orig',
        (cmd, args, opts) => {
          calls.push({ cmd, args, opts })
          return { status: 0, stdout: '', stderr: '' }
        },
        noop
      )
      expect(calls).toEqual([
        { cmd: 'npx', args: ['@7n/mt', 'worktree', 'remove', branch], opts: { cwd: '/orig', encoding: 'utf8' } }
      ])
    })

    test('провал команди не кидає — лише логує попередження', () => {
      const logs = []
      expect(() =>
        removeAutoCreatedWorktree(
          branch,
          '/orig',
          () => ({ status: 1, stdout: '', stderr: 'busy' }),
          line => {
            logs.push(line)
          }
        )
      ).not.toThrow()
      expect(logs.some(l => l.includes('Не вдалось прибрати'))).toBe(true)
    })
  })
}
