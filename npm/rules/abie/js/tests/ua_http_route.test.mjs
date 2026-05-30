/**
 * Тести concern-а abie/js/ua_http_route: коли в пакеті (батько `k8s/`) є `vite.config.*`,
 * у `…/k8s/ua/kustomization.yaml` має бути inline patch HTTPRoute (hostnames+parentRefs.namespace).
 * Без vite.config — patch не вимагається. Без ua/kustomization.yaml взагалі — skip.
 */
import { describe, expect, test } from 'vitest'
import { join } from 'node:path'
import { chmod, writeFile } from 'node:fs/promises'
import { platform } from 'node:process'

import { check } from '../ua_http_route.mjs'
import { ensureDir, withTmpDir } from '../../../../scripts/utils/test-helpers.mjs'

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
  test('немає ua/kustomization.yaml → 0 (skip)', async () => {
    await withTmpDir(async dir => {
      expect(await check(dir)).toBe(0)
    })
  })

  test('ua/kustomization.yaml без vite.config → 0 (skip per-file)', async () => {
    await withTmpDir(async dir => {
      const ua = join(dir, 'pkg/k8s/ua')
      await ensureDir(ua)
      await writeFile(join(ua, 'kustomization.yaml'), KUSTOMIZATION_WITH_VALID_PATCH, 'utf8')
      // У pkg/ немає vite.config.* → HTTPRoute patch не вимагається
      expect(await check(dir)).toBe(0)
    })
  })

  test('vite.config.js + валідний HTTPRoute patch → 0', async () => {
    await withTmpDir(async dir => {
      const pkg = join(dir, 'pkg')
      const ua = join(pkg, 'k8s/ua')
      await ensureDir(ua)
      await writeFile(join(pkg, 'vite.config.js'), 'export default {}\n', 'utf8')
      await writeFile(join(ua, 'kustomization.yaml'), KUSTOMIZATION_WITH_VALID_PATCH, 'utf8')
      expect(await check(dir)).toBe(0)
    })
  })

  test('vite.config.mjs + patch без hostnames → 1', async () => {
    await withTmpDir(async dir => {
      const pkg = join(dir, 'pkg')
      const ua = join(pkg, 'k8s/ua')
      await ensureDir(ua)
      await writeFile(join(pkg, 'vite.config.mjs'), 'export default {}\n', 'utf8')
      await writeFile(join(ua, 'kustomization.yaml'), KUSTOMIZATION_WITHOUT_HOSTNAMES, 'utf8')
      expect(await check(dir)).toBe(1)
    })
  })

  test('vite.config.ts + ua/kustomization.yaml без жодного HTTPRoute patch → 1', async () => {
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
      expect(await check(dir)).toBe(1)
    })
  })

  test('check() — default cwd (line 33)', async () => {
    // npm/ має немає ua/kustomization.yaml → швидко повертає 0
    expect(await check()).toBe(0)
  })

  test('readFile fails → catch (lines 77-79)', async () => {
    if (platform === 'win32') { expect(true).toBe(true); return }
    await withTmpDir(async dir => {
      const pkg = join(dir, 'pkg')
      const ua = join(pkg, 'k8s/ua')
      await ensureDir(ua)
      await writeFile(join(pkg, 'vite.config.js'), 'export default {}\n', 'utf8')
      const kusto = join(ua, 'kustomization.yaml')
      await writeFile(kusto, KUSTOMIZATION_WITH_VALID_PATCH, 'utf8')
      await chmod(kusto, 0o000)
      try {
        expect(await check(dir)).toBe(1)
      } finally {
        await chmod(kusto, 0o644)
      }
    })
  })
})
