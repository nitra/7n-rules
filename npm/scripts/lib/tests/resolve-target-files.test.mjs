/**
 * Тести `resolveTargetFiles`: forms `single` / `walkGlob`, walk-cache, path-traversal guard.
 */
import { describe, expect, test } from 'vitest'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { resolveTargetFiles } from '../resolve-target-files.mjs'
import { ensureDir, withTmpDir, writeJson } from '../../utils/test-helpers.mjs'

const ABSOLUTE_PATH_HINT_RE = /відносним/u
const PARENT_TRAVERSAL_HINT_RE = /\.\./u
const INVALID_SPEC_HINT_RE = /single або walkGlob/u

describe('resolveTargetFiles — single', () => {
  test('повертає [<abs>], якщо файл існує', async () => {
    await withTmpDir(async dir => {
      await writeJson(join(dir, 'package.json'), { name: 'x' })
      const cache = new Map()
      const out = await resolveTargetFiles({ single: 'package.json' }, dir, cache)
      expect(out).toEqual([join(dir, 'package.json')])
    })
  })

  test('повертає [], якщо файла нема', async () => {
    await withTmpDir(async dir => {
      const cache = new Map()
      const out = await resolveTargetFiles({ single: 'missing.json' }, dir, cache)
      expect(out).toEqual([])
    })
  })

  test('кидає на абсолютний шлях', async () => {
    await withTmpDir(async dir => {
      const cache = new Map()
      await expect(resolveTargetFiles({ single: '/etc/passwd' }, dir, cache)).rejects.toThrow(ABSOLUTE_PATH_HINT_RE)
    })
  })

  test('кидає на ".." у шляху', async () => {
    await withTmpDir(async dir => {
      const cache = new Map()
      await expect(resolveTargetFiles({ single: '../outside.json' }, dir, cache)).rejects.toThrow(
        PARENT_TRAVERSAL_HINT_RE
      )
    })
  })
})

describe('resolveTargetFiles — walkGlob', () => {
  test('матчить файли за одним glob', async () => {
    await withTmpDir(async dir => {
      await ensureDir(join(dir, 'a'))
      await ensureDir(join(dir, 'b'))
      await writeJson(join(dir, 'package.json'), { name: 'root' })
      await writeJson(join(dir, 'a', 'package.json'), { name: 'a' })
      await writeJson(join(dir, 'b', 'package.json'), { name: 'b' })
      await writeFile(join(dir, 'b', 'other.txt'), 'x', 'utf8')
      const cache = new Map()
      const out = await resolveTargetFiles({ walkGlob: '**/package.json' }, dir, cache)
      expect(out.toSorted()).toEqual(
        [join(dir, 'a', 'package.json'), join(dir, 'b', 'package.json'), join(dir, 'package.json')].toSorted()
      )
    })
  })

  test('матчить за масивом globів', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'a.yaml'), '', 'utf8')
      await writeFile(join(dir, 'b.yml'), '', 'utf8')
      await writeFile(join(dir, 'c.txt'), '', 'utf8')
      const cache = new Map()
      const out = await resolveTargetFiles({ walkGlob: ['**/*.yaml', '**/*.yml'] }, dir, cache)
      expect(out.toSorted()).toEqual([join(dir, 'a.yaml'), join(dir, 'b.yml')].toSorted())
    })
  })

  test('повторний виклик з тим самим cache не робить другий обхід', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'x.yaml'), '', 'utf8')
      const cache = new Map()
      const out1 = await resolveTargetFiles({ walkGlob: '**/*.yaml' }, dir, cache)
      expect(cache.size).toBe(1)
      const out2 = await resolveTargetFiles({ walkGlob: '**/*.yml' }, dir, cache)
      expect(cache.size).toBe(1) // той самий signature
      expect(out1).toEqual([join(dir, 'x.yaml')])
      expect(out2).toEqual([])
    })
  })

  test('повертає [] при відсутності матчів', async () => {
    await withTmpDir(async dir => {
      const cache = new Map()
      const out = await resolveTargetFiles({ walkGlob: '**/*.rego' }, dir, cache)
      expect(out).toEqual([])
    })
  })
})

describe('resolveTargetFiles — невалідний spec', () => {
  test('кидає, коли немає ні single, ні walkGlob', async () => {
    await withTmpDir(async dir => {
      const cache = new Map()
      await expect(resolveTargetFiles({}, dir, cache)).rejects.toThrow(INVALID_SPEC_HINT_RE)
    })
  })
})
