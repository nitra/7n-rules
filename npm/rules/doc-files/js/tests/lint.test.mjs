import { describe, expect, test } from 'vitest'
import { join } from 'node:path'
import { writeFile, readFile } from 'node:fs/promises'

import { withTmpDir, ensureDir } from '../../../../scripts/utils/test-helpers.mjs'
import { lint } from '../lint.mjs'
import { crc32, stampDoc } from '../docgen-crc.mjs'

/**
 * Пише джерело й свіжу доку (CRC збігається) у тимчасовому корені.
 * @param {string} root корінь
 * @param {string} rel posix-шлях джерела
 * @param {string} body вміст джерела
 */
async function writeSourceWithFreshDoc(root, rel, body) {
  await ensureDir(join(root, rel, '..'))
  await writeFile(join(root, rel), body)
  const docRel = join(rel, '..', 'docs', `${rel.split('/').at(-1).replace(/\.\w+$/u, '')}.md`)
  await ensureDir(join(root, docRel, '..'))
  await writeFile(join(root, docRel), stampDoc('# x\n\n## Огляд\n\nтест\n', rel, crc32(Buffer.from(body))))
}

describe('lint (адаптер агрегатора)', () => {
  test('ci (files=undefined): ловить відсутню доку у дереві', async () => {
    await withTmpDir(async root => {
      await ensureDir(join(root, 'src'))
      await writeFile(join(root, 'src', 'a.mjs'), 'export const a = 1\n')
      expect(await lint(undefined, root)).toBe(1)
    })
  })

  test('ci: свіжа дока → 0', async () => {
    await withTmpDir(async root => {
      await writeSourceWithFreshDoc(root, 'src/a.mjs', 'export const a = 1\n')
      expect(await lint(undefined, root)).toBe(0)
    })
  })

  test('quick: змінене джерело без доки → 1; порожній набір → 0', async () => {
    await withTmpDir(async root => {
      await ensureDir(join(root, 'src'))
      await writeFile(join(root, 'src', 'a.mjs'), 'export const a = 1\n')
      expect(await lint(['src/a.mjs'], root)).toBe(1)
      expect(await lint([], root)).toBe(0)
    })
  })

  test('quick: реверс-мапінг — змінена дока веде до перевірки джерела', async () => {
    await withTmpDir(async root => {
      await writeSourceWithFreshDoc(root, 'src/a.mjs', 'export const a = 1\n')
      // Джерело змінилось, але у наборі лише шлях доки → мапінг має знайти джерело й виявити mismatch.
      await writeFile(join(root, 'src', 'a.mjs'), 'export const a = 2\n')
      expect(await lint(['src/docs/a.md'], root)).toBe(1)
    })
  })

  test('quick: ігнорує не-кандидати (тести, node_modules)', async () => {
    await withTmpDir(async root => {
      await ensureDir(join(root, 'src'))
      await writeFile(join(root, 'src', 'a.test.mjs'), 'test\n')
      expect(await lint(['src/a.test.mjs'], root)).toBe(0)
    })
  })
})
