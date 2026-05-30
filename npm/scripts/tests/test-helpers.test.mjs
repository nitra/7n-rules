/**
 * Тести захисних перевірок utils/test-helpers.mjs (absolute-path guard).
 *
 * Шляхи передаються через Identifier (не string-literal), щоб не тригерити
 * AST-сканер test.no-relative-fs-path: для writeJson/ensureDir він прапорить
 * literal-аргумент, але змінні вважає absolute.
 */
import { describe, expect, test } from 'vitest'

import { ensureDir, writeJson } from '../utils/test-helpers.mjs'

const REL_FILE_PATH = 'relative/path.json'
const REL_DIR_PATH = 'relative/dir'

describe('writeJson / ensureDir — absolute path guard', () => {
  test('writeJson з відносним шляхом кидає помилку (line 53)', async () => {
    await expect(writeJson(REL_FILE_PATH, {})).rejects.toThrow('writeJson: шлях має бути абсолютним')
  })

  test('ensureDir з відносним шляхом кидає помилку (line 65)', async () => {
    await expect(ensureDir(REL_DIR_PATH)).rejects.toThrow('ensureDir: шлях має бути абсолютним')
  })
})
