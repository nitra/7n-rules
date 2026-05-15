import { describe, expect, test } from 'bun:test'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

import { isAbieRuleEnabled } from './enabled.mjs'
import { withTmpCwd, writeJson } from '../../../scripts/utils/test-helpers.mjs'

const TEST_DIR =
  typeof import.meta.dirname === 'string' ? import.meta.dirname : fileURLToPath(new URL('.', import.meta.url))
const REPO_ROOT = join(TEST_DIR, '..', '..', '..', '..')

describe('isAbieRuleEnabled', () => {
  test('на репозиторії cursor — false (abie не в rules)', async () => {
    expect(await isAbieRuleEnabled(REPO_ROOT)).toBe(false)
  })

  test('true, коли abie присутній у .n-cursor.json:rules', async () => {
    await withTmpCwd(async dir => {
      await writeJson('.n-cursor.json', { rules: ['abie', 'bun'] })
      expect(await isAbieRuleEnabled(dir)).toBe(true)
    })
  })

  test('false, коли .n-cursor.json відсутній', async () => {
    await withTmpCwd(async dir => {
      expect(await isAbieRuleEnabled(dir)).toBe(false)
    })
  })
})
