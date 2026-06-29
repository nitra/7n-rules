/**
 * Тести run-shellrules/text/check.mjs: авто-виправлення через diff+patch і фінальний shellcheck.
 */
import { describe, expect, test } from 'vitest'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'

import { listShellScriptPaths, runShellcheckText } from '../main.mjs'
import { resolveCmd } from '../../../../scripts/utils/resolve-cmd.mjs'
import { ensureDir, withBinRemovedFromPath, withTmpDir } from '../../../../scripts/utils/test-helpers.mjs'

describe('run-shellrules/text/check.mjs', () => {
  test('listShellScriptPaths у тимчасовому каталозі без git повертає вкладені .sh', async () => {
    await withTmpDir(async dir => {
      await ensureDir(join(dir, 'a/b'))
      await writeFile(join(dir, 'a/b/x.sh'), '#!/bin/bash\necho ok\n', 'utf8')
      await writeFile(join(dir, 'root.sh'), '#!/bin/sh\ntrue\n', 'utf8')
      const paths = listShellScriptPaths(dir)
      expect(paths.toSorted()).toEqual(['a/b/x.sh', 'root.sh'])
    })
  })

  // Ізольоване tmp-репо замість реального NPM_ROOT: робочий cwd під Stryker — це
  // sandbox-копія без `.git/`, тож звертання до реального дерева через `import.meta.url`
  // ламало dry-run (див. integration-repo-checks.test.mjs про той самий патерн).
  test('listShellScriptPaths всередині git-репо використовує git ls-files (lines 76, 84-85)', async () => {
    await withTmpDir(async dir => {
      execFileSync('git', ['init', '-q', '--initial-branch=main'], { cwd: dir })
      await ensureDir(join(dir, 'sub'))
      await writeFile(join(dir, 'root.sh'), '#!/bin/sh\ntrue\n', 'utf8')
      await writeFile(join(dir, 'sub', 'nested.sh'), '#!/bin/bash\necho ok\n', 'utf8')
      await writeFile(join(dir, 'readme.txt'), 'hello\n', 'utf8')
      execFileSync('git', ['add', '-A'], { cwd: dir })
      const paths = listShellScriptPaths(dir)
      expect(paths).toEqual(['root.sh', 'sub/nested.sh'])
      expect(paths).toEqual([...new Set(paths)].toSorted())
    })
  })

  test('runShellcheckText виправляє тривіальне SC2086 і завершується з 0', async () => {
    if (!resolveCmd('shellcheck') || !resolveCmd('patch')) {
      expect(true).toBe(true)
      return
    }
    await withTmpDir(async dir => {
      await writeFile(
        join(dir, 'fixme.sh'),
        `#!/bin/bash
echo $1
`,
        'utf8'
      )
      expect(runShellcheckText(dir)).toBe(0)
      const fixed = await readFile(join(dir, 'fixme.sh'), 'utf8')
      expect(fixed).toContain('echo "$1"')
    })
  })

  test('runShellcheckText повертає 1 і друкує підказки, якщо shellcheck відсутній у PATH (lines 36, 105-106)', async () => {
    const errLines = []
    const origErr = process.stderr.write.bind(process.stderr)
    process.stderr.write = chunk => {
      errLines.push(chunk)
      return true
    }
    try {
      await withBinRemovedFromPath('shellcheck', async () => {
        await withTmpDir(async dir => {
          await writeFile(join(dir, 'a.sh'), '#!/bin/sh\necho ok\n', 'utf8')
          const code = runShellcheckText(dir)
          expect(code).toBe(1)
        })
      })
    } finally {
      process.stderr.write = origErr
    }
    expect(errLines.join('')).toContain('shellcheck')
    expect(errLines.join('')).toContain('brew install')
  })

  test('runShellcheckText повертає 1 коли shellcheck знаходить незмінні попередження (lines 213-215)', async () => {
    if (!resolveCmd('shellcheck') || !resolveCmd('patch')) {
      expect(true).toBe(true)
      return
    }
    const origOut = process.stdout.write.bind(process.stdout)
    process.stdout.write = () => true
    try {
      await withTmpDir(async dir => {
        // SC2034: unused variable — не авто-виправляється shellcheck
        await writeFile(join(dir, 'warn.sh'), '#!/bin/bash\nx=5\necho done\n', 'utf8')
        const code = runShellcheckText(dir)
        expect(code).toBe(1)
      })
    } finally {
      process.stdout.write = origOut
    }
  })
})
