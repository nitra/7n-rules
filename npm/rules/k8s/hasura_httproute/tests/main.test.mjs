/**
 * E2E-тести gated detector-а `k8s/hasura_httproute` (`lint(ctx)` з власного `main.mjs`):
 * підтверджують, що cross-file JS-гейт (пара HTTPRoute↔Hasura Deployment за `metadata.name`)
 * справді працює як самостійний detector, а не лише як internal-виклик з `k8s/manifests`.
 * Без `conftest` у PATH прогін пропускається (як у `k8s/dremio_logging`-тестах).
 */
import { describe, expect, test } from 'vitest'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { resolveCmd } from '../../../../scripts/utils/resolve-cmd.mjs'
import { withTmpDir } from '../../../../scripts/utils/test-helpers.mjs'
import { lint } from '../main.mjs'

const hasConftest = Boolean(resolveCmd('conftest'))

const HASURA_DEPLOYMENT = `apiVersion: apps/v1
kind: Deployment
metadata:
  name: db-h
  namespace: dev
spec:
  selector:
    matchLabels:
      app: db-h
  template:
    metadata:
      labels:
        app: db-h
    spec:
      containers:
        - name: h
          image: hasura/graphql-engine:v2.49.0
`

/** Канонічний Hasura HTTPRoute (4 правила, порожній prefix, backend `db-h-hl`). */
const CANONICAL_HTTPROUTE = `apiVersion: gateway.networking.k8s.io/v1
kind: HTTPRoute
metadata:
  name: db-h
  namespace: dev
spec:
  rules:
    - matches:
        - path:
            type: Exact
            value: /ql
      filters:
        - type: RequestRedirect
          requestRedirect:
            path:
              type: ReplaceFullPath
              replaceFullPath: /ql/console
            statusCode: 302
    - matches:
        - path:
            type: Exact
            value: /ql/
      filters:
        - type: RequestRedirect
          requestRedirect:
            path:
              type: ReplaceFullPath
              replaceFullPath: /ql/console
            statusCode: 302
    - matches:
        - path:
            type: PathPrefix
            value: /ql
      filters:
        - type: URLRewrite
          urlRewrite:
            path:
              type: ReplacePrefixMatch
              replacePrefixMatch: /
      backendRefs:
        - name: db-h-hl
          port: 8080
    - matches:
        - path:
            type: PathPrefix
            value: /ql
          headers:
            - type: Exact
              name: Upgrade
              value: websocket
      filters:
        - type: URLRewrite
          urlRewrite:
            path:
              type: ReplacePrefixMatch
              replacePrefixMatch: /
        - type: RequestHeaderModifier
          requestHeaderModifier:
            remove: [Authorization]
      backendRefs:
        - name: db-h-hl
          port: 8080
`

/** Той самий канон, але без правила 2 (`/ql/` redirect) — має провалити rule2_missing. */
const BROKEN_HTTPROUTE = CANONICAL_HTTPROUTE.replace(
  `    - matches:
        - path:
            type: Exact
            value: /ql/
      filters:
        - type: RequestRedirect
          requestRedirect:
            path:
              type: ReplaceFullPath
              replaceFullPath: /ql/console
            statusCode: 302
`,
  ''
)

/** HTTPRoute для звичайного (не-Hasura) сервісу — не має пари з жодним Hasura Deployment. */
const PLAIN_HTTPROUTE = `apiVersion: gateway.networking.k8s.io/v1
kind: HTTPRoute
metadata:
  name: web
  namespace: dev
spec:
  rules:
    - matches:
        - path:
            type: PathPrefix
            value: /
      backendRefs:
        - name: web
          port: 8080
`

describe.skipIf(!hasConftest)('k8s/hasura_httproute lint(ctx)', () => {
  test('HTTPRoute без сусіднього Hasura Deployment — 0 порушень', async () => {
    await withTmpDir(async root => {
      const base = join(root, 'k8s', 'base')
      await mkdir(base, { recursive: true })
      await writeFile(join(base, 'hr.yaml'), PLAIN_HTTPROUTE, 'utf8')

      const result = await lint({ cwd: root })
      expect(result.violations).toEqual([])
    })
  })

  test('канонічний HTTPRoute поруч з Hasura Deployment (той самий name) — 0 порушень', async () => {
    await withTmpDir(async root => {
      const base = join(root, 'k8s', 'base')
      await mkdir(base, { recursive: true })
      await writeFile(join(base, 'hr.yaml'), CANONICAL_HTTPROUTE, 'utf8')
      await writeFile(join(base, 'deployment.yaml'), HASURA_DEPLOYMENT, 'utf8')

      const result = await lint({ cwd: root })
      expect(result.violations).toEqual([])
    })
  })

  test('зламаний канон (без правила 2) поруч з Hasura Deployment — порушення', async () => {
    await withTmpDir(async root => {
      const base = join(root, 'k8s', 'base')
      await mkdir(base, { recursive: true })
      await writeFile(join(base, 'hr.yaml'), BROKEN_HTTPROUTE, 'utf8')
      await writeFile(join(base, 'deployment.yaml'), HASURA_DEPLOYMENT, 'utf8')

      const result = await lint({ cwd: root })
      expect(result.violations.length).toBeGreaterThan(0)
    })
  })
})
