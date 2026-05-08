/**
 * Тести run-shellcheck-text.mjs: авто-виправлення через diff+patch і фінальний shellcheck.
 */
import { describe, expect, test } from 'bun:test'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { listShellScriptPaths, runShellcheckText } from '../scripts/run-shellcheck-text.mjs'
import { resolveCmd } from '../scripts/utils/resolve-cmd.mjs'
import { ensureDir, withTmpCwd } from './helpers.mjs'

describe('run-shellcheck-text.mjs', () => {
  test('listShellScriptPaths у тимчасовому каталозі без git повертає вкладені .sh', async () => {
    await withTmpCwd(async () => {
      await ensureDir('a/b')
      await writeFile('a/b/x.sh', '#!/bin/bash\necho ok\n', 'utf8')
      await writeFile('root.sh', '#!/bin/sh\ntrue\n', 'utf8')
      const paths = listShellScriptPaths(process.cwd())
      expect(paths.toSorted()).toEqual(['a/b/x.sh', 'root.sh'])
    })
  })

  test('runShellcheckText виправляє тривіальне SC2086 і завершується з 0', async () => {
    if (!resolveCmd('shellcheck') || !resolveCmd('patch')) {
      expect(true).toBe(true)
      return
    }
    await withTmpCwd(async () => {
      await writeFile(
        'fixme.sh',
        `#!/bin/bash
echo $1
`,
        'utf8'
      )
      expect(runShellcheckText(process.cwd())).toBe(0)
      const fixed = await Bun.file(join(process.cwd(), 'fixme.sh')).text()
      expect(fixed).toContain('echo "$1"')
    })
  })
})
