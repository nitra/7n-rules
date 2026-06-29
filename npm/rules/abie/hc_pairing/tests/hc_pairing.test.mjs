/**
 * Тести concern-а abie/js/hc_pairing: для кожної директорії з `kind: Deployment` під `k8s/`
 * має існувати hc.yaml поруч із коректним modeline (yaml-language-server $schema).
 */
import { describe, expect, test } from 'vitest'
import { join } from 'node:path'
import { writeFile } from 'node:fs/promises'

import { main as check } from '../main.mjs'
import { ABIE_HC_SCHEMA_URL } from '../../lib/hc-yaml.mjs'
import { ensureDir, withTmpDir } from '../../../../scripts/utils/test-helpers.mjs'

const DEPLOYMENT_YAML = `apiVersion: apps/v1
kind: Deployment
metadata:
  name: api
spec:
  replicas: 1
  template:
    metadata: { labels: { app: api } }
    spec:
      containers:
        - { name: api, image: example/api:latest }
`

const VALID_HC = `# yaml-language-server: $schema=${ABIE_HC_SCHEMA_URL}
apiVersion: networking.gke.io/v1
kind: HealthCheckPolicy
metadata:
  name: api-hc
spec: { default: { config: { type: HTTP } } }
`

describe('abie hc_pairing concern', () => {
  test('репозиторій без k8s/-дерева → 0 (skip)', async () => {
    await withTmpDir(async dir => {
      expect(await check(dir)).toBe(0)
    })
  })

  test('Deployment + валідний hc.yaml поруч → 0', async () => {
    await withTmpDir(async dir => {
      const k8s = join(dir, 'pkg/k8s')
      await ensureDir(k8s)
      await writeFile(join(k8s, 'deploy.yaml'), DEPLOYMENT_YAML, 'utf8')
      await writeFile(join(k8s, 'hc.yaml'), VALID_HC, 'utf8')
      expect(await check(dir)).toBe(0)
    })
  })

  test('Deployment без hc.yaml поруч → 1', async () => {
    await withTmpDir(async dir => {
      const k8s = join(dir, 'pkg/k8s')
      await ensureDir(k8s)
      await writeFile(join(k8s, 'deploy.yaml'), DEPLOYMENT_YAML, 'utf8')
      expect(await check(dir)).toBe(1)
    })
  })

  test('Deployment + hc.yaml з невірним $schema → 1', async () => {
    await withTmpDir(async dir => {
      const k8s = join(dir, 'pkg/k8s')
      await ensureDir(k8s)
      await writeFile(join(k8s, 'deploy.yaml'), DEPLOYMENT_YAML, 'utf8')
      await writeFile(
        join(k8s, 'hc.yaml'),
        '# yaml-language-server: $schema=https://example.com/wrong.json\napiVersion: x\n',
        'utf8'
      )
      expect(await check(dir)).toBe(1)
    })
  })

  test('k8s/-дерево без Deployment (тільки Service) → 0 (skip)', async () => {
    await withTmpDir(async dir => {
      const k8s = join(dir, 'pkg/k8s')
      await ensureDir(k8s)
      await writeFile(join(k8s, 'svc.yaml'), 'apiVersion: v1\nkind: Service\nmetadata: { name: x }\n', 'utf8')
      expect(await check(dir)).toBe(0)
    })
  })

  test('два пакети — лише один без hc.yaml → 1', async () => {
    await withTmpDir(async dir => {
      const a = join(dir, 'pkg-a/k8s')
      const b = join(dir, 'pkg-b/k8s')
      await ensureDir(a)
      await ensureDir(b)
      await writeFile(join(a, 'deploy.yaml'), DEPLOYMENT_YAML, 'utf8')
      await writeFile(join(a, 'hc.yaml'), VALID_HC, 'utf8')
      await writeFile(join(b, 'deploy.yaml'), DEPLOYMENT_YAML, 'utf8')
      expect(await check(dir)).toBe(1)
    })
  })
})
