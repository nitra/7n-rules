/**
 * E2E-тести gated detector-а `k8s/hasura_configmap` (`lint(ctx)` з власного `main.mjs`):
 * підтверджують, що cross-file JS-гейт (пара ConfigMap↔Hasura Deployment) справді працює
 * як самостійний detector, а не лише як internal-виклик з `k8s/manifests`. Без `conftest`
 * у PATH прогін пропускається (як у `k8s/dremio_logging`-тестах).
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

const VALID_HASURA_CONFIGMAP = `apiVersion: v1
kind: ConfigMap
metadata:
  name: db-h
  namespace: dev
data:
  HASURA_GRAPHQL_ENABLE_REMOTE_SCHEMA_PERMISSIONS: "true"
  HASURA_GRAPHQL_ENABLE_RELAY: "false"
  HASURA_GRAPHQL_ENABLE_TELEMETRY: "false"
  HASURA_GRAPHQL_ENABLED_LOG_TYPES: "startup,http-log"
  HASURA_GRAPHQL_ENABLED_APIS: "metadata,graphql,pgdump"
  HASURA_GRAPHQL_DISABLE_EVENTING: "true"
`

const BROKEN_HASURA_CONFIGMAP = `apiVersion: v1
kind: ConfigMap
metadata:
  name: db-h
  namespace: dev
data:
  HASURA_GRAPHQL_ENABLE_REMOTE_SCHEMA_PERMISSIONS: "true"
  HASURA_GRAPHQL_ENABLE_TELEMETRY: "false"
  HASURA_GRAPHQL_ENABLED_LOG_TYPES: "startup,http-log"
  HASURA_GRAPHQL_ENABLED_APIS: "metadata,graphql,pgdump"
  HASURA_GRAPHQL_DISABLE_EVENTING: "true"
`

const CRONJOB_CONFIGMAP = `apiVersion: v1
kind: ConfigMap
metadata:
  name: assign-request
  namespace: dev
data:
  SOME_ENV: "1"
`

const PLAIN_CRONJOB = `apiVersion: batch/v1
kind: CronJob
metadata:
  name: assign-request
  namespace: dev
spec:
  schedule: "*/5 * * * *"
  jobTemplate:
    spec:
      template:
        spec:
          containers:
            - name: worker
              image: myrepo/assign-request:1.0.0
          restartPolicy: OnFailure
`

describe.skipIf(!hasConftest)('k8s/hasura_configmap lint(ctx)', () => {
  test('CronJob ConfigMap без сусіднього Hasura Deployment — 0 порушень', async () => {
    await withTmpDir(async root => {
      const base = join(root, 'jobs', 'assign-request', 'k8s', 'base')
      await mkdir(base, { recursive: true })
      await writeFile(join(base, 'configmap.yaml'), CRONJOB_CONFIGMAP, 'utf8')
      await writeFile(join(base, 'cronjob.yaml'), PLAIN_CRONJOB, 'utf8')

      const result = await lint({ cwd: root })
      expect(result.violations).toEqual([])
    })
  })

  test('Hasura ConfigMap з усіма обов’язковими env поруч з Hasura Deployment — 0 порушень', async () => {
    await withTmpDir(async root => {
      const base = join(root, 'k8s', 'base')
      await mkdir(base, { recursive: true })
      await writeFile(join(base, 'configmap.yaml'), VALID_HASURA_CONFIGMAP, 'utf8')
      await writeFile(join(base, 'deployment.yaml'), HASURA_DEPLOYMENT, 'utf8')

      const result = await lint({ cwd: root })
      expect(result.violations).toEqual([])
    })
  })

  test('Hasura ConfigMap без обов’язкового env поруч з Hasura Deployment — порушення', async () => {
    await withTmpDir(async root => {
      const base = join(root, 'k8s', 'base')
      await mkdir(base, { recursive: true })
      await writeFile(join(base, 'configmap.yaml'), BROKEN_HASURA_CONFIGMAP, 'utf8')
      await writeFile(join(base, 'deployment.yaml'), HASURA_DEPLOYMENT, 'utf8')

      const result = await lint({ cwd: root })
      expect(result.violations.length).toBeGreaterThan(0)
      expect(result.violations[0].reason).toBe('hasura-configmap-env')
    })
  })
})
