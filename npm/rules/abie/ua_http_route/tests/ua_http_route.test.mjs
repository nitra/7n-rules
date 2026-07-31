/**
 * Тести concern-а abie/ua_http_route: коли в пакеті (батько `k8s/`) є `vite.config.*`,
 * у `…/k8s/ua/kustomization.yaml` має бути inline patch HTTPRoute (hostnames+parentRefs.namespace).
 * Без vite.config — patch не вимагається. Без ua/kustomization.yaml взагалі — skip.
 *
 * Прогін — через `runConcernDetector` (dispatch-рівень), не пряма функція: JS
 * `main.mjs` видалений (H1 фази 5 батчу 4, YAML-кластер частина 1), concern тепер
 * живе лише в `crates/rules-core/src/concerns/abie_ua_http_route.rs` і
 * виконується через native-гілку `runConcernDetector`. Lib-модулі
 * `../lib/http-route.mjs`, `../lib/k8s-tree.mjs`,
 * `../lib/kustomization-patches.mjs`, `../lib/overlay-paths.mjs` видалені
 * разом із трьома main.mjs H1-кластеру — єдиними їхніми споживачами
 * (перевірено grep-ом по всьому `npm/`); еквівалентне юніт-покриття
 * лишається в native-тестах ported-модулів.
 */
import { describe, expect, test } from 'vitest'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chmod, writeFile } from 'node:fs/promises'
import { cwd as processCwd, platform } from 'node:process'

import { runConcernDetector } from '../../../../scripts/lib/lint-surface/detect.mjs'
import { ensureDir, withTmpDir } from '../../../../scripts/utils/test-helpers.mjs'

/** Абсолютний шлях теки концерну (тека з `concern.json`, без main.mjs — native-порт). */
const CONCERN_DIR = join(dirname(fileURLToPath(import.meta.url)), '..')
const CONCERN = { dir: CONCERN_DIR }

// Короткий формат ruleId/concernId — узгоджений з `NATIVE_CONCERNS` (`abie/ua_http_route`).
const ruleId = 'abie'
const concernId = 'ua_http_route'
const run = dir => runConcernDetector(CONCERN, { cwd: dir, ruleId, concernId, files: undefined })

const KUSTOMIZATION_WITH_VALID_PATCH = `apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
resources:
  - ../base
patches:
  - target: { kind: HTTPRoute, name: api-route }
    patch: |
      - op: replace
        path: /spec/hostnames
        value:
          - api.abie.app
      - op: replace
        path: /spec/parentRefs/0/namespace
        value: ua
`

const KUSTOMIZATION_WITHOUT_HOSTNAMES = `apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
resources:
  - ../base
patches:
  - target: { kind: HTTPRoute, name: api-route }
    patch: |
      - op: replace
        path: /spec/parentRefs/0/namespace
        value: ua
`

describe('abie ua_http_route concern', () => {
  test('немає ua/kustomization.yaml → clean (skip)', async () => {
    await withTmpDir(async dir => {
      const result = await run(dir)
      expect(result.violations).toEqual([])
    })
  })

  test('ua/kustomization.yaml без vite.config → clean (skip per-file)', async () => {
    await withTmpDir(async dir => {
      const ua = join(dir, 'pkg/k8s/ua')
      await ensureDir(ua)
      await writeFile(join(ua, 'kustomization.yaml'), KUSTOMIZATION_WITH_VALID_PATCH, 'utf8')
      // У pkg/ немає vite.config.* → HTTPRoute patch не вимагається
      const result = await run(dir)
      expect(result.violations).toEqual([])
    })
  })

  test('vite.config.js + валідний HTTPRoute patch → clean', async () => {
    await withTmpDir(async dir => {
      const pkg = join(dir, 'pkg')
      const ua = join(pkg, 'k8s/ua')
      await ensureDir(ua)
      await writeFile(join(pkg, 'vite.config.js'), 'export default {}\n', 'utf8')
      await writeFile(join(ua, 'kustomization.yaml'), KUSTOMIZATION_WITH_VALID_PATCH, 'utf8')
      const result = await run(dir)
      expect(result.violations).toEqual([])
    })
  })

  test('vite.config.mjs + patch без hostnames → violation', async () => {
    await withTmpDir(async dir => {
      const pkg = join(dir, 'pkg')
      const ua = join(pkg, 'k8s/ua')
      await ensureDir(ua)
      await writeFile(join(pkg, 'vite.config.mjs'), 'export default {}\n', 'utf8')
      await writeFile(join(ua, 'kustomization.yaml'), KUSTOMIZATION_WITHOUT_HOSTNAMES, 'utf8')
      const result = await run(dir)
      expect(result.violations.length).toBeGreaterThan(0)
    })
  })

  test('vite.config.ts + ua/kustomization.yaml без жодного HTTPRoute patch → violation', async () => {
    await withTmpDir(async dir => {
      const pkg = join(dir, 'pkg')
      const ua = join(pkg, 'k8s/ua')
      await ensureDir(ua)
      await writeFile(join(pkg, 'vite.config.ts'), 'export default {}\n', 'utf8')
      await writeFile(
        join(ua, 'kustomization.yaml'),
        'apiVersion: kustomize.config.k8s.io/v1beta1\nkind: Kustomization\nresources:\n  - ../base\n',
        'utf8'
      )
      const result = await run(dir)
      expect(result.violations.length).toBeGreaterThan(0)
    })
  })

  test('lint() — реальний cwd npm/ (немає ua/kustomization.yaml) → clean', async () => {
    // npm/ не має ua/kustomization.yaml → швидко повертає clean
    const result = await run(processCwd())
    expect(result.violations).toEqual([])
  })

  test('readFile fails → catch (violation)', async () => {
    if (platform === 'win32') {
      expect(platform).toBe('win32')
      return
    }
    await withTmpDir(async dir => {
      const pkg = join(dir, 'pkg')
      const ua = join(pkg, 'k8s/ua')
      await ensureDir(ua)
      await writeFile(join(pkg, 'vite.config.js'), 'export default {}\n', 'utf8')
      const kusto = join(ua, 'kustomization.yaml')
      await writeFile(kusto, KUSTOMIZATION_WITH_VALID_PATCH, 'utf8')
      await chmod(kusto, 0o000)
      try {
        const result = await run(dir)
        expect(result.violations.length).toBeGreaterThan(0)
      } finally {
        await chmod(kusto, 0o644)
      }
    })
  })
})
