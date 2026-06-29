/**
 * Тести concern-а abie/js/ua_node_selector: коли в дереві `…/k8s/` пакета є `Deployment`,
 * у `…/k8s/ua/kustomization.yaml` має бути inline patch на `Deployment` з
 * `path: /spec/template/spec/nodeSelector` і `preem: false`.
 */
import { describe, expect, test } from 'vitest'
import { join } from 'node:path'
import { writeFile } from 'node:fs/promises'

import { main as check } from '../main.mjs'
import { ensureDir, withTmpDir } from '../../../../scripts/utils/test-helpers.mjs'

const DEPLOYMENT_YAML = `apiVersion: apps/v1
kind: Deployment
metadata: { name: api }
spec:
  template:
    metadata: { labels: { app: api } }
    spec: { containers: [{ name: api, image: example/api:latest }] }
`

const KUSTOMIZATION_WITH_NODE_SELECTOR_PATCH = `apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
resources:
  - ../base
patches:
  - target: { kind: Deployment }
    patch: |
      - op: add
        path: /spec/template/spec/nodeSelector
        value:
          preem: 'false'
`

const KUSTOMIZATION_WITHOUT_PATCH = `apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
resources:
  - ../base
`

describe('abie ua_node_selector concern', () => {
  test('немає Deployment у k8s/ → 0 (skip)', async () => {
    await withTmpDir(async dir => {
      expect(await check(dir)).toBe(0)
    })
  })

  test('Deployment + правильний ua/kustomization.yaml patch → 0', async () => {
    await withTmpDir(async dir => {
      const base = join(dir, 'pkg/k8s/base')
      const ua = join(dir, 'pkg/k8s/ua')
      await ensureDir(base)
      await ensureDir(ua)
      await writeFile(join(base, 'deploy.yaml'), DEPLOYMENT_YAML, 'utf8')
      await writeFile(join(ua, 'kustomization.yaml'), KUSTOMIZATION_WITH_NODE_SELECTOR_PATCH, 'utf8')
      expect(await check(dir)).toBe(0)
    })
  })

  test('Deployment, але немає жодного ua/kustomization.yaml → 1', async () => {
    await withTmpDir(async dir => {
      const base = join(dir, 'pkg/k8s/base')
      await ensureDir(base)
      await writeFile(join(base, 'deploy.yaml'), DEPLOYMENT_YAML, 'utf8')
      expect(await check(dir)).toBe(1)
    })
  })

  test('Deployment + ua/kustomization.yaml без patch → 1', async () => {
    await withTmpDir(async dir => {
      const base = join(dir, 'pkg/k8s/base')
      const ua = join(dir, 'pkg/k8s/ua')
      await ensureDir(base)
      await ensureDir(ua)
      await writeFile(join(base, 'deploy.yaml'), DEPLOYMENT_YAML, 'utf8')
      await writeFile(join(ua, 'kustomization.yaml'), KUSTOMIZATION_WITHOUT_PATCH, 'utf8')
      expect(await check(dir)).toBe(1)
    })
  })

  test('ua/kustomization.yaml для пакета без Deployment у k8s/ → 0 (skip per-file)', async () => {
    // Виносимо Deployment у інший пакет, щоб глобально size > 0,
    // але overlay для pkg-b/k8s/ua/kustomization.yaml не вимагає patch.
    await withTmpDir(async dir => {
      await ensureDir(join(dir, 'pkg-a/k8s/base'))
      await writeFile(join(dir, 'pkg-a/k8s/base/deploy.yaml'), DEPLOYMENT_YAML, 'utf8')
      await ensureDir(join(dir, 'pkg-a/k8s/ua'))
      await writeFile(join(dir, 'pkg-a/k8s/ua/kustomization.yaml'), KUSTOMIZATION_WITH_NODE_SELECTOR_PATCH, 'utf8')

      await ensureDir(join(dir, 'pkg-b/k8s/ua'))
      await writeFile(join(dir, 'pkg-b/k8s/ua/kustomization.yaml'), KUSTOMIZATION_WITHOUT_PATCH, 'utf8')
      // pkg-b не має Deployment → patch не вимагається → exit 0 загалом
      expect(await check(dir)).toBe(0)
    })
  })
})
