/**
 * Real hard-fail шлях detector-а `php/mago_fmt`: `ensureToolAsync` НЕ мокається — перевіряємо,
 * що відсутність `mago` у PATH з вимкненим авто-install (`withBinRemovedFromPath`, той самий
 * патерн, що й `run-conftest-batch.test.mjs`) валить `lint()` винятком, а не тихим skip
 * (на відміну від колишнього vendor-optional `cs_fixer`). Окремий файл від `main.test.mjs` —
 * там `ensure-tool.mjs` мокається module-wide, що конфліктувало б із цим тестом.
 */
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { describe, expect, test } from 'vitest'

import { withBinRemovedFromPath, withTmpDir } from '@7n/rules/scripts/utils/test-helpers.mjs'

const { lint } = await import('../main.mjs')

const MAGO_ERROR_RE = /mago/

describe('php/mago_fmt detector — hard-fail без mago в PATH', () => {
  test('mago відсутній + N_CURSOR_NO_AUTO_INSTALL=1 → lint() кидає (не тихий skip)', async () => {
    await withBinRemovedFromPath('mago', async () => {
      await withTmpDir(async dir => {
        await writeFile(join(dir, 'composer.json'), '{}', 'utf8')
        await expect(lint({ cwd: dir, ruleId: 'php', concernId: 'mago_fmt', files: ['a.php'] })).rejects.toThrow(
          MAGO_ERROR_RE
        )
      })
    })
  })
})
