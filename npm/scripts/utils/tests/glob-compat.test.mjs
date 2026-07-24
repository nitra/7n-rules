/**
 * Тести `glob-compat.mjs`: `resolveGlobScan` під обома формами повернення
 * `Bun.Glob#scan()` (async-iterable напряму і Promise-обгорнутий — спостережено
 * на self-hosted Linux Bun 1.3.14), `scanGlob` під обома гілками (ін'єкція
 * фейкового `Bun` через `opts.bun` і Node-фолбек `node:fs/promises#glob`),
 * плюс `hasIgnoredPathSegment`.
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { describe, expect, test } from 'vitest'

import { withTmpDir } from '../test-helpers.mjs'
import { hasIgnoredPathSegment, resolveGlobScan, scanGlob } from '../glob-compat.mjs'

/**
 * Async-iterable з фіксованого масиву рядків.
 * @param {string[]} items елементи для ітерації
 * @yields {string} кожен елемент `items`
 */
async function* toAsyncIterable(items) {
  yield* items
}

/**
 * Фейкова `Bun`-подібна реалізація для ін'єкції в `scanGlob(pattern, cwd, { bun })`:
 * `scan()` повертає передане значення напряму (без обгортання в клас `Bun.Glob`).
 * @param {(opts: { cwd: string }) => unknown} scanImpl реалізація `scan()`
 * @returns {{ Glob: new (pattern: string) => { scan: (opts: { cwd: string }) => unknown } }} фейковий `Bun`
 */
function fakeBun(scanImpl) {
  return {
    Glob: class {
      scan(opts) {
        return scanImpl(opts)
      }
    }
  }
}

describe('resolveGlobScan', () => {
  test('async-iterable напряму (macOS) — повертає його ж без обгортання', async () => {
    const iterable = toAsyncIterable(['a.txt', 'b.txt'])
    const resolved = await resolveGlobScan(iterable)
    expect(resolved).toBe(iterable)
  })

  test('Promise<async-iterable> (self-hosted Linux Bun 1.3.14) — резолвиться перед поверненням', async () => {
    const iterable = toAsyncIterable(['x.txt'])
    const resolved = await resolveGlobScan(Promise.resolve(iterable))
    expect(resolved).toBe(iterable)
  })
})

describe('scanGlob', () => {
  test('Bun-гілка: scan() повертає async-iterable напряму', async () => {
    const bun = fakeBun(({ cwd }) => {
      expect(cwd).toBe('/repo')
      return toAsyncIterable(['a.txt', 'b.txt'])
    })
    const results = await Array.fromAsync(scanGlob('*.txt', '/repo', { bun }))
    expect(results).toEqual(['a.txt', 'b.txt'])
  })

  test('Bun-гілка: scan(), що повертає Promise<async-iterable> — не падає', async () => {
    const bun = fakeBun(() => Promise.resolve(toAsyncIterable(['x.txt'])))
    const results = await Array.fromAsync(scanGlob('*.txt', '/repo', { bun }))
    expect(results).toEqual(['x.txt'])
  })

  test('Node-фолбек (без ін’єкції bun і без глобала Bun) використовує node:fs/promises#glob', async () => {
    await withTmpDir(async dir => {
      await mkdir(join(dir, 'pkg'), { recursive: true })
      await writeFile(join(dir, 'pkg', 'package.json'), '{}\n')
      const results = await Array.fromAsync(scanGlob('*/package.json', dir))
      expect(results).toEqual(['pkg/package.json'])
    })
  })
})

describe('hasIgnoredPathSegment', () => {
  test('шлях із службовим сегментом ігнорується', () => {
    expect(hasIgnoredPathSegment('a/node_modules/b', ['node_modules'])).toBe(true)
  })

  test('шлях без службового сегмента — не ігнорується', () => {
    expect(hasIgnoredPathSegment('a/b/c', ['node_modules'])).toBe(false)
  })

  test('нормалізує `\\` до `/` перед перевіркою сегментів', () => {
    expect(hasIgnoredPathSegment(String.raw`a\node_modules\b`, ['node_modules'])).toBe(true)
  })
})
