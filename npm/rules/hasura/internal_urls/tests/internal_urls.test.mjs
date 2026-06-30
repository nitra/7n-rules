/**
 * Тести check-hasura: парсер внутрішнього URL, фільтр `*.env`, гілки nitra/abie.
 */
import { describe, expect, test } from 'vitest'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { lint, isEnvFile, isNitraOrAbieRepository, parseInternalHasuraEndpoint } from '../main.mjs'
import { withTmpDir, writeJson } from '../../../../scripts/utils/test-helpers.mjs'

const check = dir =>
  lint({ cwd: dir, ruleId: 'hasura', concernId: 'internal_urls', files: undefined }).then(r => r.violations)

describe('parseInternalHasuraEndpoint', () => {
  test('валідний внутрішній URL (GKE-style з .internal)', () => {
    const r = parseInternalHasuraEndpoint('http://contract-h-hl.ua-contract.svc.abie-ua.internal:8080')
    expect(r).toEqual({
      ok: true,
      service: 'contract-h-hl',
      namespace: 'ua-contract',
      cluster: 'abie-ua',
      port: '8080'
    })
  })

  test('абі-кластери для dev і ua (.internal)', () => {
    const dev = parseInternalHasuraEndpoint('http://apruv-h-hl.dev-apruv.svc.abie-dev.internal:8080')
    expect(dev).toEqual({
      ok: true,
      service: 'apruv-h-hl',
      namespace: 'dev-apruv',
      cluster: 'abie-dev',
      port: '8080'
    })
    const ua = parseInternalHasuraEndpoint('http://apruv-h-hl.ua-apruv.svc.abie-ua.internal:8080')
    expect(ua).toEqual({
      ok: true,
      service: 'apruv-h-hl',
      namespace: 'ua-apruv',
      cluster: 'abie-ua',
      port: '8080'
    })
  })

  test('відхиляє https зовнішній URL', () => {
    expect(parseInternalHasuraEndpoint('https://vybeerai.com.ua/contract/ql').ok).toBe(false)
  })

  test('відхиляє http без сегментів кластера', () => {
    expect(parseInternalHasuraEndpoint('http://localhost:8080').ok).toBe(false)
  })

  test('вимагає явний порт', () => {
    expect(parseInternalHasuraEndpoint('http://h.ns.svc.cl.internal').ok).toBe(false)
  })

  test('відхиляє неочікувані суфікси (svc.example.com)', () => {
    expect(parseInternalHasuraEndpoint('http://h.ns.svc.example.com:8080').ok).toBe(false)
  })
})

describe('isEnvFile', () => {
  test('базові форми', () => {
    expect(isEnvFile('dev.env')).toBe(true)
    expect(isEnvFile('hasura/production.env')).toBe(true)
    expect(isEnvFile('package.json')).toBe(false)
    expect(isEnvFile('env.json')).toBe(false)
  })

  test('файл .env без імені — виключення з правила', () => {
    expect(isEnvFile('.env')).toBe(false)
    expect(isEnvFile('hasura/.env')).toBe(false)
  })
})

describe('isNitraOrAbieRepository', () => {
  test('детектить nitra і abie', () => {
    expect(isNitraOrAbieRepository('https://github.com/nitra/foo')).toBe(true)
    expect(isNitraOrAbieRepository('https://github.com/abinbevefes/bar')).toBe(true)
    expect(isNitraOrAbieRepository('https://github.com/other/baz')).toBe(false)
    expect(isNitraOrAbieRepository(null)).toBe(false)
  })
})

