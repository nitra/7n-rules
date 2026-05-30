/**
 * Тести run-shellrules/text/fix.mjs: авто-виправлення через diff+patch і фінальний shellcheck.
 */
import { describe, expect, test } from 'vitest'
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { listShellScriptPaths, runShellcheckText } from '../run-shellcheck.mjs'
import { resolveCmd } from '../../../../scripts/utils/resolve-cmd.mjs'
import { ensureDir, withBinRemovedFromPath, withTmpDir } from '../../../../scripts/utils/test-helpers.mjs'

const NPM_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', '..')

describe('run-shellrules/text/fix.mjs', () => {
  test('listShellScriptPaths у тимчасовому каталозі без git повертає вкладені .sh', async () => {
    await withTmpDir(async dir => {
      await ensureDir(join(dir, 'a/b'))
      await writeFile(join(dir, 'a/b/x.sh'), '#!/bin/bash\necho ok\n', 'utf8')
      await writeFile(join(dir, 'root.sh'), '#!/bin/sh\ntrue\n', 'utf8')
      const paths = listShellScriptPaths(dir)
      expect(paths.toSorted()).toEqual(['a/b/x.sh', 'root.sh'])
    })
  })

  test('listShellScriptPaths всередині git-репо використовує git ls-files (lines 76, 84-85)', () => {
    const paths = listShellScriptPaths(NPM_ROOT)
    expect(Array.isArray(paths)).toBe(true)
    expect(paths.some(p => p.endsWith('.sh'))).toBe(true)
    expect(paths).toEqual([...new Set(paths)].toSorted())
  })

  test('runShellcheckText виправляє тривіальне SC2086 і завершується з 0', async () => {
    if (!resolveCmd('shellcheck') || !resolveCmd('patch')) {
      expect(true).toBe(true)
      return
    }
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'fixme.sh'),
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
    process.stderr.write = chunk => { errLines.push(chunk); return true }
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
    const outLines = []
    const origOut = process.stdout.write.bind(process.stdout)
    process.stdout.write = chunk => { outLines.push(chunk); return true }
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
