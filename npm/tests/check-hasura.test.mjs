/**
 * Тести check-hasura: парсер внутрішнього URL, фільтр `*.env`, гілки nitra/abie.
 */
import { describe, expect, test } from 'bun:test'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { check, isEnvFile, isNitraOrAbieRepository, parseInternalHasuraEndpoint } from '../scripts/check-hasura.mjs'
import { withTmpCwd, writeJson } from './helpers.mjs'

describe('parseInternalHasuraEndpoint', () => {
  test('валідний внутрішній URL (GKE-style з .internal)', () => {
    // eslint-disable-next-line @microsoft/sdl/no-insecure-url, sonarjs/no-clear-text-protocols -- hasura.mdc вимагає саме http:// для кластерного URL
    const r = parseInternalHasuraEndpoint('http://contract-h.ua-contract.svc.abie-ua.internal:8080')
    expect(r).toEqual({
      ok: true,
      service: 'contract-h',
      namespace: 'ua-contract',
      cluster: 'abie-ua',
      port: '8080'
    })
  })

  test('валідний внутрішній URL (Yandex Cloud, cluster.local)', () => {
    // eslint-disable-next-line @microsoft/sdl/no-insecure-url, sonarjs/no-clear-text-protocols -- hasura.mdc вимагає саме http:// для кластерного URL
    const r = parseInternalHasuraEndpoint('http://apruv-h-hl.ru-apruv.svc.cluster.local:8080')
    expect(r).toEqual({
      ok: true,
      service: 'apruv-h-hl',
      namespace: 'ru-apruv',
      cluster: 'cluster.local',
      port: '8080'
    })
  })

  test('абі-кластери для dev і ua (.internal)', () => {
    // eslint-disable-next-line @microsoft/sdl/no-insecure-url, sonarjs/no-clear-text-protocols -- hasura.mdc вимагає саме http:// для кластерного URL
    const dev = parseInternalHasuraEndpoint('http://apruv-h-hl.dev-apruv.svc.abie-dev.internal:8080')
    expect(dev).toEqual({
      ok: true,
      service: 'apruv-h-hl',
      namespace: 'dev-apruv',
      cluster: 'abie-dev',
      port: '8080'
    })
    // eslint-disable-next-line @microsoft/sdl/no-insecure-url, sonarjs/no-clear-text-protocols -- hasura.mdc вимагає саме http:// для кластерного URL
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
    expect(parseInternalHasuraEndpoint('https://napitkivmeste.tech/contract/ql').ok).toBe(false)
  })

  test('відхиляє http без сегментів кластера', () => {
    expect(parseInternalHasuraEndpoint('http://localhost:8080').ok).toBe(false)
  })

  test('вимагає явний порт', () => {
    // eslint-disable-next-line @microsoft/sdl/no-insecure-url, sonarjs/no-clear-text-protocols -- негативний кейс для http:// формату
    expect(parseInternalHasuraEndpoint('http://h.ns.svc.cl.internal').ok).toBe(false)
  })

  test('відхиляє неочікувані суфікси (svc.example.com)', () => {
    // eslint-disable-next-line @microsoft/sdl/no-insecure-url, sonarjs/no-clear-text-protocols -- негативний кейс
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
    await withTmpCwd(async () => {
      await writeJson('package.json', { name: 't', repository: 'https://github.com/other/foo' })
      await writeFile('dev.env', 'HASURA_GRAPHQL_ENDPOINT=https://example.com/ql\n', 'utf8')
      expect(await check()).toBe(0)
    })
  })

  test('помилка: HASURA_GRAPHQL_ENDPOINT з публічним https URL', async () => {
    await withTmpCwd(async () => {
      await writeJson('package.json', { name: 't', repository: 'https://github.com/abinbevefes/foo' })
      await writeFile('dev.env', 'HASURA_GRAPHQL_ENDPOINT=https://napitkivmeste.tech/contract/ql\n', 'utf8')
      expect(await check()).toBe(1)
    })
  })

  test('успіх: внутрішній кластерний URL без YAML-сервісу', async () => {
    await withTmpCwd(async () => {
      await writeJson('package.json', { name: 't', repository: 'https://github.com/nitra/foo' })
      await writeFile(
        'production.env',
        'HASURA_GRAPHQL_ENDPOINT=http://contract-h.ua-contract.svc.abie-ua.internal:8080\n',
        'utf8'
      )
      expect(await check()).toBe(0)
    })
  })

  test('успіх: cluster.local (Yandex Cloud) у ru.env', async () => {
    await withTmpCwd(async () => {
      await writeJson('package.json', { name: 't', repository: 'https://github.com/abinbevefes/foo' })
      await mkdir('hasura', { recursive: true })
      await writeFile(
        join('hasura', '.ru.env'),
        'HASURA_GRAPHQL_ENDPOINT=http://apruv-h-hl.ru-apruv.svc.cluster.local:8080\n',
        'utf8'
      )
      expect(await check()).toBe(0)
    })
  })

  test('успіх: збіг з metadata.name з svc-hl.yaml і namespace.yaml', async () => {
    await withTmpCwd(async () => {
      await writeJson('package.json', { name: 't', repository: 'https://github.com/abinbevefes/foo' })
      await mkdir(join('hasura', 'k8s', 'base'), { recursive: true })
      await writeFile(
        join('hasura', 'k8s', 'base', 'svc-hl.yaml'),
        'apiVersion: v1\nkind: Service\nmetadata:\n  name: contract-h\nspec:\n  clusterIP: None\n',
        'utf8'
      )
      await writeFile(
        join('hasura', 'k8s', 'base', 'namespace.yaml'),
        'apiVersion: v1\nkind: Namespace\nmetadata:\n  name: ua-contract\n',
        'utf8'
      )
      await writeFile(
        'production.env',
        'HASURA_GRAPHQL_ENDPOINT=http://contract-h.ua-contract.svc.abie-ua.internal:8080\n',
        'utf8'
      )
      expect(await check()).toBe(0)
    })
  })

  test('помилка: service з URL не збігається з svc-hl.yaml', async () => {
    await withTmpCwd(async () => {
      await writeJson('package.json', { name: 't', repository: 'https://github.com/abinbevefes/foo' })
      await mkdir(join('hasura', 'k8s', 'base'), { recursive: true })
      await writeFile(
        join('hasura', 'k8s', 'base', 'svc-hl.yaml'),
        'apiVersion: v1\nkind: Service\nmetadata:\n  name: order-h\n',
        'utf8'
      )
      await writeFile(
        'dev.env',
        'HASURA_GRAPHQL_ENDPOINT=http://contract-h.ua-contract.svc.abie-ua.internal:8080\n',
        'utf8'
      )
      expect(await check()).toBe(1)
    })
  })

  test('відсутність HASURA_GRAPHQL_ENDPOINT у env-файлах не помилка', async () => {
    await withTmpCwd(async () => {
      await writeJson('package.json', { name: 't', repository: 'https://github.com/nitra/foo' })
      await writeFile('dev.env', 'OTHER=value\n', 'utf8')
      expect(await check()).toBe(0)
    })
  })

  test('export HASURA_GRAPHQL_ENDPOINT=... теж розпізнається', async () => {
    await withTmpCwd(async () => {
      await writeJson('package.json', { name: 't', repository: 'https://github.com/nitra/foo' })
      await writeFile('shell.env', 'export HASURA_GRAPHQL_ENDPOINT=https://api.example.com\n', 'utf8')
      expect(await check()).toBe(1)
    })
  })

  test('пропуск без env-файлів', async () => {
    await withTmpCwd(async () => {
      await writeJson('package.json', { name: 't', repository: 'https://github.com/nitra/foo' })
      expect(await check()).toBe(0)
    })
  })

  test('файл .env без імені ігнорується навіть з поганим URL', async () => {
    await withTmpCwd(async () => {
      await writeJson('package.json', { name: 't', repository: 'https://github.com/nitra/foo' })
      await writeFile('.env', 'HASURA_GRAPHQL_ENDPOINT=https://napitkivmeste.tech/contract/ql\n', 'utf8')
      expect(await check()).toBe(0)
    })
  })
})
