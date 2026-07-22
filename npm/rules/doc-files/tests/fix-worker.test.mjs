import { describe, expect, test, vi } from 'vitest'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { writeFile } from 'node:fs/promises'

import { withTmpDir, ensureDir, installFakeLangJsPlugin } from '../../../scripts/utils/test-helpers.mjs'
import { crc32, stampDoc, readDocCrc } from '../docgen-crc/main.mjs'
import { fixWorker } from '../check/fix-worker.mjs'
import { runGenerationBatch } from '../docgen-files-batch/main.mjs'

// Генерація підмінена стабом (vi.mock): тест перевіряє МАРШРУТИЗАЦІЮ
// (crc-mismatch → регенерація), а не сам LLM-конвеєр.
vi.mock('../docgen-files-batch/main.mjs', () => ({
  runGenerationBatch: vi.fn(() => 0),
  purgeOrphanedDocs: vi.fn(() => 0)
}))

const EXT_RE = /\.\w+$/u

/**
 * Пише джерело `rel` з тілом `body` і доку, проштамповану CRC вмісту `stampedFor`.
 * @param {string} root корінь
 * @param {string} rel posix-шлях джерела
 * @param {string} body поточний вміст джерела
 * @param {string} stampedFor вміст, від якого рахувати CRC у frontmatter доки
 * @returns {Promise<string>} абсолютний шлях доки
 */
async function writeSourceWithDoc(root, rel, body, stampedFor) {
  await ensureDir(join(root, rel, '..'))
  await writeFile(join(root, rel), body)
  const docRel = join(rel, '..', 'docs', `${rel.split('/').at(-1).replace(EXT_RE, '')}.md`)
  await ensureDir(join(root, docRel, '..'))
  const md = stampDoc('# a\n\n## Огляд\n\nОпис старої поведінки.\n', rel, crc32(Buffer.from(stampedFor)))
  await writeFile(join(root, docRel), md)
  return join(root, docRel)
}

describe('fix-worker — crc-mismatch іде через регенерацію, не через CRC-штамп', () => {
  test('регрес (2026-07-21): застаріла дока НЕ штампується свіжим CRC — ціль передається у runGenerationBatch', async () => {
    await withTmpDir(async root => {
      await installFakeLangJsPlugin(root)
      // Дока згенерована для v1, джерело вже v2 → crc-mismatch
      const docAbs = await writeSourceWithDoc(root, 'src/a.mjs', 'export const a = 2\n', 'export const a = 1\n')
      const crcBefore = readDocCrc(docAbs)

      const recordDurableWrite = vi.fn()
      await fixWorker([{ reason: 'crc-mismatch', file: 'src/a.mjs' }], { cwd: root, recordDurableWrite })

      // Ціль дійшла до генерації саме як crc-mismatch…
      expect(runGenerationBatch).toHaveBeenCalledTimes(1)
      const [targets] = runGenerationBatch.mock.calls[0]
      expect(targets).toEqual([expect.objectContaining({ sourcePath: 'src/a.mjs', reason: 'crc-mismatch' })])
      expect(recordDurableWrite).toHaveBeenCalledWith(docAbs)
      // …а сам worker НЕ проставив свіжий CRC поверх старого тексту (генерація — мок):
      // свіжий CRC пише лише stampDoc усередині runGenerationBatch разом із новим вмістом.
      expect(readDocCrc(docAbs)).toBe(crcBefore)
    })
  })

  test('інваріант: у check немає T0 fix-check.mjs (безумовний CRC-штамп маскував дрейф назавжди)', () => {
    // Історичний баг: T0-патерн `doc-files-stamp-crc` штампував свіжий CRC у frontmatter
    // будь-якої crc-mismatch доки БЕЗ регенерації тексту — після цього CRC-гейт вважав
    // доку актуальною і вона більше ніколи не оновлювалась. T0 для check свідомо відсутній.
    const t0Path = fileURLToPath(new URL('../check/fix-check.mjs', import.meta.url))
    expect(existsSync(t0Path)).toBe(false)
  })
})
