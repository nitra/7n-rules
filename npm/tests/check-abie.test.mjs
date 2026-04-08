/**
 * Тести check-abie.mjs: умовне ввімкнення через .n-cursor.json, ignore_branches, hc.yaml, base preem, HTTPRoute (будь-який target.name).
 */
import { describe, expect, test } from 'bun:test'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import {
  ABIE_HC_SCHEMA_URL,
  ABIE_REQUIRED_IGNORE_BRANCHES,
  deploymentDocumentHasAbieBasePreemNodeSelector,
  getCombinedNginxRunPatchTextFromKustomization,
  ignoreBranchesIncludesRequired,
  isAbieK8sBaseYamlPath,
  isRuKustomizationPath,
  isUaKustomizationPath,
  kustomizationHasAbieDeploymentNodeSelectorPatch,
  kustomizationHasAbieNginxRunHttpRoutePatch,
  parseCleanMergedIgnoreBranches,
  validateAbieHcYaml,
  validateAbieNginxRunHttpRoutePatches,
  check,
  isAbieRuleEnabled
} from '../scripts/check-abie.mjs'
import { ensureDir, withTmpCwd, writeJson } from './helpers.mjs'

const CLEAN_MERGED_MIN = `name: Clean abandoned branches
on:
  workflow_dispatch: {}
jobs:
  cleanup_old_branches:
    runs-on: ubuntu-latest
    steps:
      - uses: phpdocker-io/github-actions-delete-abandoned-branches@v2.0.3
        with:
          github_token: \${{ github.token }}
          ignore_branches: dev,ua,ru
          dry_run: no
`

const HC_MIN = `# yaml-language-server: $schema=${ABIE_HC_SCHEMA_URL}
apiVersion: networking.gke.io/v1
kind: HealthCheckPolicy
metadata:
  name: my-svc
  namespace: dev
spec:
  default:
    config:
      type: HTTP
      httpHealthCheck:
        requestPath: /healthz
        port: 8080
  targetRef:
    group: ''
    kind: Service
    name: my-svc
`

