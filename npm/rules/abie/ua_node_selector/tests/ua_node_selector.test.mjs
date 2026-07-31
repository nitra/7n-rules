/**
 * Тести concern-а abie/ua_node_selector: коли в дереві `…/k8s/` пакета є `Deployment`,
 * у `…/k8s/ua/kustomization.yaml` має бути inline patch на `Deployment` з
 * `path: /spec/template/spec/nodeSelector` і `preem: false`.
 *
 * Прогін — через `runConcernDetector` (dispatch-рівень), не пряма функція: JS
 * `main.mjs` видалений (H1 фази 5 батчу 4, YAML-кластер частина 1), concern тепер
 * живе лише в `crates/rules-core/src/concerns/abie_ua_node_selector.rs` і
 * виконується через native-гілку `runConcernDetector`. Lib-модулі
 * `../lib/k8s-tree.mjs`, `../lib/kustomization-patches.mjs`,
 * `../lib/overlay-paths.mjs` видалені разом із трьома main.mjs H1-кластеру —
 * єдиними їхніми споживачами (перевірено grep-ом по всьому `npm/`);
 * еквівалентне юніт-покриття лишається в native-тестах ported-модулів.
 */
import { describe, expect, test } from 'vitest'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { writeFile } from 'node:fs/promises'

import { runConcernDetector } from '../../../../scripts/lib/lint-surface/detect.mjs'
import { ensureDir, withTmpDir } from '../../../../scripts/utils/test-helpers.mjs'

/** Абсолютний шлях теки концерну (тека з `concern.json`, без main.mjs — native-порт). */
const CONCERN_DIR = join(dirname(fileURLToPath(import.meta.url)), '..')
const CONCERN = { dir: CONCERN_DIR }

// Короткий формат ruleId/concernId — узгоджений з `NATIVE_CONCERNS` (`abie/ua_node_selector`).
const ruleId = 'abie'
const concernId = 'ua_node_selector'
const run = dir => runConcernDetector(CONCERN, { cwd: dir, ruleId, concernId, files: undefined })

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
  test('немає Deployment у k8s/ → clean (skip)', async () => {
    await withTmpDir(async dir => {
      const result = await run(dir)
      expect(result.violations).toEqual([])
    })
  })

  test('Deployment + правильний ua/kustomization.yaml patch → clean', async () => {
    await withTmpDir(async dir => {
      const base = join(dir, 'pkg/k8s/base')
      const ua = join(dir, 'pkg/k8s/ua')
      await ensureDir(base)
      await ensureDir(ua)
      await writeFile(join(base, 'deploy.yaml'), DEPLOYMENT_YAML, 'utf8')
      await writeFile(join(ua, 'kustomization.yaml'), KUSTOMIZATION_WITH_NODE_SELECTOR_PATCH, 'utf8')
      const result = await run(dir)
      expect(result.violations).toEqual([])
    })
  })

  test('Deployment, але немає жодного ua/kustomization.yaml → violation', async () => {
    await withTmpDir(async dir => {
      const base = join(dir, 'pkg/k8s/base')
      await ensureDir(base)
      await writeFile(join(base, 'deploy.yaml'), DEPLOYMENT_YAML, 'utf8')
      const result = await run(dir)
      expect(result.violations.length).toBeGreaterThan(0)
    })
  })

  test('Deployment + ua/kustomization.yaml без patch → violation', async () => {
    await withTmpDir(async dir => {
      const base = join(dir, 'pkg/k8s/base')
      const ua = join(dir, 'pkg/k8s/ua')
      await ensureDir(base)
      await ensureDir(ua)
      await writeFile(join(base, 'deploy.yaml'), DEPLOYMENT_YAML, 'utf8')
      await writeFile(join(ua, 'kustomization.yaml'), KUSTOMIZATION_WITHOUT_PATCH, 'utf8')
      const result = await run(dir)
      expect(result.violations.length).toBeGreaterThan(0)
    })
  })

  test('ua/kustomization.yaml для пакета без Deployment у k8s/ → clean (skip per-file)', async () => {
    // Виносимо Deployment у інший пакет, щоб глобально size > 0,
    // але overlay для pkg-b/k8s/ua/kustomization.yaml не вимагає patch.
    await withTmpDir(async dir => {
      await ensureDir(join(dir, 'pkg-a/k8s/base'))
      await writeFile(join(dir, 'pkg-a/k8s/base/deploy.yaml'), DEPLOYMENT_YAML, 'utf8')
      await ensureDir(join(dir, 'pkg-a/k8s/ua'))
      await writeFile(join(dir, 'pkg-a/k8s/ua/kustomization.yaml'), KUSTOMIZATION_WITH_NODE_SELECTOR_PATCH, 'utf8')

      await ensureDir(join(dir, 'pkg-b/k8s/ua'))
      await writeFile(join(dir, 'pkg-b/k8s/ua/kustomization.yaml'), KUSTOMIZATION_WITHOUT_PATCH, 'utf8')
      // pkg-b не має Deployment → patch не вимагається → clean загалом
      const result = await run(dir)
      expect(result.violations).toEqual([])
    })
  })
})
