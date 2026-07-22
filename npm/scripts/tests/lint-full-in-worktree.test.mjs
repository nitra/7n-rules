/**
 * Регресія: `n-rules lint --full` усередині `.worktrees/` крашився з
 * `TypeError [ERR_INVALID_ARG_TYPE]` (paths[0] undefined) через загублений
 * `await` перед `ensureRunningInWorktree(...)` у `case 'lint'` (bin/n-rules.js) —
 * `worktree` лишався Promise, `worktree.cwd` резолвився в undefined ще до
 * fast-path перевірки «вже в .worktrees/» (сама перевірка всередині функції,
 * тож бага ловила навіть fast-path, без реального auto-create).
 *
 * `case 'lint'` виконується inline у CLI-скрипті на top-level виконанні
 * (не експортована функція, на відміну від `runReleaseCli`/`runCiPlanCli` для
 * інших команд) — точковий unit-тест виклику неможливий без рефакторингу,
 * тож перевіряємо subprocess-ом: реальний `node bin/n-rules.js` у fixture-репо
 * під `.worktrees/`, з мінімальним `--rules changelog` (дешевий концерн, щоб
 * прогін лишався швидким).
 *
 * `--full` бере машинний лок у `os.tmpdir()/n-rules/lint-full` (lint-lock.mjs) —
 * спільний для всієї машини. У повному прогоні test suite інші test-файли можуть
 * паралельно виконувати власні `--full`-подібні операції; без ізоляції дочірній
 * процес чекав би в черзі за той самий лок і міг перевищити `testTimeout`. Тому
 * підміняємо `TMPDIR` дочірньому процесу — `os.tmpdir()` в ньому резолвиться в
 * ізольований каталог, і лок цього тесту нікому не заважає (і навпаки).
 */
import { describe, expect, test } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const binPath = join(here, '..', '..', 'bin', 'n-rules.js')

describe('n-rules lint --full у .worktrees/', () => {
  test('не падає з ERR_INVALID_ARG_TYPE (lost-await regression)', () => {
    const tmpRoot = mkdtempSync(join(tmpdir(), 'n-rules-lint-full-worktree-'))
    const fixtureCwd = join(tmpRoot, '.worktrees', 'fake-branch')
    const isolatedTmpDir = join(tmpRoot, 'isolated-tmp')
    try {
      spawnSync('git', ['init', '-q', fixtureCwd])
      spawnSync('git', ['-C', fixtureCwd, 'commit', '-q', '--allow-empty', '-m', 'init'])
      mkdirSync(isolatedTmpDir, { recursive: true })

      const result = spawnSync('node', [binPath, 'lint', '--full', '--rules', 'changelog'], {
        cwd: fixtureCwd,
        encoding: 'utf8',
        env: { ...process.env, TMPDIR: isolatedTmpDir, TMP: isolatedTmpDir, TEMP: isolatedTmpDir }
      })

      const combined = `${result.stdout}\n${result.stderr}`
      expect(combined).not.toContain('ERR_INVALID_ARG_TYPE')
      expect(combined).not.toContain('TypeError')
    } finally {
      rmSync(tmpRoot, { recursive: true, force: true })
    }
  })
})
