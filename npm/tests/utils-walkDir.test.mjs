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

  test('ignorePaths: пропускає каталог за повним шляхом і його вміст', async () => {
    await withTmpCwd(async dir => {
      await mkdir('vendor/chart/templates', { recursive: true })
      await mkdir('src', { recursive: true })
      await writeFile('keep.txt', 'k', 'utf8')
      await writeFile(join('src', 'a.txt'), 'a', 'utf8')
      await writeFile(join('vendor', 'chart', 'values.yaml'), 'v', 'utf8')
      await writeFile(join('vendor', 'chart', 'templates', 'deploy.yaml'), 'd', 'utf8')
      const seen = []
      await walkDir(dir, p => seen.push(p), [join(dir, 'vendor', 'chart')])
      const rels = seen.map(p => p.slice(dir.length + 1))
      expect(rels.toSorted()).toEqual(['keep.txt', 'src/a.txt'].toSorted())
    })
  })

  test('ignorePaths: точне співпадіння за повним шляхом, не за basename', async () => {
    // postgres-master-test/ не має пропускатися, коли в ignore лише postgres-master/
    await withTmpCwd(async () => {
      await mkdir('postgres-master', { recursive: true })
      await mkdir('postgres-master-test', { recursive: true })
      await writeFile(join('postgres-master', 'cfg.yaml'), 'a', 'utf8')
      await writeFile(join('postgres-master-test', 'cfg.yaml'), 'b', 'utf8')
      const seen = []
      const root = process.cwd()
      await walkDir(root, p => seen.push(p), ['postgres-master'])
      const rels = seen.map(p => p.slice(root.length + 1))
      expect(rels).toEqual(['postgres-master-test/cfg.yaml'])
    })
  })

  test('ignorePaths: відносні шляхи нормалізуються від cwd', async () => {
    await withTmpCwd(async () => {
      await mkdir('a/b', { recursive: true })
      await writeFile(join('a', 'b', 'x.txt'), 'x', 'utf8')
      await writeFile('root.txt', 'r', 'utf8')
      const seen = []
      const root = process.cwd()
      // відносний шлях 'a/b' має нормалізуватися від cwd
      await walkDir(root, p => seen.push(p), ['a/b'])
      const rels = seen.map(p => p.slice(root.length + 1))
      expect(rels).toEqual(['root.txt'])
    })
  })

  test('ignorePaths: trailing slash не впливає', async () => {
    await withTmpCwd(async dir => {
      await mkdir('skip', { recursive: true })
      await writeFile(join('skip', 'x.txt'), 'x', 'utf8')
      await writeFile('keep.txt', 'k', 'utf8')
      const seen = []
      await walkDir(dir, p => seen.push(p), [`${join(dir, 'skip')}/`])
      const rels = seen.map(p => p.slice(dir.length + 1))
      expect(rels).toEqual(['keep.txt'])
    })
  })

  test('ignorePaths: порожній масив = поведінка без аргументу', async () => {
    await withTmpCwd(async dir => {
      await mkdir('x', { recursive: true })
      await writeFile(join('x', 'a.txt'), 'a', 'utf8')
      const seenA = []
      const seenB = []
      await walkDir(dir, p => seenA.push(p))
      await walkDir(dir, p => seenB.push(p), [])
      expect(seenB.toSorted()).toEqual(seenA.toSorted())
    })
  })
})
