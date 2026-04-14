/**
 * Тести check-abie.mjs: умовне ввімкнення через .n-cursor.json, Firebase Hosting у корені, ignore_branches, hc.yaml, base preem, HTTPRoute (Vite-пакети), overlay nodeSelector за пакетом, Service NodePort у ru.
 */
import { describe, expect, test } from 'bun:test'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import {
  ABIE_HC_SCHEMA_URL,
  ABIE_REQUIRED_IGNORE_BRANCHES,
  ABIE_SHARED_CROSS_NS_BACKEND_NAMES,
  abieOverlayK8sTreeHasDeployment,
  abieOverlayRequiresHttpRouteByVite,
  abiePackageDirFromK8sOverlay,
  analyzeAbieSharedBackendRefsInPackageK8s,
  deploymentDocumentHasAbieBasePreemNodeSelector,
  getAbieRuServiceNodePortPatchErrors,
  getCombinedNginxRunPatchTextFromKustomization,
  ignoreBranchesIncludesRequired,
  jsonPatchRemovesPath,
  jsonPatchTextClearsHeadlessServiceClusterIPNone,
  jsonPatchTextSetsServiceTypeNodePort,
  isAbieK8sBaseYamlPath,
  isK8sYamlInAbiePackageExcludingUaRuOverlays,
  isRuKustomizationPath,
  isUaKustomizationPath,
  kustomizationHasAbieDeploymentNodeSelectorPatch,
  serviceDocumentRequiresAbieRuNodePortOverlay,
  serviceDocumentRequiresRuClusterIPNoneRemoval,
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
    name: my-svc-hl
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

  test('abiePackageDirFromK8sOverlay — каталог пакета перед /k8s/(ua|ru)/', () => {
    const root = '/repo'
    expect(abiePackageDirFromK8sOverlay(root, join(root, 'app/k8s/ua/kustomization.yaml'))).toBe(join(root, 'app'))
    expect(abiePackageDirFromK8sOverlay(root, join(root, 'app/k8s/ru/kustomization.yaml'))).toBe(join(root, 'app'))
    expect(abiePackageDirFromK8sOverlay(root, join(root, 'app/k8s/base/kustomization.yaml'))).toBe(null)
  })

  test('abieOverlayK8sTreeHasDeployment — Deployment у дереві k8s того ж пакета', () => {
    const root = '/r'
    const uaK = join(root, 'pkg/k8s/ua/kustomization.yaml')
    const dirs = new Set([join(root, 'pkg/k8s/base')])
    expect(abieOverlayK8sTreeHasDeployment(dirs, root, uaK)).toBe(true)
    expect(abieOverlayK8sTreeHasDeployment(new Set([join(root, 'other/k8s/base')]), root, uaK)).toBe(false)
  })

  test('abieOverlayRequiresHttpRouteByVite — лише за наявності vite.config у пакеті', async () => {
    await withTmpCwd(async () => {
      const root = process.cwd()
      await ensureDir('svc/k8s/ua')
      const uaAbs = join(root, 'svc/k8s/ua/kustomization.yaml')
      await writeFile(uaAbs, 'kind: Kustomization\n', 'utf8')
      expect(abieOverlayRequiresHttpRouteByVite(root, uaAbs)).toBe(false)
      await writeFile(join(root, 'svc/vite.config.js'), 'export default {}\n', 'utf8')
      expect(abieOverlayRequiresHttpRouteByVite(root, uaAbs)).toBe(true)
    })
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

  test('validateAbieHcYaml — targetRef без -hl (очікується my-svc-hl)', () => {
    const bad = HC_MIN.replace('name: my-svc-hl', 'name: my-svc')
    expect(validateAbieHcYaml(bad, 'hc.yaml')).toContain('my-svc-hl')
  })

  test('validateAbieHcYaml — успіх, коли metadata.name вже з суфіксом -hl', () => {
    const y = HC_MIN.replace(/^ {2}name: my-svc$/mu, '  name: my-svc-hl')
    expect(validateAbieHcYaml(y, 'hc.yaml')).toBeNull()
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

  test('kustomizationHasAbieDeploymentNodeSelectorPatch — ua з op replace теж підходить', () => {
    const uaReplace = UA_KUSTOMIZATION_NODE_SELECTOR_PATCH.replace('op: add', 'op: replace')
    expect(kustomizationHasAbieDeploymentNodeSelectorPatch(uaReplace, 'ua')).toBe(true)
  })

  test('kustomizationHasAbieDeploymentNodeSelectorPatch — відхиляє ua без preem false', () => {
    const bad = UA_KUSTOMIZATION_NODE_SELECTOR_PATCH.replace("preem: 'false'", "preem: 'true'")
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
`

  const RU_KUSTOMIZATION_WITH_HASURA_NO_WS = `apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
patches:
  - target:
      kind: ConfigMap
      name: caps-h
    patch: |-
      - op: replace
        path: /data/HASURA_GRAPHQL_JWT_SECRET
        value: '{}'
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

  test('getCombinedNginxRunPatchTextFromKustomization збирає patch для HTTPRoute з довільним target.name', () => {
    const joined = getCombinedNginxRunPatchTextFromKustomization(RU_KUSTOMIZATION_HTTPROUTE)
    expect(joined).toContain('/spec/hostnames')
    expect(joined).toContain('napitkivmeste.tech')
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
    expect(validateAbieNginxRunHttpRoutePatches(ruCombined, 'ru', RU_KUSTOMIZATION_HTTPROUTE)).toBeNull()
  })

  test('ABIE_SHARED_CROSS_NS_BACKEND_NAMES — канонічні імена', () => {
    expect(ABIE_SHARED_CROSS_NS_BACKEND_NAMES).toContain('auth-run-hl')
    expect(ABIE_SHARED_CROSS_NS_BACKEND_NAMES).toContain('filelint-hl')
  })

  test('isK8sYamlInAbiePackageExcludingUaRuOverlays', () => {
    expect(isK8sYamlInAbiePackageExcludingUaRuOverlays('app/k8s/base/hr.yaml', 'app')).toBe(true)
    expect(isK8sYamlInAbiePackageExcludingUaRuOverlays('app/k8s/ua/kustomization.yaml', 'app')).toBe(false)
    expect(isK8sYamlInAbiePackageExcludingUaRuOverlays('app/k8s/ru/kustomization.yaml', 'app')).toBe(false)
    expect(isK8sYamlInAbiePackageExcludingUaRuOverlays('other/k8s/base/x.yaml', 'app')).toBe(false)
  })

  test('validateAbieNginxRunHttpRoutePatches — shared refCount без patch namespace — помилка', () => {
    const uaCombined = getCombinedNginxRunPatchTextFromKustomization(UA_KUSTOMIZATION_HTTPROUTE)
    expect(validateAbieNginxRunHttpRoutePatches(uaCombined, 'ua', undefined, 1)).toContain('auth-run-hl')
  })

  test('validateAbieNginxRunHttpRoutePatches — shared refCount з patch namespace — OK', () => {
    const raw = `apiVersion: kustomize.config.k8s.io/v1beta1
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
      - op: replace
        path: /spec/rules/0/backendRefs/0/namespace
        value: ua
`
    const c = getCombinedNginxRunPatchTextFromKustomization(raw)
    expect(validateAbieNginxRunHttpRoutePatches(c, 'ua', undefined, 1)).toBeNull()
  })

  test('analyzeAbieSharedBackendRefsInPackageK8s — без namespace: dev дає помилку', async () => {
    await withTmpCwd(async () => {
      const root = process.cwd()
      await ensureDir('p/k8s/base')
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

  test('validateAbieNginxRunHttpRoutePatches — ru без websocket, без HASURA у файлі — OK', () => {
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
    expect(validateAbieNginxRunHttpRoutePatches(c, 'ru', ruOnly)).toBeNull()
  })

  test('validateAbieNginxRunHttpRoutePatches — ru з HASURA у файлі без websocket — помилка', () => {
    const c = getCombinedNginxRunPatchTextFromKustomization(RU_KUSTOMIZATION_WITH_HASURA_NO_WS)
    expect(validateAbieNginxRunHttpRoutePatches(c, 'ru', RU_KUSTOMIZATION_WITH_HASURA_NO_WS)).toContain('websocket')
  })

  test('validateAbieNginxRunHttpRoutePatches — ru з HASURA і з websocket — OK', () => {
    const raw = `${RU_KUSTOMIZATION_WITH_HASURA_NO_WS.trimEnd()}
  - target:
      kind: HTTPRoute
      name: edge-route
    patch: |-
      - op: add
        path: /metadata/annotations
        value:
          gwin.yandex.cloud/rules.http.upgradeTypes: "websocket"
`
    const c = getCombinedNginxRunPatchTextFromKustomization(raw)
    expect(validateAbieNginxRunHttpRoutePatches(c, 'ru', raw)).toBeNull()
  })

  test('kustomizationHasAbieNginxRunHttpRoutePatch', () => {
    expect(kustomizationHasAbieNginxRunHttpRoutePatch(UA_KUSTOMIZATION_HTTPROUTE, 'ua')).toBe(true)
    expect(kustomizationHasAbieNginxRunHttpRoutePatch(RU_KUSTOMIZATION_HTTPROUTE, 'ru')).toBe(true)
  })

  test('serviceDocumentRequiresAbieRuNodePortOverlay — ClusterIP, headless і -hl так; NodePort / LB / ExternalName ні', () => {
    const cluster = {
      kind: 'Service',
      metadata: { name: 'web' },
      spec: { type: 'ClusterIP', ports: [{ port: 80 }] }
    }
    expect(serviceDocumentRequiresAbieRuNodePortOverlay(cluster)).toBe(true)
    expect(
      serviceDocumentRequiresAbieRuNodePortOverlay({
        kind: 'Service',
        metadata: { name: 'web' },
        spec: { ports: [{ port: 80 }] }
      })
    ).toBe(true)
    expect(
      serviceDocumentRequiresAbieRuNodePortOverlay({
        kind: 'Service',
        metadata: { name: 'x-hl' },
        spec: { type: 'ClusterIP', clusterIP: 'None', ports: [{ port: 80 }] }
      })
    ).toBe(true)
    expect(
      serviceDocumentRequiresAbieRuNodePortOverlay({
        kind: 'Service',
        metadata: { name: 'x-hl' },
        spec: { type: 'ClusterIP', ports: [{ port: 80 }] }
      })
    ).toBe(true)
    expect(
      serviceDocumentRequiresAbieRuNodePortOverlay({
        kind: 'Service',
        metadata: { name: 'web' },
        spec: { clusterIP: 'None', ports: [{ port: 80 }] }
      })
    ).toBe(true)
    expect(
      serviceDocumentRequiresAbieRuNodePortOverlay({
        kind: 'Service',
        metadata: { name: 'web' },
        spec: { type: 'NodePort', ports: [{ port: 80 }] }
      })
    ).toBe(false)
    expect(
      serviceDocumentRequiresAbieRuNodePortOverlay({
        kind: 'Service',
        metadata: { name: 'x' },
        spec: { type: 'LoadBalancer', ports: [{ port: 80 }] }
      })
    ).toBe(false)
    expect(
      serviceDocumentRequiresAbieRuNodePortOverlay({
        kind: 'Service',
        metadata: { name: 'x' },
        spec: { type: 'ExternalName', externalName: 'foo' }
      })
    ).toBe(false)
    expect(serviceDocumentRequiresAbieRuNodePortOverlay({ kind: 'Deployment', metadata: { name: 'x' } })).toBe(false)
  })

  test('jsonPatchTextSetsServiceTypeNodePort та getAbieRuServiceNodePortPatchErrors', () => {
    const okPatch = `- op: replace
  path: /spec/type
  value: NodePort
`
    expect(jsonPatchTextSetsServiceTypeNodePort(okPatch)).toBe(true)
    expect(jsonPatchTextSetsServiceTypeNodePort(okPatch.replace('NodePort', 'ClusterIP'))).toBe(false)
    const ruK = `apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
patches:
  - target:
      kind: Service
      name: web
    patch: |-
      - op: replace
        path: /spec/type
        value: NodePort
`
    const onlyWeb = new Map([['web', { requiresClusterIPNoneClear: false }]])
    expect(getAbieRuServiceNodePortPatchErrors(ruK, onlyWeb)).toEqual([])
    const webApi = new Map([
      ['web', { requiresClusterIPNoneClear: false }],
      ['api', { requiresClusterIPNoneClear: false }]
    ])
    expect(getAbieRuServiceNodePortPatchErrors(ruK, webApi).length).toBe(1)
    expect(getAbieRuServiceNodePortPatchErrors(ruK, webApi)[0]).toContain('api')
  })

  test('serviceDocumentRequiresRuClusterIPNoneRemoval та jsonPatchTextClearsHeadlessServiceClusterIPNone', () => {
    const headless = {
      kind: 'Service',
      metadata: { name: 'user-site-hl' },
      spec: { clusterIP: 'None', ports: [{ port: 80 }] }
    }
    expect(serviceDocumentRequiresRuClusterIPNoneRemoval(headless)).toBe(true)
    expect(
      serviceDocumentRequiresRuClusterIPNoneRemoval({
        kind: 'Service',
        metadata: { name: 'x' },
        spec: { clusterIPs: ['None'], ports: [{ port: 80 }] }
      })
    ).toBe(true)
    expect(serviceDocumentRequiresRuClusterIPNoneRemoval({ kind: 'Service', metadata: { name: 'x' }, spec: { ports: [] } })).toBe(false)
    const fullHlPatch = `- op: replace
  path: /spec/type
  value: NodePort
- op: remove
  path: /spec/clusterIP
- op: remove
  path: /spec/clusterIPs
`
    expect(jsonPatchTextClearsHeadlessServiceClusterIPNone(fullHlPatch)).toBe(true)
    expect(jsonPatchRemovesPath(fullHlPatch, '/spec/clusterIP')).toBe(true)
    expect(jsonPatchRemovesPath(fullHlPatch, '/spec/clusterIPs')).toBe(true)
    const nodePortOnly = `- op: replace
  path: /spec/type
  value: NodePort
`
    expect(jsonPatchTextClearsHeadlessServiceClusterIPNone(nodePortOnly)).toBe(false)
    const hlTargets = new Map([['user-site-hl', { requiresClusterIPNoneClear: true }]])
    const ruKNodePortOnlyHl = `apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
patches:
  - target:
      kind: Service
      name: user-site-hl
    patch: |-
      - op: replace
        path: /spec/type
        value: NodePort
`
    expect(getAbieRuServiceNodePortPatchErrors(ruKNodePortOnlyHl, hlTargets).length).toBeGreaterThan(0)
    const ruHl = `apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
patches:
  - target:
      kind: Service
      name: user-site-hl
    patch: |-
${fullHlPatch
  .split('\n')
  .map(l => `      ${l}`)
  .join('\n')}
`
    expect(getAbieRuServiceNodePortPatchErrors(ruHl, hlTargets)).toEqual([])
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

  test('abie: firebase.json у корені — 1', async () => {
    await withTmpCwd(async () => {
      await writeJson('.n-cursor.json', { rules: ['abie'] })
      await ensureDir('.github/workflows')
      await writeFile(join('.github/workflows/clean-merged-branch.yml'), CLEAN_MERGED_MIN, 'utf8')
      await writeFile('firebase.json', '{}\n', 'utf8')
      expect(await check()).toBe(1)
    })
  })

  test('abie: директорія .firebase у корені — 1', async () => {
    await withTmpCwd(async () => {
      await writeJson('.n-cursor.json', { rules: ['abie'] })
      await ensureDir('.github/workflows')
      await writeFile(join('.github/workflows/clean-merged-branch.yml'), CLEAN_MERGED_MIN, 'utf8')
      await ensureDir('.firebase')
      expect(await check()).toBe(1)
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
`
      await writeFile(join('app/k8s/ru/kustomization.yaml'), ruK, 'utf8')
      await writeFile(join('app/vite.config.js'), 'export default {}\n', 'utf8')
      expect(await check()).toBe(0)
    })
  })

  test('abie: ClusterIP Service без ru/kustomization — 1', async () => {
    await withTmpCwd(async () => {
      await writeJson('.n-cursor.json', { rules: ['abie'] })
      await ensureDir('.github/workflows')
      await writeFile(join('.github/workflows/clean-merged-branch.yml'), CLEAN_MERGED_MIN, 'utf8')
      await ensureDir('app/k8s/base')
      const svc = `apiVersion: v1
kind: Service
metadata:
  name: web
spec:
  ports:
    - port: 80
`
      await writeFile(join('app/k8s/base/svc.yaml'), svc, 'utf8')
      expect(await check()).toBe(1)
    })
  })

  test('abie: ClusterIP Service і ru без patch /spec/type NodePort — 1', async () => {
    await withTmpCwd(async () => {
      await writeJson('.n-cursor.json', { rules: ['abie'] })
      await ensureDir('.github/workflows')
      await writeFile(join('.github/workflows/clean-merged-branch.yml'), CLEAN_MERGED_MIN, 'utf8')
      await ensureDir('app/k8s/base')
      await ensureDir('app/k8s/ru')
      const svc = `apiVersion: v1
kind: Service
metadata:
  name: web
spec:
  ports:
    - port: 80
`
      await writeFile(join('app/k8s/base/svc.yaml'), svc, 'utf8')
      const ruK = `apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
resources:
  - ../base
`
      await writeFile(join('app/k8s/ru/kustomization.yaml'), ruK, 'utf8')
      expect(await check()).toBe(1)
    })
  })

  test('abie: ClusterIP Service і ru з patch NodePort — 0', async () => {
    await withTmpCwd(async () => {
      await writeJson('.n-cursor.json', { rules: ['abie'] })
      await ensureDir('.github/workflows')
      await writeFile(join('.github/workflows/clean-merged-branch.yml'), CLEAN_MERGED_MIN, 'utf8')
      await ensureDir('app/k8s/base')
      await ensureDir('app/k8s/ru')
      const svc = `apiVersion: v1
kind: Service
metadata:
  name: web
spec:
  ports:
    - port: 80
`
      await writeFile(join('app/k8s/base/svc.yaml'), svc, 'utf8')
      const ruK = `apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
resources:
  - ../base
patches:
  - target:
      kind: Service
      name: web
    patch: |-
      - op: replace
        path: /spec/type
        value: NodePort
`
      await writeFile(join('app/k8s/ru/kustomization.yaml'), ruK, 'utf8')
      expect(await check()).toBe(0)
    })
  })

  test('abie: headless Service (clusterIP None) і ru лише NodePort без remove — 1', async () => {
    await withTmpCwd(async () => {
      await writeJson('.n-cursor.json', { rules: ['abie'] })
      await ensureDir('.github/workflows')
      await writeFile(join('.github/workflows/clean-merged-branch.yml'), CLEAN_MERGED_MIN, 'utf8')
      await ensureDir('app/k8s/base')
      await ensureDir('app/k8s/ru')
      const svc = `apiVersion: v1
kind: Service
metadata:
  name: user-site-hl
spec:
  clusterIP: None
  ports:
    - port: 8080
`
      await writeFile(join('app/k8s/base/svc-hl.yaml'), svc, 'utf8')
      const ruK = `apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
resources:
  - ../base
patches:
  - target:
      kind: Service
      name: user-site-hl
    patch: |-
      - op: replace
        path: /spec/type
        value: NodePort
`
      await writeFile(join('app/k8s/ru/kustomization.yaml'), ruK, 'utf8')
      expect(await check()).toBe(1)
    })
  })

  test('abie: headless Service і ru з NodePort + remove clusterIP/clusterIPs — 0', async () => {
    await withTmpCwd(async () => {
      await writeJson('.n-cursor.json', { rules: ['abie'] })
      await ensureDir('.github/workflows')
      await writeFile(join('.github/workflows/clean-merged-branch.yml'), CLEAN_MERGED_MIN, 'utf8')
      await ensureDir('app/k8s/base')
      await ensureDir('app/k8s/ru')
      const svc = `apiVersion: v1
kind: Service
metadata:
  name: user-site-hl
spec:
  clusterIP: None
  ports:
    - port: 8080
`
      await writeFile(join('app/k8s/base/svc-hl.yaml'), svc, 'utf8')
      const ruK = `apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
resources:
  - ../base
patches:
  - target:
      kind: Service
      name: user-site-hl
    patch: |-
      - op: replace
        path: /spec/type
        value: NodePort
      - op: remove
        path: /spec/clusterIP
      - op: remove
        path: /spec/clusterIPs
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