describe('check-hasura', () => {
  test('пропускає не-nitra/abie проєкти без помилок', async () => {
    await withTmpDir(async dir => {
      await writeJson(join(dir, 'package.json'), { name: 't', repository: 'https://github.com/other/foo' })
      await writeFile(join(dir, 'dev.env'), 'HASURA_GRAPHQL_ENDPOINT=https://example.com/ql\n', 'utf8')
      expect(await check(dir)).toEqual([])
    })
  })

  test('помилка: HASURA_GRAPHQL_ENDPOINT з публічним https URL', async () => {
    await withTmpDir(async dir => {
      await writeJson(join(dir, 'package.json'), { name: 't', repository: 'https://github.com/abinbevefes/foo' })
      await writeFile(join(dir, 'dev.env'), 'HASURA_GRAPHQL_ENDPOINT=https://vybeerai.com.ua/contract/ql\n', 'utf8')
      expect((await check(dir)).length).toBeGreaterThan(0)
    })
  })

  test('успіх: внутрішній кластерний URL без YAML-сервісу', async () => {
    await withTmpDir(async dir => {
      await writeJson(join(dir, 'package.json'), { name: 't', repository: 'https://github.com/nitra/foo' })
      await writeFile(
        join(dir, 'production.env'),
        'HASURA_GRAPHQL_ENDPOINT=http://contract-h-hl.ua-contract.svc.abie-ua.internal:8080\n',
        'utf8'
      )
      expect(await check(dir)).toEqual([])
    })
  })

  test('успіх: збіг з metadata.name з svc-hl.yaml і namespace.yaml', async () => {
    await withTmpDir(async dir => {
      await writeJson(join(dir, 'package.json'), { name: 't', repository: 'https://github.com/abinbevefes/foo' })
      await mkdir(join(dir, 'hasura', 'k8s', 'base'), { recursive: true })
      await writeFile(
        join(dir, 'hasura', 'k8s', 'base', 'svc-hl.yaml'),
        'apiVersion: v1\nkind: Service\nmetadata:\n  name: contract-h-hl\nspec:\n  clusterIP: None\n',
        'utf8'
      )
      await writeFile(
        join(dir, 'hasura', 'k8s', 'base', 'namespace.yaml'),
        'apiVersion: v1\nkind: Namespace\nmetadata:\n  name: ua-contract\n',
        'utf8'
      )
      await writeFile(
        join(dir, 'production.env'),
        'HASURA_GRAPHQL_ENDPOINT=http://contract-h-hl.ua-contract.svc.abie-ua.internal:8080\n',
        'utf8'
      )
      expect(await check(dir)).toEqual([])
    })
  })

  test('помилка: service з URL не збігається з svc-hl.yaml', async () => {
    await withTmpDir(async dir => {
      await writeJson(join(dir, 'package.json'), { name: 't', repository: 'https://github.com/abinbevefes/foo' })
      await mkdir(join(dir, 'hasura', 'k8s', 'base'), { recursive: true })
      await writeFile(
        join(dir, 'hasura', 'k8s', 'base', 'svc-hl.yaml'),
        'apiVersion: v1\nkind: Service\nmetadata:\n  name: order-h\n',
        'utf8'
      )
      await writeFile(
        join(dir, 'dev.env'),
        'HASURA_GRAPHQL_ENDPOINT=http://contract-h-hl.ua-contract.svc.abie-ua.internal:8080\n',
        'utf8'
      )
      expect((await check(dir)).length).toBeGreaterThan(0)
    })
  })

  test('відсутність HASURA_GRAPHQL_ENDPOINT у env-файлах не помилка', async () => {
    await withTmpDir(async dir => {
      await writeJson(join(dir, 'package.json'), { name: 't', repository: 'https://github.com/nitra/foo' })
      await writeFile(join(dir, 'dev.env'), 'OTHER=value\n', 'utf8')
      expect(await check(dir)).toEqual([])
    })
  })

  test('export HASURA_GRAPHQL_ENDPOINT=... теж розпізнається', async () => {
    await withTmpDir(async dir => {
      await writeJson(join(dir, 'package.json'), { name: 't', repository: 'https://github.com/nitra/foo' })
      await writeFile(join(dir, 'shell.env'), 'export HASURA_GRAPHQL_ENDPOINT=https://api.example.com\n', 'utf8')
      expect((await check(dir)).length).toBeGreaterThan(0)
    })
  })

  test('пропуск без env-файлів', async () => {
    await withTmpDir(async dir => {
      await writeJson(join(dir, 'package.json'), { name: 't', repository: 'https://github.com/nitra/foo' })
      expect(await check(dir)).toEqual([])
    })
  })

  test('файл .env без імені ігнорується навіть з поганим URL', async () => {
    await withTmpDir(async dir => {
      await writeJson(join(dir, 'package.json'), { name: 't', repository: 'https://github.com/nitra/foo' })
      await writeFile(join(dir, '.env'), 'HASURA_GRAPHQL_ENDPOINT=https://vybeerai.com.ua/contract/ql\n', 'utf8')
      expect(await check(dir)).toEqual([])
    })
  })

  test('без package.json → пропускає (не nitra/abie) → exit 0', async () => {
    await withTmpDir(async dir => {
      // Без package.json readRootRepositoryUrl повертає null → isNitraOrAbieRepository(null)=false → pass
      await writeFile(join(dir, 'dev.env'), 'HASURA_GRAPHQL_ENDPOINT=https://vybeerai.com.ua/ql\n', 'utf8')
      expect(await check(dir)).toEqual([])
    })
  })

  test('невалідний JSON у package.json → пропускає → exit 0', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'package.json'), '{ broken json', 'utf8')
      await writeFile(join(dir, 'dev.env'), 'HASURA_GRAPHQL_ENDPOINT=https://vybeerai.com.ua/ql\n', 'utf8')
      expect(await check(dir)).toEqual([])
    })
  })

  test('svc-hl.yaml без відповідного ресурсу → service not matched → pass без перевірки', async () => {
    await withTmpDir(async dir => {
      await writeJson(join(dir, 'package.json'), { name: 't', repository: 'https://github.com/abinbevefes/foo' })
      await mkdir(join(dir, 'hasura', 'k8s', 'base'), { recursive: true })
      // YAML без kind: Service або metadata.name → readHasuraK8sResourceName повертає null
      await writeFile(join(dir, 'hasura', 'k8s', 'base', 'svc-hl.yaml'), 'foo: bar\n', 'utf8')
      await writeFile(
        join(dir, 'production.env'),
        'HASURA_GRAPHQL_ENDPOINT=http://contract-h-hl.ua-contract.svc.abie-ua.internal:8080\n',
        'utf8'
      )
      expect(await check(dir)).toEqual([])
    })
  })

  test('service збігається, але namespace не збігається → exit 1', async () => {
    await withTmpDir(async dir => {
      await writeJson(join(dir, 'package.json'), { name: 't', repository: 'https://github.com/abinbevefes/foo' })
      await mkdir(join(dir, 'hasura', 'k8s', 'base'), { recursive: true })
      await writeFile(
        join(dir, 'hasura', 'k8s', 'base', 'svc-hl.yaml'),
        'apiVersion: v1\nkind: Service\nmetadata:\n  name: contract-h-hl\n',
        'utf8'
      )
      await writeFile(
        join(dir, 'hasura', 'k8s', 'base', 'namespace.yaml'),
        'apiVersion: v1\nkind: Namespace\nmetadata:\n  name: ua-wrong-ns\n',
        'utf8'
      )
      await writeFile(
        join(dir, 'production.env'),
        'HASURA_GRAPHQL_ENDPOINT=http://contract-h-hl.ua-contract.svc.abie-ua.internal:8080\n',
        'utf8'
      )
      expect((await check(dir)).length).toBeGreaterThan(0)
    })
  })
})
