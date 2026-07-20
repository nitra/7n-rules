/**
 * Модульні тести для сканування заборонених імпортів `ioredis` / `node-redis` / `redis` /
 * `@redis/*` (js-bun-redis.mdc), парсер — oxc-parser.
 */
import { describe, expect, test } from 'vitest'

import { findRedisImportsInText, isRedisScanSourceFile, shouldSkipFileForRedisScan } from '../redis-imports.mjs'

describe('redis-imports (oxc)', () => {
  test('default import з ioredis', () => {
    const hits = findRedisImportsInText(`import Redis from 'ioredis'\n`, 'x.ts')
    expect(hits.length).toBe(1)
    expect(hits[0].module).toBe('ioredis')
    expect(hits[0].line).toBe(1)
  })

  test('named import з redis (node-redis v4)', () => {
    const hits = findRedisImportsInText(`import { createClient } from 'redis'\n`, 'x.js')
    expect(hits.length).toBe(1)
    expect(hits[0].module).toBe('redis')
  })

  test('named import з node-redis (історичне імʼя)', () => {
    const hits = findRedisImportsInText(`import { createClient } from 'node-redis'\n`, 'x.ts')
    expect(hits.length).toBe(1)
    expect(hits[0].module).toBe('node-redis')
  })

  test('side-effect import все одно порушення', () => {
    const hits = findRedisImportsInText(`import 'ioredis'\n`, 'x.ts')
    expect(hits.length).toBe(1)
  })

  test('require("ioredis") — порушення', () => {
    const hits = findRedisImportsInText(`const Redis = require('ioredis')\n`, 'x.cjs')
    expect(hits.length).toBe(1)
    expect(hits[0].module).toBe('ioredis')
  })

  test('динамічний import("redis") — порушення', () => {
    const hits = findRedisImportsInText(`const m = await import('redis')\n`, 'x.ts')
    expect(hits.length).toBe(1)
  })

  test('підшлях ioredis/built/utils — порушення', () => {
    const hits = findRedisImportsInText(`import { Buffer } from 'ioredis/built/utils'\n`, 'x.ts')
    expect(hits.length).toBe(1)
    expect(hits[0].module).toBe('ioredis/built/utils')
  })

  test('підпакети @redis/* — порушення', () => {
    const hits = findRedisImportsInText(`import { defineScript } from '@redis/client'\n`, 'x.ts')
    expect(hits.length).toBe(1)
    expect(hits[0].module).toBe('@redis/client')
  })

  test('імпорт redis з bun — без порушень', () => {
    expect(findRedisImportsInText(`import { redis } from 'bun'\n`, 'x.ts').length).toBe(0)
  })

  test('сторонні redis-* (redis-mock) — без порушень', () => {
    expect(findRedisImportsInText(`import RedisMock from 'redis-mock'\n`, 'x.ts').length).toBe(0)
  })

  test('multiline import зберігає номер рядка початку', () => {
    const src = `// header\nimport {\n  createClient\n} from 'redis'\n`
    const hits = findRedisImportsInText(src, 'x.ts')
    expect(hits.length).toBe(1)
    expect(hits[0].line).toBe(2)
  })

  test('isRedisScanSourceFile / shouldSkipFileForRedisScan', () => {
    expect(isRedisScanSourceFile('src/a.ts')).toBe(true)
    expect(isRedisScanSourceFile('src/a.mjs')).toBe(true)
    expect(isRedisScanSourceFile('src/a.tsx')).toBe(true)
    expect(isRedisScanSourceFile('src/a.json')).toBe(false)
    expect(shouldSkipFileForRedisScan('src/a.d.ts')).toBe(true)
    expect(shouldSkipFileForRedisScan('src/a.ts')).toBe(false)
  })
})
