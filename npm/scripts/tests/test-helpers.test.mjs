/**
 * Тести захисних перевірок utils/test-helpers.mjs (absolute-path guard).
 */
import { describe, expect, test } from 'vitest'

import { ensureDir, writeJson } from '../utils/test-helpers.mjs'

describe('writeJson / ensureDir — absolute path guard', () => {
  test('writeJson з відносним шляхом кидає помилку (line 53)', async () => {
    await expect(writeJson('relative/path.json', {})).rejects.toThrow('writeJson: шлях має бути абсолютним')
  })

  test('ensureDir з відносним шляхом кидає помилку (line 65)', async () => {
    await expect(ensureDir('relative/dir')).rejects.toThrow('ensureDir: шлях має бути абсолютним')
  })
})
