/**
 * Тести run-shellrules/text/fix.mjs: авто-виправлення через diff+patch і фінальний shellcheck.
 */
import { describe, expect, test } from 'vitest'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { listShellScriptPaths, runShellcheckText } from '../run-shellcheck.mjs'
import { resolveCmd } from '../../../../scripts/utils/resolve-cmd.mjs'
import { ensureDir, withTmpDir } from '../../../../scripts/utils/test-helpers.mjs'

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
})
