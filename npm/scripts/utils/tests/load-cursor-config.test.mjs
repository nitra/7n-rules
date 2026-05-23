/**
 * Тести `loadCursorIgnorePaths` — читання поля `ignore` з `.n-cursor.json`,
 * нормалізація шляхів, безпечна поведінка за відсутності файлу/поля.
 */
import { describe, expect, test } from 'bun:test'
import { writeFile } from 'node:fs/promises'
import { sep } from 'node:path'

import { withTmpCwd, writeJson } from '../test-helpers.mjs'
import { loadCursorIgnorePaths } from '../load-cursor-config.mjs'

const TRAILING_SLASH_RE = /\/$/

/**
 * @param {string} p posix-шлях
 * @returns {string} платформозалежний шлях для побудови очікуваного абсолютного шляху
 */
function nativeJoin(...p) {
  return p.join(sep)
}

describe('loadCursorIgnorePaths', () => {
  test('повертає [] якщо .n-cursor.json відсутній', async () => {
    await withTmpCwd(async dir => {
      const out = await loadCursorIgnorePaths(dir)
      expect(out).toEqual([])
    })
  })

  test('повертає [] якщо поле ignore відсутнє', async () => {
    await withTmpCwd(async dir => {
      await writeJson('.n-cursor.json', { rules: ['k8s'] })
      const out = await loadCursorIgnorePaths(dir)
      expect(out).toEqual([])
    })
  })

  test('повертає [] якщо ignore не масив', async () => {
    await withTmpCwd(async dir => {
      await writeJson('.n-cursor.json', { rules: [], ignore: 'oops' })
      const out = await loadCursorIgnorePaths(dir)
      expect(out).toEqual([])
    })
  })

  test('повертає [] якщо .n-cursor.json — невалідний JSON', async () => {
    await withTmpCwd(async dir => {
      await writeFile('.n-cursor.json', '{ not: json', 'utf8')
      const out = await loadCursorIgnorePaths(dir)
      expect(out).toEqual([])
    })
  })

  test('нормалізує відносні шляхи в абсолютні posix без trailing-slash', async () => {
    await withTmpCwd(async dir => {
      await writeJson('.n-cursor.json', {
        rules: [],
        ignore: ['vendor/chart', 'postgres-master/', 'a/b/c']
      })
      const out = await loadCursorIgnorePaths(dir)
      const expectedDir = dir.split(sep).join('/').replace(TRAILING_SLASH_RE, '')
      expect(out).toEqual([`${expectedDir}/vendor/chart`, `${expectedDir}/postgres-master`, `${expectedDir}/a/b/c`])
    })
  })

  test('пропускає не-рядкові й порожні елементи', async () => {
    await withTmpCwd(async dir => {
      await writeJson('.n-cursor.json', {
        rules: [],
        ignore: ['vendor', '', '   ', 42, null, { x: 1 }, 'ok']
      })
      const out = await loadCursorIgnorePaths(dir)
      const expectedDir = dir.split(sep).join('/').replace(TRAILING_SLASH_RE, '')
      expect(out).toEqual([`${expectedDir}/vendor`, `${expectedDir}/ok`])
    })
  })

  test('абсолютні шляхи з конфігу залишаються абсолютними', async () => {
    await withTmpCwd(async dir => {
      const abs = nativeJoin(dir, 'absolute-target')
      await writeJson('.n-cursor.json', { rules: [], ignore: [abs] })
      const out = await loadCursorIgnorePaths(dir)
      const expected = abs.split(sep).join('/').replace(TRAILING_SLASH_RE, '')
      expect(out).toEqual([expected])
    })
  })
})
