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
    test('порожній git status → нічого не копіює, повертає []', async () => {
      const copied = []
      const brought = await bringChangesBackToOriginal(
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
      expect(brought).toEqual([])
      expect(copied).toHaveLength(0)
    })

    test('копіює наявний у worktree файл, видаляє в оригіналі той, якого там уже нема', async () => {
      await withTmpDir(async wtDir => {
        await ensureDir(join(wtDir, 'src'))
        await writeFile(join(wtDir, 'src', 'a.ts'), 'x', 'utf8')

        const copied = []
        const removed = []
        const brought = await bringChangesBackToOriginal(
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

        expect(brought).toEqual(['src/a.ts', 'src/b.ts'])
        expect(copied).toEqual([[join(wtDir, 'src/a.ts'), join('/orig', 'src/a.ts')]])
        expect(removed).toEqual([join('/orig', 'src/b.ts')])
      })
    })

    test('перейменований файл (`old -> new` у porcelain) — переносить лише нову назву', async () => {
      await withTmpDir(async wtDir => {
        await writeFile(join(wtDir, 'b.ts'), 'x', 'utf8')

        const copied = []
        const brought = await bringChangesBackToOriginal(
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

        expect(brought).toEqual(['b.ts'])
        expect(copied).toEqual([[join(wtDir, 'b.ts'), join('/orig', 'b.ts')]])
      })
    })

    test('git status провалився → лог-попередження, нічого не переносить', async () => {
      const logs = []
      const brought = await bringChangesBackToOriginal(
        '/wt',
        '/orig',
        () => ({ status: 1, stdout: '', stderr: 'not a git repository' }),
        line => {
          logs.push(line)
        },
        {}
      )
      expect(brought).toEqual([])
      expect(logs.some(l => l.includes('НЕ перенесені назад'))).toBe(true)
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
