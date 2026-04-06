/**
 * Тести рекурсивного обходу `walkDir` (пропуск node_modules, .git тощо).
 */
import { describe, expect, test } from 'bun:test'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { withTmpCwd } from './helpers.mjs'
import { walkDir } from '../scripts/utils/walkDir.mjs'

describe('walkDir', () => {
  test('збирає файли та обходить вкладеність', async () => {
    await withTmpCwd(async () => {
      await mkdir('src/nested', { recursive: true })
      await writeFile('a.txt', 'a', 'utf8')
      await writeFile(join('src', 'b.txt'), 'b', 'utf8')
      await writeFile(join('src', 'nested', 'c.txt'), 'c', 'utf8')
      const seen = []
      await walkDir(process.cwd(), p => seen.push(p))
      expect(seen.length).toBe(3)
      expect(seen.some(p => p.endsWith('a.txt'))).toBe(true)
      expect(seen.filter(p => p.endsWith('b.txt')).length).toBe(1)
      expect(seen.filter(p => p.endsWith('c.txt')).length).toBe(1)
    })
  })

  test('не заходить у node_modules, .git, dist', async () => {
    await withTmpCwd(async () => {
      await mkdir('node_modules/pkg', { recursive: true })
      await mkdir('.git/objects', { recursive: true })
      await mkdir('dist', { recursive: true })
      await writeFile('root.txt', 'x', 'utf8')
      await writeFile(join('node_modules', 'pkg', 'bad.txt'), 'x', 'utf8')
      await writeFile(join('.git', 'objects', 'bad.txt'), 'x', 'utf8')
      await writeFile(join('dist', 'bad.txt'), 'x', 'utf8')
      const seen = []
      await walkDir(process.cwd(), p => seen.push(p))
      expect(seen.length).toBe(1)
      expect(seen[0].endsWith('root.txt')).toBe(true)
    })
  })

  test('не кидає, якщо корінь каталогу відсутній', async () => {
    await withTmpCwd(async dir => {
      const ghost = join(dir, 'nope')
      await walkDir(ghost, () => {
        expect.unreachable()
      })
    })
  })
})
