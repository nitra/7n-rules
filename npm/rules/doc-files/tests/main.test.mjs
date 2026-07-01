import { describe, expect, test } from 'vitest'
import { join } from 'node:path'
import { writeFile } from 'node:fs/promises'

import { withTmpDir, ensureDir } from '../../../scripts/utils/test-helpers.mjs'
import { crc32, stampDoc } from '../docgen-crc/main.mjs'

import { lint } from '../check/main.mjs'

// Detector-контракт: lint(ctx) → { violations }. Хелпери нижче конвертують у старі семантики
// (0 = чисто, ≥1 = stale) для лаконічних асертів.
const EXT_RE = /\.\w+$/u
const ctxFor = (cwd, files) => ({ cwd, ruleId: 'doc-files', concernId: 'check', files })
const violationsCount = async (cwd, files) => {
  const { violations } = await lint(ctxFor(cwd, files))
  return violations.length
}

/**
 * Пише джерело й свіжу доку (CRC збігається) у тимчасовому корені.
 * @param {string} root корінь
 * @param {string} rel posix-шлях джерела
 * @param {string} body вміст джерела
 */
async function writeSourceWithFreshDoc(root, rel, body) {
  await ensureDir(join(root, rel, '..'))
  await writeFile(join(root, rel), body)
  const docRel = join(
    rel,
    '..',
    'docs',
    `${rel
      .split('/')
      .at(-1)
      .replace(EXT_RE, '')}.md`
  )
  await ensureDir(join(root, docRel, '..'))
  await writeFile(join(root, docRel), stampDoc('# x\n\n## Огляд\n\nтест\n', rel, crc32(Buffer.from(body))))
}

describe('lint — детект (read-only detector)', () => {
  test('ci (files=undefined): ловить відсутню доку у дереві', async () => {
    await withTmpDir(async root => {
      await ensureDir(join(root, 'src'))
      await writeFile(join(root, 'src', 'a.mjs'), 'export const a = 1\n')
      expect(await violationsCount(root)).toBeGreaterThan(0)
    })
  })

  test('ci: свіжа дока → 0 violations', async () => {
    await withTmpDir(async root => {
      await writeSourceWithFreshDoc(root, 'src/a.mjs', 'export const a = 1\n')
      expect(await violationsCount(root)).toBe(0)
    })
  })

  test('quick: змінене джерело без доки → violation; порожній набір → 0', async () => {
    await withTmpDir(async root => {
      await ensureDir(join(root, 'src'))
      await writeFile(join(root, 'src', 'a.mjs'), 'export const a = 1\n')
      expect(await violationsCount(root, ['src/a.mjs'])).toBeGreaterThan(0)
      expect(await violationsCount(root, [])).toBe(0)
    })
  })

  test('quick: реверс-мапінг — змінена дока веде до перевірки джерела', async () => {
    await withTmpDir(async root => {
      await writeSourceWithFreshDoc(root, 'src/a.mjs', 'export const a = 1\n')
      // Джерело змінилось, але у наборі лише шлях доки → мапінг має знайти джерело й виявити mismatch.
      await writeFile(join(root, 'src', 'a.mjs'), 'export const a = 2\n')
      expect(await violationsCount(root, ['src/docs/a.md'])).toBeGreaterThan(0)
    })
  })

  test('quick: ігнорує не-кандидати (тести, node_modules)', async () => {
    await withTmpDir(async root => {
      await ensureDir(join(root, 'src'))
      await writeFile(join(root, 'src', 'a.test.mjs'), 'test\n')
      expect(await violationsCount(root, ['src/a.test.mjs'])).toBe(0)
    })
  })

  test('свіже дерево: stale не репортуються', async () => {
    await withTmpDir(async root => {
      await writeSourceWithFreshDoc(root, 'src/a.mjs', 'export const a = 1\n')
      expect(await violationsCount(root, ['src/a.mjs'])).toBe(0)
    })
  })

  test('violation несе reason і шлях джерела у message', async () => {
    await withTmpDir(async root => {
      await ensureDir(join(root, 'src'))
      await writeFile(join(root, 'src', 'a.mjs'), 'export const a = 1\n')
      const { violations } = await lint(ctxFor(root, ['src/a.mjs']))
      expect(violations.some(v => v.message.includes('src/a.mjs'))).toBe(true)
      expect(violations[0].file).toBe('src/a.mjs')
    })
  })
})
