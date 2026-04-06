/**
 * Тести пошуку коренів каталогів `k8s` для run-k8s.
 */
import { describe, expect, test } from 'bun:test'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { findK8sRoots, k8sRootFromFile } from '../scripts/run-k8s.mjs'
import { withTmpCwd } from './helpers.mjs'

describe('k8sRootFromFile', () => {
  test('повертає каталог k8s зі шляху до yaml', () => {
    const root = '/tmp'
    const f = join(root, 'app', 'k8s', 'base', 'd.yaml')
    expect(k8sRootFromFile(f)).toBe(join(root, 'app', 'k8s'))
  })

  test('null, якщо сегмента k8s немає', () => {
    expect(k8sRootFromFile('/tmp/a/b/c.yaml')).toBe(null)
  })
})

describe('findK8sRoots', () => {
  test('знаходить унікальні корені k8s', async () => {
    await withTmpCwd(async root => {
      await mkdir(join('p1', 'k8s'), { recursive: true })
      await mkdir(join('p2', 'k8s', 'base'), { recursive: true })
      await writeFile(join('p1', 'k8s', 'a.yaml'), 'a: 1\n', 'utf8')
      await writeFile(join('p2', 'k8s', 'base', 'b.yaml'), 'b: 2\n', 'utf8')
      const dirs = await findK8sRoots(root)
      expect(dirs.length).toBe(2)
      expect(dirs.includes(join(root, 'p1', 'k8s'))).toBe(true)
      expect(dirs.includes(join(root, 'p2', 'k8s'))).toBe(true)
    })
  })
})
