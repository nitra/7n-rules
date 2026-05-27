/**
 * Тести рекурсивного обходу `walkDir` (пропуск node_modules, .git тощо).
 */
import { describe, expect, test } from 'vitest'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { withTmpDir } from '../test-helpers.mjs'
import { walkDir } from '../walkDir.mjs'

describe('walkDir', () => {
  test('збирає файли та обходить вкладеність', async () => {
    await withTmpDir(async dir => {
      await mkdir(join(dir, 'src/nested'), { recursive: true })
      await writeFile(join(dir, 'a.txt'), 'a', 'utf8')
      await writeFile(join(dir, 'src', 'b.txt'), 'b', 'utf8')
      await writeFile(join(dir, 'src', 'nested', 'c.txt'), 'c', 'utf8')
      const seen = []
      await walkDir(dir, p => seen.push(p))
      expect(seen.length).toBe(3)
      expect(seen.some(p => p.endsWith('a.txt'))).toBe(true)
      expect(seen.filter(p => p.endsWith('b.txt')).length).toBe(1)
      expect(seen.filter(p => p.endsWith('c.txt')).length).toBe(1)
    })
  })

  test('не заходить у node_modules, .git, dist', async () => {
    await withTmpDir(async dir => {
      await mkdir(join(dir, 'node_modules/pkg'), { recursive: true })
      await mkdir(join(dir, '.git/objects'), { recursive: true })
      await mkdir(join(dir, 'dist'), { recursive: true })
      await writeFile(join(dir, 'root.txt'), 'x', 'utf8')
      await writeFile(join(dir, 'node_modules', 'pkg', 'bad.txt'), 'x', 'utf8')
      await writeFile(join(dir, '.git', 'objects', 'bad.txt'), 'x', 'utf8')
      await writeFile(join(dir, 'dist', 'bad.txt'), 'x', 'utf8')
      const seen = []
      await walkDir(dir, p => seen.push(p))
      expect(seen.length).toBe(1)
      expect(seen[0].endsWith('root.txt')).toBe(true)
    })
  })

  test('не кидає, якщо корінь каталогу відсутній', async () => {
    await withTmpDir(async dir => {
      const ghost = join(dir, 'nope')
      await walkDir(ghost, () => {
        expect.unreachable()
      })
    })
  })

  test('ignorePaths: пропускає каталог за повним шляхом і його вміст', async () => {
    await withTmpDir(async dir => {
      await mkdir(join(dir, 'vendor/chart/templates'), { recursive: true })
      await mkdir(join(dir, 'src'), { recursive: true })
      await writeFile(join(dir, 'keep.txt'), 'k', 'utf8')
      await writeFile(join(dir, 'src', 'a.txt'), 'a', 'utf8')
      await writeFile(join(dir, 'vendor', 'chart', 'values.yaml'), 'v', 'utf8')
      await writeFile(join(dir, 'vendor', 'chart', 'templates', 'deploy.yaml'), 'd', 'utf8')
      const seen = []
      await walkDir(dir, p => seen.push(p), [join(dir, 'vendor', 'chart')])
      const rels = seen.map(p => p.slice(dir.length + 1))
      expect(rels.toSorted()).toEqual(['keep.txt', 'src/a.txt'].toSorted())
    })
  })

  test('ignorePaths: точне співпадіння за повним шляхом, не за basename', async () => {
    // postgres-master-test/ не має пропускатися, коли в ignore лише postgres-master/
    await withTmpDir(async dir => {
      await mkdir(join(dir, 'postgres-master'), { recursive: true })
      await mkdir(join(dir, 'postgres-master-test'), { recursive: true })
      await writeFile(join(dir, 'postgres-master', 'cfg.yaml'), 'a', 'utf8')
      await writeFile(join(dir, 'postgres-master-test', 'cfg.yaml'), 'b', 'utf8')
      const seen = []
      const root = dir
      await walkDir(root, p => seen.push(p), [join(root, 'postgres-master')])
      const rels = seen.map(p => p.slice(root.length + 1))
      expect(rels).toEqual(['postgres-master-test/cfg.yaml'])
    })
  })

  test('ignorePaths: відносні шляхи нормалізуються від cwd', async () => {
    await withTmpDir(async dir => {
      await mkdir(join(dir, 'a/b'), { recursive: true })
      await writeFile(join(dir, 'a', 'b', 'x.txt'), 'x', 'utf8')
      await writeFile(join(dir, 'root.txt'), 'r', 'utf8')
      const seen = []
      const root = dir
      // абсолютний шлях `<dir>/a/b` має бути виключений
      await walkDir(root, p => seen.push(p), [join(root, 'a/b')])
      const rels = seen.map(p => p.slice(root.length + 1))
      expect(rels).toEqual(['root.txt'])
    })
  })

  test('ignorePaths: trailing slash не впливає', async () => {
    await withTmpDir(async dir => {
      await mkdir(join(dir, 'skip'), { recursive: true })
      await writeFile(join(dir, 'skip', 'x.txt'), 'x', 'utf8')
      await writeFile(join(dir, 'keep.txt'), 'k', 'utf8')
      const seen = []
      await walkDir(dir, p => seen.push(p), [`${join(dir, 'skip')}/`])
      const rels = seen.map(p => p.slice(dir.length + 1))
      expect(rels).toEqual(['keep.txt'])
    })
  })

  test('ignorePaths: порожній масив = поведінка без аргументу', async () => {
    await withTmpDir(async dir => {
      await mkdir(join(dir, 'x'), { recursive: true })
      await writeFile(join(dir, 'x', 'a.txt'), 'a', 'utf8')
      const seenA = []
      const seenB = []
      await walkDir(dir, p => seenA.push(p))
      await walkDir(dir, p => seenB.push(p), [])
      expect(seenB.toSorted()).toEqual(seenA.toSorted())
    })
  })
})
