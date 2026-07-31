/**
 * Тести concern-а abie/hc_pairing: для кожної директорії з `kind: Deployment` під `k8s/`
 * має існувати hc.yaml поруч із коректним modeline (yaml-language-server $schema).
 *
 * Прогін — через `runConcernDetector` (dispatch-рівень), не пряма функція: JS
 * `main.mjs` видалений (H1 фази 5 батчу 4, YAML-кластер частина 1), concern тепер
 * живе лише в `crates/rules-core/src/concerns/abie_hc_pairing.rs` і виконується
 * через native-гілку `runConcernDetector`. Lib-модулі `../lib/hc-yaml.mjs` і
 * `../lib/k8s-tree.mjs` видалені разом із трьома main.mjs H1-кластеру — єдиними
 * їхніми споживачами (перевірено grep-ом по всьому `npm/`); еквівалентне
 * юніт-покриття лишається в native-тестах ported-модулів (`abie_hc_yaml.rs`,
 * `abie_k8s_tree.rs`).
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

// Короткий формат ruleId/concernId — узгоджений з `NATIVE_CONCERNS` (`abie/hc_pairing`).
const ruleId = 'abie'
const concernId = 'hc_pairing'
const run = dir => runConcernDetector(CONCERN, { cwd: dir, ruleId, concernId, files: undefined })

/** Очікуваний URL `$schema` для hc.yaml (abie.mdc) — дзеркало колишнього `ABIE_HC_SCHEMA_URL`. */
const ABIE_HC_SCHEMA_URL = 'https://datreeio.github.io/CRDs-catalog/networking.gke.io/healthcheckpolicy_v1.json'

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
  test('репозиторій без k8s/-дерева → clean (skip)', async () => {
    await withTmpDir(async dir => {
      const result = await run(dir)
      expect(result.violations).toEqual([])
    })
  })

  test('Deployment + валідний hc.yaml поруч → clean', async () => {
    await withTmpDir(async dir => {
      const k8s = join(dir, 'pkg/k8s')
      await ensureDir(k8s)
      await writeFile(join(k8s, 'deploy.yaml'), DEPLOYMENT_YAML, 'utf8')
      await writeFile(join(k8s, 'hc.yaml'), VALID_HC, 'utf8')
      const result = await run(dir)
      expect(result.violations).toEqual([])
    })
  })

  test('Deployment без hc.yaml поруч → violation', async () => {
    await withTmpDir(async dir => {
      const k8s = join(dir, 'pkg/k8s')
      await ensureDir(k8s)
      await writeFile(join(k8s, 'deploy.yaml'), DEPLOYMENT_YAML, 'utf8')
      const result = await run(dir)
      expect(result.violations.length).toBeGreaterThan(0)
    })
  })

  test('Deployment + hc.yaml з невірним $schema → violation', async () => {
    await withTmpDir(async dir => {
      const k8s = join(dir, 'pkg/k8s')
      await ensureDir(k8s)
      await writeFile(join(k8s, 'deploy.yaml'), DEPLOYMENT_YAML, 'utf8')
      await writeFile(
        join(k8s, 'hc.yaml'),
        '# yaml-language-server: $schema=https://example.com/wrong.json\napiVersion: x\n',
        'utf8'
      )
      const result = await run(dir)
      expect(result.violations.length).toBeGreaterThan(0)
    })
  })

  test('k8s/-дерево без Deployment (тільки Service) → clean (skip)', async () => {
    await withTmpDir(async dir => {
      const k8s = join(dir, 'pkg/k8s')
      await ensureDir(k8s)
      await writeFile(join(k8s, 'svc.yaml'), 'apiVersion: v1\nkind: Service\nmetadata: { name: x }\n', 'utf8')
      const result = await run(dir)
      expect(result.violations).toEqual([])
    })
  })

  test('два пакети — лише один без hc.yaml → violation', async () => {
    await withTmpDir(async dir => {
      const a = join(dir, 'pkg-a/k8s')
      const b = join(dir, 'pkg-b/k8s')
      await ensureDir(a)
      await ensureDir(b)
      await writeFile(join(a, 'deploy.yaml'), DEPLOYMENT_YAML, 'utf8')
      await writeFile(join(a, 'hc.yaml'), VALID_HC, 'utf8')
      await writeFile(join(b, 'deploy.yaml'), DEPLOYMENT_YAML, 'utf8')
      const result = await run(dir)
      expect(result.violations.length).toBeGreaterThan(0)
    })
  })
})