describe('check-abie (допоміжні функції)', () => {
  test('isRuKustomizationPath — overlay ru/kustomization.yaml', () => {
    expect(isRuKustomizationPath('app/k8s/overlays/ru/kustomization.yaml')).toBe(true)
    expect(isRuKustomizationPath(String.raw`x\k8s\ru\kustomization.yaml`)).toBe(true)
    expect(isRuKustomizationPath('app/k8s/base/kustomization.yaml')).toBe(false)
    expect(isRuKustomizationPath('app/k8s/ru/foo.yaml')).toBe(false)
  })

  test('isUaKustomizationPath — overlay ua/kustomization.yaml', () => {
    expect(isUaKustomizationPath('app/k8s/overlays/ua/kustomization.yaml')).toBe(true)
    expect(isUaKustomizationPath(String.raw`x\k8s\ua\kustomization.yaml`)).toBe(true)
    expect(isUaKustomizationPath('app/k8s/base/kustomization.yaml')).toBe(false)
    expect(isUaKustomizationPath('app/k8s/ua/foo.yaml')).toBe(false)
  })

  test('isAbieK8sBaseYamlPath — сегмент base у шляху', () => {
    expect(isAbieK8sBaseYamlPath('app/k8s/base/deploy.yaml')).toBe(true)
    expect(isAbieK8sBaseYamlPath(String.raw`pkg\k8s\base\a.yaml`)).toBe(true)
    expect(isAbieK8sBaseYamlPath('app/k8s/ua/kustomization.yaml')).toBe(false)
    expect(isAbieK8sBaseYamlPath('app/k8s/overlays/ru/foo.yaml')).toBe(false)
  })

  test('deploymentDocumentHasAbieBasePreemNodeSelector', () => {
    const ok = {
      kind: 'Deployment',
      spec: {
        template: {
          spec: {
            nodeSelector: { preem: 'true' }
          }
        }
      }
    }
    expect(deploymentDocumentHasAbieBasePreemNodeSelector(ok)).toBe(true)
    expect(
      deploymentDocumentHasAbieBasePreemNodeSelector({
        ...ok,
        spec: { template: { spec: { nodeSelector: { preem: true } } } }
      })
    ).toBe(true)
    expect(
      deploymentDocumentHasAbieBasePreemNodeSelector({
        ...ok,
        spec: { template: { spec: { nodeSelector: { preem: 'false' } } } }
      })
    ).toBe(false)
    expect(
      deploymentDocumentHasAbieBasePreemNodeSelector({
        ...ok,
        spec: { template: { spec: { containers: [] } } }
      })
    ).toBe(false)
    expect(deploymentDocumentHasAbieBasePreemNodeSelector({ kind: 'Service' })).toBe(false)
  })

  test('parseCleanMergedIgnoreBranches знаходить ignore_branches', () => {
    const ib = parseCleanMergedIgnoreBranches(CLEAN_MERGED_MIN)
    expect(ib).toBe('dev,ua,ru')
  })

  test('ignoreBranchesIncludesRequired', () => {
    expect(ignoreBranchesIncludesRequired('dev,ua,ru', ABIE_REQUIRED_IGNORE_BRANCHES)).toBe(true)
    expect(ignoreBranchesIncludesRequired('main,dev,ua,ru', ABIE_REQUIRED_IGNORE_BRANCHES)).toBe(true)
    expect(ignoreBranchesIncludesRequired('main,dev', ABIE_REQUIRED_IGNORE_BRANCHES)).toBe(false)
    expect(ignoreBranchesIncludesRequired('dev, ua , ru', ABIE_REQUIRED_IGNORE_BRANCHES)).toBe(true)
  })

  test('validateAbieHcYaml — успіх', () => {
    expect(validateAbieHcYaml(HC_MIN, 'k8s/base/hc.yaml')).toBeNull()
  })

  test('validateAbieHcYaml — невірний порт', () => {
    const bad = HC_MIN.replace('port: 8080', 'port: 80')
    expect(validateAbieHcYaml(bad, 'hc.yaml')).toContain('8080')
  })

  const UA_KUSTOMIZATION_NODE_SELECTOR_PATCH = `apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
patches:
  - target:
      kind: Deployment
      name: x
    patch: |-
      - op: add
        path: /spec/template/spec/nodeSelector
        value:
          preem: 'false'
`

  const RU_KUSTOMIZATION_NODE_SELECTOR_PATCH = `apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
patches:
  - target:
      kind: Deployment
      name: x
    patch: |-
      - op: replace
        path: /spec/template/spec/nodeSelector
        value:
          yandex.cloud/preemptible: "false"
`

  test('kustomizationHasAbieDeploymentNodeSelectorPatch — ua / ru', () => {
    expect(kustomizationHasAbieDeploymentNodeSelectorPatch(UA_KUSTOMIZATION_NODE_SELECTOR_PATCH, 'ua')).toBe(true)
    expect(kustomizationHasAbieDeploymentNodeSelectorPatch(UA_KUSTOMIZATION_NODE_SELECTOR_PATCH, 'ru')).toBe(false)
    expect(kustomizationHasAbieDeploymentNodeSelectorPatch(RU_KUSTOMIZATION_NODE_SELECTOR_PATCH, 'ru')).toBe(true)
    expect(kustomizationHasAbieDeploymentNodeSelectorPatch(RU_KUSTOMIZATION_NODE_SELECTOR_PATCH, 'ua')).toBe(false)
  })

  test('kustomizationHasAbieDeploymentNodeSelectorPatch — відхиляє не той op', () => {
    const bad = UA_KUSTOMIZATION_NODE_SELECTOR_PATCH.replace('op: add', 'op: replace')
    expect(kustomizationHasAbieDeploymentNodeSelectorPatch(bad, 'ua')).toBe(false)
  })

  const UA_KUSTOMIZATION_HTTPROUTE = `apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
patches:
  - target:
      kind: HTTPRoute
      name: my-httproute
    patch: |-
      - op: replace
        path: /spec/hostnames
        value:
          - "abie.app"
      - op: replace
        path: /spec/parentRefs/0/namespace
        value: ua
`

  const RU_KUSTOMIZATION_HTTPROUTE = `apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
patches:
  - target:
      kind: HTTPRoute
      name: my-httproute
    patch: |-
      - op: replace
        path: /spec/hostnames
        value:
          - "napitkivmeste.tech"
      - op: replace
        path: /spec/parentRefs/0/namespace
        value: ru
  - target:
      kind: HTTPRoute
      name: my-httproute
    patch: |-
      - op: add
        path: /metadata/annotations
        value:
          gwin.yandex.cloud/rules.http.upgradeTypes: "websocket"
`

  test('getCombinedNginxRunPatchTextFromKustomization збирає patch для HTTPRoute з довільним target.name', () => {
    const joined = getCombinedNginxRunPatchTextFromKustomization(RU_KUSTOMIZATION_HTTPROUTE)
    expect(joined).toContain('/spec/hostnames')
    expect(joined).toContain('websocket')
  })

  test('getCombinedNginxRunPatchTextFromKustomization не збирає HTTPRoute без target.name', () => {
    const raw = `apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
patches:
  - target:
      kind: HTTPRoute
    patch: |-
      - op: replace
        path: /spec/hostnames
        value:
          - "abie.app"
`
    expect(getCombinedNginxRunPatchTextFromKustomization(raw).trim()).toBe('')
  })

  test('validateAbieNginxRunHttpRoutePatches — ua / ru', () => {
    const uaCombined = getCombinedNginxRunPatchTextFromKustomization(UA_KUSTOMIZATION_HTTPROUTE)
    expect(validateAbieNginxRunHttpRoutePatches(uaCombined, 'ua')).toBeNull()
    const ruCombined = getCombinedNginxRunPatchTextFromKustomization(RU_KUSTOMIZATION_HTTPROUTE)
    expect(validateAbieNginxRunHttpRoutePatches(ruCombined, 'ru')).toBeNull()
  })

  test('validateAbieNginxRunHttpRoutePatches — ru без websocket', () => {
    const ruOnly = `apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
patches:
  - target:
      kind: HTTPRoute
      name: edge-route
    patch: |-
      - op: replace
        path: /spec/hostnames
        value:
          - "napitkivmeste.tech"
      - op: replace
        path: /spec/parentRefs/0/namespace
        value: ru
`
    const c = getCombinedNginxRunPatchTextFromKustomization(ruOnly)
    expect(validateAbieNginxRunHttpRoutePatches(c, 'ru')).toContain('websocket')
  })

  test('kustomizationHasAbieNginxRunHttpRoutePatch', () => {
    expect(kustomizationHasAbieNginxRunHttpRoutePatch(UA_KUSTOMIZATION_HTTPROUTE, 'ua')).toBe(true)
    expect(kustomizationHasAbieNginxRunHttpRoutePatch(RU_KUSTOMIZATION_HTTPROUTE, 'ru')).toBe(true)
  })
})

