import { describe, expect, test } from 'vitest'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { ABIE_SHARED_CROSS_NS_BACKEND_NAMES, analyzeAbieSharedBackendRefsInPackageK8s } from '../http-route.mjs'
import { ensureDir, withTmpDir } from '../../../../scripts/utils/test-helpers.mjs'

describe('ABIE_SHARED_CROSS_NS_BACKEND_NAMES', () => {
  test('канонічні імена', () => {
    expect(ABIE_SHARED_CROSS_NS_BACKEND_NAMES).toContain('auth-run-hl')
    expect(ABIE_SHARED_CROSS_NS_BACKEND_NAMES).toContain('file-link-hl')
  })
})

describe('analyzeAbieSharedBackendRefsInPackageK8s', () => {
  test('без namespace: dev дає помилку; з namespace — OK', async () => {
    await withTmpDir(async dir => {
      const root = dir
      await ensureDir(join(root, 'p/k8s/base'))
      const hrPath = join(root, 'p/k8s/base/hr.yaml')
      await writeFile(
        hrPath,
        `apiVersion: gateway.networking.k8s.io/v1
kind: HTTPRoute
metadata:
  name: x
spec:
  rules:
    - backendRefs:
        - name: auth-run-hl
          port: 8080
`,
        'utf8'
      )
      const yamlFilesAbs = [hrPath]
      const bad = await analyzeAbieSharedBackendRefsInPackageK8s(root, join(root, 'p'), yamlFilesAbs)
      expect(bad.refCount).toBe(1)
      expect(bad.baseErrors.length).toBe(1)
      await writeFile(
        hrPath,
        `apiVersion: gateway.networking.k8s.io/v1
kind: HTTPRoute
metadata:
  name: x
spec:
  rules:
    - backendRefs:
        - name: auth-run-hl
          namespace: dev
          port: 8080
`,
        'utf8'
      )
      const ok = await analyzeAbieSharedBackendRefsInPackageK8s(root, join(root, 'p'), yamlFilesAbs)
      expect(ok.refCount).toBe(1)
      expect(ok.baseErrors.length).toBe(0)
    })
  })

  test('без port: 8080 дає помилку; з неправильним портом — теж', async () => {
    await withTmpDir(async dir => {
      const root = dir
      await ensureDir(join(root, 'p/k8s/base'))
      const hrPath = join(root, 'p/k8s/base/hr.yaml')
      await writeFile(
        hrPath,
        `apiVersion: gateway.networking.k8s.io/v1
kind: HTTPRoute
metadata:
  name: x
spec:
  rules:
    - backendRefs:
        - name: file-link-hl
          namespace: dev
`,
        'utf8'
      )
      const yamlFilesAbs = [hrPath]
      const noPort = await analyzeAbieSharedBackendRefsInPackageK8s(root, join(root, 'p'), yamlFilesAbs)
      expect(noPort.refCount).toBe(1)
      expect(noPort.baseErrors.length).toBe(1)
      expect(noPort.baseErrors[0]).toMatch(/port: 8080/)

      await writeFile(
        hrPath,
        `apiVersion: gateway.networking.k8s.io/v1
kind: HTTPRoute
metadata:
  name: x
spec:
  rules:
    - backendRefs:
        - name: file-link-hl
          namespace: dev
          port: 9090
`,
        'utf8'
      )
      const wrongPort = await analyzeAbieSharedBackendRefsInPackageK8s(root, join(root, 'p'), yamlFilesAbs)
      expect(wrongPort.refCount).toBe(1)
      expect(wrongPort.baseErrors.length).toBe(1)
      expect(wrongPort.baseErrors[0]).toMatch(/port: 8080/)
    })
  })
})
