import { describe, expect, test } from 'vitest'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { writeFile } from 'node:fs/promises'

import { isAbieRuleEnabled } from '../enabled.mjs'
import { withTmpDir, writeJson } from '../../../../scripts/utils/test-helpers.mjs'

const TEST_DIR =
  typeof import.meta.dirname === 'string' ? import.meta.dirname : fileURLToPath(new URL('.', import.meta.url))
const REPO_ROOT = join(TEST_DIR, '..', '..', '..', '..', '..')

describe('isAbieRuleEnabled', () => {
  test('на репозиторії cursor — false (abie не в rules)', async () => {
    expect(await isAbieRuleEnabled(REPO_ROOT)).toBe(false)
  })

  test('true, коли abie присутній у .n-cursor.json:rules', async () => {
    await withTmpDir(async dir => {
      await writeJson(join(dir, '.n-cursor.json'), { rules: ['abie', 'bun'] })
      expect(await isAbieRuleEnabled(dir)).toBe(true)
    })
  })

  test('false, коли .n-cursor.json відсутній', async () => {
    await withTmpDir(async dir => {
      expect(await isAbieRuleEnabled(dir)).toBe(false)
    })
  })

  test('false, коли .n-cursor.json містить недійсний JSON', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, '.n-cursor.json'), 'invalid json{{', 'utf8')
      expect(await isAbieRuleEnabled(dir)).toBe(false)
    })
  })
})