describe('check-abie (інтеграція в тимчасовому каталозі)', () => {
  test('без abie у .n-cursor.json — 0', async () => {
    await withTmpCwd(async () => {
      await writeJson('.n-cursor.json', { rules: ['bun'] })
      expect(await check()).toBe(0)
    })
  })

  test('abie увімкнено: коректний workflow і без k8s — 0', async () => {
    await withTmpCwd(async () => {
      await writeJson('.n-cursor.json', { rules: ['abie'] })
      await ensureDir('.github/workflows')
      await writeFile(join('.github/workflows/clean-merged-branch.yml'), CLEAN_MERGED_MIN, 'utf8')
      expect(await check()).toBe(0)
    })
  })

  test('abie: відсутні ua/ru у ignore_branches — 1', async () => {
    await withTmpCwd(async () => {
      await writeJson('.n-cursor.json', { rules: ['abie'] })
      await ensureDir('.github/workflows')
      const bad = CLEAN_MERGED_MIN.replace('ignore_branches: dev,ua,ru', 'ignore_branches: main,dev')
      await writeFile(join('.github/workflows/clean-merged-branch.yml'), bad, 'utf8')
      expect(await check()).toBe(1)
    })
  })

  test('abie: Deployment без hc.yaml — 1', async () => {
    await withTmpCwd(async () => {
      await writeJson('.n-cursor.json', { rules: ['abie'] })
      await ensureDir('.github/workflows')
      await writeFile(join('.github/workflows/clean-merged-branch.yml'), CLEAN_MERGED_MIN, 'utf8')
      await ensureDir('app/k8s/base')
      const dep = `# yaml-language-server: $schema=https://json.schemastore.org/kustomization.json
apiVersion: apps/v1
kind: Deployment
metadata:
  name: x
spec:
  template:
    spec:
      nodeSelector:
        preem: 'true'
      containers: []
`
      await writeFile(join('app/k8s/base/deploy.yaml'), dep, 'utf8')
      expect(await check()).toBe(1)
    })
  })

  test('abie: base Deployment без preem — 1', async () => {
    await withTmpCwd(async () => {
      await writeJson('.n-cursor.json', { rules: ['abie'] })
      await ensureDir('.github/workflows')
      await writeFile(join('.github/workflows/clean-merged-branch.yml'), CLEAN_MERGED_MIN, 'utf8')
      await ensureDir('app/k8s/base')
      const dep = `# yaml-language-server: $schema=https://example.com/d.json
apiVersion: apps/v1
kind: Deployment
metadata:
  name: x
spec:
  template:
    spec:
      containers: []
`
      await writeFile(join('app/k8s/base/deploy.yaml'), dep, 'utf8')
      await writeFile(join('app/k8s/base/hc.yaml'), HC_MIN, 'utf8')
      expect(await check()).toBe(1)
    })
  })

  test('abie: Deployment + hc без ua/kustomization — 1', async () => {
    await withTmpCwd(async () => {
      await writeJson('.n-cursor.json', { rules: ['abie'] })
      await ensureDir('.github/workflows')
      await writeFile(join('.github/workflows/clean-merged-branch.yml'), CLEAN_MERGED_MIN, 'utf8')
      await ensureDir('app/k8s/base')
      await ensureDir('app/k8s/ru')
      const dep = `# yaml-language-server: $schema=https://example.com/d.json
apiVersion: apps/v1
kind: Deployment
metadata:
  name: x
spec:
  template:
    spec:
      nodeSelector:
        preem: 'true'
      containers: []
`
      await writeFile(join('app/k8s/base/deploy.yaml'), dep, 'utf8')
      await writeFile(join('app/k8s/base/hc.yaml'), HC_MIN, 'utf8')
      const ruK = `apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
patches:
  - target:
      kind: HealthCheckPolicy
      name: my-svc
    patch: |-
      kind: HealthCheckPolicy
      metadata:
        name: my-svc
      $patch: delete
  - target:
      kind: Deployment
      name: x
    patch: |-
      - op: replace
        path: /spec/template/spec/nodeSelector
        value:
          yandex.cloud/preemptible: "false"
`
      await writeFile(join('app/k8s/ru/kustomization.yaml'), ruK, 'utf8')
      expect(await check()).toBe(1)
    })
  })

  test('abie: Deployment + hc.yaml + ru patch — 0', async () => {
    await withTmpCwd(async () => {
      await writeJson('.n-cursor.json', { rules: ['abie'] })
      await ensureDir('.github/workflows')
      await writeFile(join('.github/workflows/clean-merged-branch.yml'), CLEAN_MERGED_MIN, 'utf8')
      await ensureDir('app/k8s/base')
      await ensureDir('app/k8s/ua')
      await ensureDir('app/k8s/ru')
      const dep = `# yaml-language-server: $schema=https://example.com/d.json
apiVersion: apps/v1
kind: Deployment
metadata:
  name: x
spec:
  template:
    spec:
      nodeSelector:
        preem: 'true'
      containers: []
`
      await writeFile(join('app/k8s/base/deploy.yaml'), dep, 'utf8')
      await writeFile(join('app/k8s/base/hc.yaml'), HC_MIN, 'utf8')
      const uaK = `apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
patches:
  - target:
      kind: Deployment
      name: x
    patch: |-
      - op: add
        path: /spec/template/spec/nodeSelector
        value:
          preem: 'false'
  - target:
      kind: HTTPRoute
      name: app-route
    patch: |-
      - op: replace
        path: /spec/hostnames
        value:
          - "abie.app"
      - op: replace
        path: /spec/parentRefs/0/namespace
        value: ua
`
      await writeFile(join('app/k8s/ua/kustomization.yaml'), uaK, 'utf8')
      const ruK = `apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
patches:
  - target:
      kind: HealthCheckPolicy
      name: my-svc
    patch: |-
      kind: HealthCheckPolicy
      metadata:
        name: my-svc
      $patch: delete
  - target:
      kind: Deployment
      name: x
    patch: |-
      - op: replace
        path: /spec/template/spec/nodeSelector
        value:
          yandex.cloud/preemptible: "false"
  - target:
      kind: HTTPRoute
      name: app-route
    patch: |-
      - op: replace
        path: /spec/hostnames
        value:
          - "napitkivmeste.tech"
      - op: replace
        path: /spec/parentRefs/0/namespace
        value: ru
  - target:
      kind: HTTPRoute
      name: app-route
    patch: |-
      - op: add
        path: /metadata/annotations
        value:
          gwin.yandex.cloud/rules.http.upgradeTypes: "websocket"
`
      await writeFile(join('app/k8s/ru/kustomization.yaml'), ruK, 'utf8')
      expect(await check()).toBe(0)
    })
  })
})

describe('isAbieRuleEnabled', () => {
  test('на репозиторії cursor — false (abie не в rules)', async () => {
    const { fileURLToPath } = await import('node:url')
    const TEST_DIR =
      typeof import.meta.dirname === 'string' ? import.meta.dirname : fileURLToPath(new URL('.', import.meta.url))
    const REPO_ROOT = join(TEST_DIR, '..', '..')
    expect(await isAbieRuleEnabled(REPO_ROOT)).toBe(false)
  })
})
