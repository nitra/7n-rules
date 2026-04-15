/**
 * Тести check-docker і check-k8s у дереві без відповідних файлів (ранній вихід 0) та JSON6902 у kustomization.
 */
import { describe, expect, test } from 'bun:test'
import { writeFile } from 'node:fs/promises'

import { check as checkDocker } from '../scripts/check-docker.mjs'
import { check as checkK8s } from '../scripts/check-k8s.mjs'
import { ensureDir, withTmpCwd } from './helpers.mjs'

describe('check без цільових файлів', () => {
  test('check-docker — 0, якщо немає Dockerfile', async () => {
    await withTmpCwd(async () => {
      expect(await checkDocker()).toBe(0)
    })
  })

  test('check-k8s — 0, якщо немає yaml під k8s', async () => {
    await withTmpCwd(async () => {
      expect(await checkK8s()).toBe(0)
    })
  })

  test('check-k8s — 1, якщо kustomization з remove+add на той самий path', async () => {
    await withTmpCwd(async () => {
      await ensureDir('app/k8s/ua')
      const depSchema =
        'https://raw.githubusercontent.com/yannh/kubernetes-json-schema/master/v1.33.9-standalone-strict/deployment-apps-v1.json'
      const dep = `# yaml-language-server: $schema=${depSchema}
apiVersion: apps/v1
kind: Deployment
metadata:
  name: x
spec:
  replicas: 1
  selector:
    matchLabels:
      app: x
  template:
    metadata:
      labels:
        app: x
    spec:
      containers:
        - name: c
          image: nginx:1.27
          resources: {}
`
      const k = `# yaml-language-server: $schema=https://json.schemastore.org/kustomization.json
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
namespace: ns1
resources:
  - deploy.yaml
patches:
  - target:
      kind: Deployment
      name: x
    patch: |-
      - op: remove
        path: /spec/template/spec/nodeSelector
      - op: add
        path: /spec/template/spec/nodeSelector
        value:
          preem: "false"
`
      await writeFile('app/k8s/ua/deploy.yaml', dep, 'utf8')
      await writeFile('app/k8s/ua/kustomization.yaml', k, 'utf8')
      expect(await checkK8s()).toBe(1)
    })
  })

  test('check-k8s — 1, якщо patch.target вказує на неіснуючий ресурс', async () => {
    await withTmpCwd(async () => {
      await ensureDir('app/k8s/ua')
      const depSchema =
        'https://raw.githubusercontent.com/yannh/kubernetes-json-schema/master/v1.33.9-standalone-strict/deployment-apps-v1.json'
      const dep = `# yaml-language-server: $schema=${depSchema}
apiVersion: apps/v1
kind: Deployment
metadata:
  name: x
spec:
  replicas: 1
  selector:
    matchLabels:
      app: x
  template:
    metadata:
      labels:
        app: x
    spec:
      containers:
        - name: c
          image: nginx:1.27
          resources: {}
`
      const k = `# yaml-language-server: $schema=https://json.schemastore.org/kustomization.json
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
namespace: ns1
resources:
  - deploy.yaml
patches:
  - target:
      kind: Deployment
      name: ghost
    patch: |-
      - op: replace
        path: /spec/replicas
        value: 2
`
      await writeFile('app/k8s/ua/deploy.yaml', dep, 'utf8')
      await writeFile('app/k8s/ua/kustomization.yaml', k, 'utf8')
      expect(await checkK8s()).toBe(1)
    })
  })
})
