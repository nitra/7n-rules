/**
 * Тести concern-а `hasura/internal_urls`: парсер внутрішнього URL, фільтр
 * `*.env`, гілки nitra/abie, збіг `service`/`namespace` з
 * `hasura/k8s/base/{svc-hl,namespace}.yaml`.
 *
 * Прогін — через `runConcernDetector` (dispatch-рівень), не пряма функція: JS
 * `main.mjs` видалений (I1 фази 5 батчу 4, YAML-кластер частина 2), concern
 * тепер живе лише в `crates/rules-core/src/concerns/hasura_internal_urls.rs`
 * і виконується через native-гілку `runConcernDetector`. Юніт-покриття
 * чистих функцій (`parseInternalHasuraEndpoint`, `isEnvFile`,
 * `isNitraOrAbieRepository`) лишається в native-тестах ported-модуля.
 */
import { describe, expect, test } from 'vitest'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { runConcernDetector } from '../../../../scripts/lib/lint-surface/detect.mjs'
import { withTmpDir, writeJson } from '../../../../scripts/utils/test-helpers.mjs'

/** Абсолютний шлях теки концерну (тека з `concern.json`, без main.mjs — native-порт). */
const CONCERN_DIR = join(dirname(fileURLToPath(import.meta.url)), '..')
const CONCERN = { dir: CONCERN_DIR }

const check = async dir => {
  const result = await runConcernDetector(CONCERN, {
    cwd: dir,
    ruleId: 'hasura',
    concernId: 'internal_urls',
    files: undefined
  })
  return result.violations
}

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
      const violations = await check(dir)
      expect(violations.length).toBeGreaterThan(0)
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
      const violations = await check(dir)
      expect(violations.length).toBeGreaterThan(0)
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
      const violations = await check(dir)
      expect(violations.length).toBeGreaterThan(0)
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
      const violations = await check(dir)
      expect(violations.length).toBeGreaterThan(0)
    })
  })
})
