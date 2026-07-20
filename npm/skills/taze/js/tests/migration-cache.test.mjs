/**
 * Тести для skills/taze/js/migration-cache.mjs:
 *   - migrationCacheKey: санітизація (pkg, from, to) у безпечне імʼя файлу;
 *   - readMigrationCache/writeMigrationCache: read-through з інжектованим
 *     fs, побитий/відсутній файл — null, не провал;
 *   - withKnownMigrationNotes: доповнення промпта підсумком кешу.
 */
import { describe, expect, test } from 'vitest'

import {
  migrationCacheKey,
  readMigrationCache,
  withKnownMigrationNotes,
  writeMigrationCache
} from '../migration-cache.mjs'

describe('migrationCacheKey', () => {
  test('санітизує scoped-пакет і версії у безпечне імʼя файлу', () => {
    expect(migrationCacheKey('@7n/tauri-components', '^0.8.0', '^0.11.1')).toBe(
      '@7n-tauri-components@-0.8.0__-0.11.1'
    )
  })

  test('той самий (pkg, from, to) дає той самий ключ незалежно від репо-джерела', () => {
    expect(migrationCacheKey('typer', '0.19.1', '0.27.0')).toBe(migrationCacheKey('typer', '0.19.1', '0.27.0'))
  })
})

describe('readMigrationCache', () => {
  test('відсутній файл → null', async () => {
    const result = await readMigrationCache('pkg', '1.0.0', '2.0.0', {
      existsSyncFn: () => false
    })
    expect(result).toBeNull()
  })

  test('валідний файл → розпарсений запис', async () => {
    const stored = { notes: 'useAgent → useAcpAgent', sourceRepo: '/repo/myllm', updatedAt: '2026-07-19T00:00:00.000Z' }
    const result = await readMigrationCache('@7n/tauri-components', '^0.8.0', '^0.11.1', {
      existsSyncFn: () => true,
      readFileFn: () => JSON.stringify(stored)
    })
    expect(result).toEqual(stored)
  })

  test('побитий JSON → null, не кидає', async () => {
    const result = await readMigrationCache('pkg', '1.0.0', '2.0.0', {
      existsSyncFn: () => true,
      readFileFn: () => '{not-json'
    })
    expect(result).toBeNull()
  })
})

describe('writeMigrationCache', () => {
  test('створює каталог і пише JSON за очікуваним шляхом', async () => {
    const mkdirCalls = []
    const writeCalls = []
    await writeMigrationCache(
      'typer',
      '0.19.1',
      '0.27.0',
      { notes: 'сумісно', sourceRepo: '/tmp/project', updatedAt: '2026-07-19T00:00:00.000Z' },
      {
        cacheDir: '/tmp/cache',
        mkdirFn: (...args) => {
          mkdirCalls.push(args)
        },
        writeFileFn: (...args) => {
          writeCalls.push(args)
        }
      }
    )
    expect(mkdirCalls).toEqual([['/tmp/cache', { recursive: true }]])
    expect(writeCalls).toHaveLength(1)
    expect(writeCalls[0][0]).toBe('/tmp/cache/typer@0.19.1__0.27.0.json')
    expect(JSON.parse(writeCalls[0][1])).toEqual({
      notes: 'сумісно',
      sourceRepo: '/tmp/project',
      updatedAt: '2026-07-19T00:00:00.000Z'
    })
  })
})

describe('withKnownMigrationNotes', () => {
  test('додає секцію з кешованим підсумком і джерелом', () => {
    const prompt = withKnownMigrationNotes('# базовий промпт', {
      notes: 'useAgent видалено, використовуй useAcpAgent',
      sourceRepo: '/Users/dev/vitaliytv/mlmail'
    })
    expect(prompt).toContain('# базовий промпт')
    expect(prompt).toContain('/Users/dev/vitaliytv/mlmail')
    expect(prompt).toContain('useAgent видалено, використовуй useAcpAgent')
    expect(prompt).toContain('пропусти крок 1')
  })
})
