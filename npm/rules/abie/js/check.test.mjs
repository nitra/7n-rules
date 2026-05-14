/**
 * Тести check-abie.mjs: умовне ввімкнення через .n-cursor.json, Firebase Hosting у підкаталозі 1-го рівня, ignore_branches, hc.yaml, base preem, HTTPRoute (Vite-пакети), overlay nodeSelector за пакетом.
 */
import { describe, expect, test } from 'bun:test'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  ABIE_HC_SCHEMA_URL,
  ABIE_SHARED_CROSS_NS_BACKEND_NAMES,
  abieEnvNameFromBasename,
  abieOverlayK8sTreeHasDeployment,
  abieOverlayRequiresHttpRouteByVite,
  abiePackageDirFromK8sOverlay,
  analyzeAbieSharedBackendRefsInPackageK8s,
  getCombinedNginxRunPatchTextFromKustomization,
  isAbieK8sBaseYamlPath,
  isK8sYamlInAbiePackageExcludingUaOverlay,
  isUaKustomizationPath,
  kustomizationHasAbieDeploymentNodeSelectorPatch,
  kustomizationHasAbieNginxRunHttpRoutePatch,
  validateAbieEnvInternalUrls,
  validateAbieNginxRunHttpRoutePatches,
  check,
  isAbieRuleEnabled
} from './check.mjs'
import { ensureDir, withTmpCwd, writeJson } from '../../../scripts/utils/test-helpers.mjs'

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
          ignore_branches: dev,ua
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
  test('isUaKustomizationPath — overlay ua/kustomization.yaml', () => {
    expect(isUaKustomizationPath('app/k8s/overlays/ua/kustomization.yaml')).toBe(true)
    expect(isUaKustomizationPath(String.raw`x\k8s\ua\kustomization.yaml`)).toBe(true)
    expect(isUaKustomizationPath('app/k8s/base/kustomization.yaml')).toBe(false)
    expect(isUaKustomizationPath('app/k8s/ua/foo.yaml')).toBe(false)
  })

  test('abiePackageDirFromK8sOverlay — каталог пакета перед /k8s/ua/', () => {
    const root = '/repo'
    expect(abiePackageDirFromK8sOverlay(root, join(root, 'app/k8s/ua/kustomization.yaml'))).toBe(join(root, 'app'))
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
  })

  // Тести `isAllowedAbieBaseDevHostname` / `abieBaseHttpRouteHostnamesErrors`,
  // `deploymentDocumentHasAbieBasePreemNodeSelector`, `parseCleanMergedIgnoreBranches` /
  // `ignoreBranchesIncludesRequired`, `validateAbieHcYaml` — видалено разом з відповідними
  // функціями (Plan B: Rego-authoritative, JS делегує per-document валідацію conftest-у).
  // Покриття цих правил тепер забезпечують `_test.rego` фікстури у
  // `npm/policy/abie/{base_deployment_preem,clean_merged_ignore_branches,health_check_policy,http_route_base}/`,
  // що виконуються через `bun run lint-rego` (`conftest verify`).

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

  test('kustomizationHasAbieDeploymentNodeSelectorPatch — ua', () => {
    expect(kustomizationHasAbieDeploymentNodeSelectorPatch(UA_KUSTOMIZATION_NODE_SELECTOR_PATCH, 'ua')).toBe(true)
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

  test('getCombinedNginxRunPatchTextFromKustomization збирає patch для HTTPRoute з довільним target.name', () => {
    const joined = getCombinedNginxRunPatchTextFromKustomization(UA_KUSTOMIZATION_HTTPROUTE)
    expect(joined).toContain('/spec/hostnames')
    expect(joined).toContain('abie.app')
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

  test('validateAbieNginxRunHttpRoutePatches — ua', () => {
    const uaCombined = getCombinedNginxRunPatchTextFromKustomization(UA_KUSTOMIZATION_HTTPROUTE)
    expect(validateAbieNginxRunHttpRoutePatches(uaCombined, 'ua')).toBeNull()
  })

  test('validateAbieNginxRunHttpRoutePatches — ua-* (наприклад b2b) теж валідні', () => {
    const uaB2b = UA_KUSTOMIZATION_HTTPROUTE.replace('\n        value: ua\n', '\n        value: ua-b2b\n')
    const uaCombined = getCombinedNginxRunPatchTextFromKustomization(uaB2b)
    expect(validateAbieNginxRunHttpRoutePatches(uaCombined, 'ua')).toBeNull()
  })

  test('ABIE_SHARED_CROSS_NS_BACKEND_NAMES — канонічні імена', () => {
    expect(ABIE_SHARED_CROSS_NS_BACKEND_NAMES).toContain('auth-run-hl')
    expect(ABIE_SHARED_CROSS_NS_BACKEND_NAMES).toContain('file-link-hl')
  })

  test('isK8sYamlInAbiePackageExcludingUaOverlay', () => {
    expect(isK8sYamlInAbiePackageExcludingUaOverlay('app/k8s/base/hr.yaml', 'app')).toBe(true)
    expect(isK8sYamlInAbiePackageExcludingUaOverlay('app/k8s/ua/kustomization.yaml', 'app')).toBe(false)
    expect(isK8sYamlInAbiePackageExcludingUaOverlay('other/k8s/base/x.yaml', 'app')).toBe(false)
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
        value: ua-b2b
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

  test('kustomizationHasAbieNginxRunHttpRoutePatch', () => {
    expect(kustomizationHasAbieNginxRunHttpRoutePatch(UA_KUSTOMIZATION_HTTPROUTE, 'ua')).toBe(true)
  })

  test('abieEnvNameFromBasename — лише dev/ua (з опційною провідною крапкою)', () => {
    expect(abieEnvNameFromBasename('dev.env')).toBe('dev')
    expect(abieEnvNameFromBasename('.dev.env')).toBe('dev')
    expect(abieEnvNameFromBasename('ua.env')).toBe('ua')
    expect(abieEnvNameFromBasename('.ua.env')).toBe('ua')
    expect(abieEnvNameFromBasename('production.env')).toBeNull()
    expect(abieEnvNameFromBasename('.env')).toBeNull()
    expect(abieEnvNameFromBasename('dev.env.example')).toBeNull()
  })

  test('validateAbieEnvInternalUrls — узгоджений dev URL (Hasura + KVCMS) — без помилок', () => {
    const env = `# eslint-disable
HASURA_GRAPHQL_ENDPOINT=http://apruv-h-hl.dev-apruv.svc.abie-dev.internal:8080
KVCMS_URL=http://kvcms-hl.dev-apruv.svc.abie-dev.internal:8080
`
    expect(validateAbieEnvInternalUrls(env, 'dev')).toEqual([])
  })

  test('validateAbieEnvInternalUrls — ua URL (без порту також ловиться)', () => {
    const env = `KVCMS_URL=http://kvcms-hl.ua-apruv.svc.abie-ua.internal\n`
    expect(validateAbieEnvInternalUrls(env, 'ua')).toEqual([])
  })

  test('validateAbieEnvInternalUrls — некоректний кластер для env (dev URL у .ua.env) — fail', () => {
    const env = `KVCMS_URL=http://kvcms-hl.dev-apruv.svc.abie-dev.internal:8080\n`
    const errs = validateAbieEnvInternalUrls(env, 'ua')
    expect(errs.length).toBeGreaterThanOrEqual(2) // і DNS, і namespace prefix
    expect(errs.some(e => e.includes('abie-ua.internal'))).toBe(true)
    expect(errs.some(e => e.includes('ua-'))).toBe(true)
  })

  test('validateAbieEnvInternalUrls — не торкається публічних/зовнішніх URL', () => {
    const env = `EXTERNAL=https://example.com/contract/ql\nLOCAL=http://localhost:8080\n`
    expect(validateAbieEnvInternalUrls(env, 'dev')).toEqual([])
  })

  test('validateAbieEnvInternalUrls — кілька URL з різними порушеннями', () => {
    const env = `A=http://a-hl.dev-foo.svc.abie-dev.internal:8080
B=http://b-hl.ua-foo.svc.abie-ua.internal:8080
`
    // У ua.env URL A (dev-кластер) має помилитись (DNS + namespace), URL B — OK
    const errs = validateAbieEnvInternalUrls(env, 'ua')
    expect(errs.length).toBe(2) // 1 URL × 2 проблеми (DNS + namespace)
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

  test('abie: HTTPRoute у base з hostnames не aiml.live — 1', async () => {
    await withTmpCwd(async () => {
      await writeJson('.n-cursor.json', { rules: ['abie'] })
      await ensureDir('.github/workflows')
      await writeFile(join('.github/workflows/clean-merged-branch.yml'), CLEAN_MERGED_MIN, 'utf8')
      await ensureDir('app/k8s/base')
      const hr = `apiVersion: gateway.networking.k8s.io/v1
kind: HTTPRoute
metadata:
  name: app-route
spec:
  hostnames:
    - "abie.app"
`
      await writeFile(join('app/k8s/base/hr.yaml'), hr, 'utf8')
      expect(await check()).toBe(1)
    })
  })

  test('abie: HTTPRoute у base з hostnames aiml.live — 0', async () => {
    await withTmpCwd(async () => {
      await writeJson('.n-cursor.json', { rules: ['abie'] })
      await ensureDir('.github/workflows')
      await writeFile(join('.github/workflows/clean-merged-branch.yml'), CLEAN_MERGED_MIN, 'utf8')
      await ensureDir('app/k8s/base')
      const hr = `apiVersion: gateway.networking.k8s.io/v1
kind: HTTPRoute
metadata:
  name: app-route
spec:
  hostnames:
    - "app.aiml.live"
    - "*.aiml.live"
`
      await writeFile(join('app/k8s/base/hr.yaml'), hr, 'utf8')
      expect(await check()).toBe(0)
    })
  })

  test('abie: firebase.json у підкаталозі першого рівня — 1', async () => {
    await withTmpCwd(async () => {
      await writeJson('.n-cursor.json', { rules: ['abie'] })
      await ensureDir('.github/workflows')
      await writeFile(join('.github/workflows/clean-merged-branch.yml'), CLEAN_MERGED_MIN, 'utf8')
      await ensureDir('app')
      await writeFile(join('app', 'firebase.json'), '{}\n', 'utf8')
      expect(await check()).toBe(1)
    })
  })

  test('abie: firebase.json лише в корені — 0', async () => {
    await withTmpCwd(async () => {
      await writeJson('.n-cursor.json', { rules: ['abie'] })
      await ensureDir('.github/workflows')
      await writeFile(join('.github/workflows/clean-merged-branch.yml'), CLEAN_MERGED_MIN, 'utf8')
      await writeFile('firebase.json', '{}\n', 'utf8')
      expect(await check()).toBe(0)
    })
  })

  test('abie: директорія .firebase у підкаталозі першого рівня — 1', async () => {
    await withTmpCwd(async () => {
      await writeJson('.n-cursor.json', { rules: ['abie'] })
      await ensureDir('.github/workflows')
      await writeFile(join('.github/workflows/clean-merged-branch.yml'), CLEAN_MERGED_MIN, 'utf8')
      await ensureDir('app')
      await ensureDir(join('app', '.firebase'))
      expect(await check()).toBe(1)
    })
  })

  test('abie: відсутні ua у ignore_branches — 1', async () => {
    await withTmpCwd(async () => {
      await writeJson('.n-cursor.json', { rules: ['abie'] })
      await ensureDir('.github/workflows')
      const bad = CLEAN_MERGED_MIN.replace('ignore_branches: dev,ua', 'ignore_branches: main,dev')
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
      expect(await check()).toBe(1)
    })
  })

  test('abie: Deployment + hc.yaml + ua patch — 0', async () => {
    await withTmpCwd(async () => {
      await writeJson('.n-cursor.json', { rules: ['abie'] })
      await ensureDir('.github/workflows')
      await writeFile(join('.github/workflows/clean-merged-branch.yml'), CLEAN_MERGED_MIN, 'utf8')
      await ensureDir('app/k8s/base')
      await ensureDir('app/k8s/ua')
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
      await writeFile(join('app/vite.config.js'), 'export default {}\n', 'utf8')
      expect(await check()).toBe(0)
    })
  })

  test('abie: env-файли .dev.env / .ua.env з узгодженим cluster DNS — 0', async () => {
    await withTmpCwd(async () => {
      await writeJson('.n-cursor.json', { rules: ['abie'] })
      await ensureDir('.github/workflows')
      await writeFile(join('.github/workflows/clean-merged-branch.yml'), CLEAN_MERGED_MIN, 'utf8')
      await ensureDir('hasura')
      await writeFile(
        join('hasura/.dev.env'),
        'HASURA_GRAPHQL_ENDPOINT=http://apruv-h-hl.dev-apruv.svc.abie-dev.internal:8080\n' +
          'KVCMS_URL=http://kvcms-hl.dev-apruv.svc.abie-dev.internal:8080\n',
        'utf8'
      )
      await writeFile(
        join('hasura/.ua.env'),
        'HASURA_GRAPHQL_ENDPOINT=http://apruv-h-hl.ua-apruv.svc.abie-ua.internal:8080\n' +
          'KVCMS_URL=http://kvcms-hl.ua-apruv.svc.abie-ua.internal:8080\n',
        'utf8'
      )
      expect(await check()).toBe(0)
    })
  })

  test('abie: .ua.env з URL до dev-кластера — 1', async () => {
    await withTmpCwd(async () => {
      await writeJson('.n-cursor.json', { rules: ['abie'] })
      await ensureDir('.github/workflows')
      await writeFile(join('.github/workflows/clean-merged-branch.yml'), CLEAN_MERGED_MIN, 'utf8')
      await ensureDir('hasura')
      // KVCMS показує на dev-кластер замість ua → fail
      await writeFile(
        join('hasura/.ua.env'),
        'HASURA_GRAPHQL_ENDPOINT=http://apruv-h-hl.ua-apruv.svc.abie-ua.internal:8080\n' +
          'KVCMS_URL=http://kvcms-hl.dev-apruv.svc.abie-dev.internal:8080\n',
        'utf8'
      )
      expect(await check()).toBe(1)
    })
  })

  test('abie: .env без імені — пропускається (як у hasura.mdc)', async () => {
    await withTmpCwd(async () => {
      await writeJson('.n-cursor.json', { rules: ['abie'] })
      await ensureDir('.github/workflows')
      await writeFile(join('.github/workflows/clean-merged-branch.yml'), CLEAN_MERGED_MIN, 'utf8')
      // .env без імені (локальний для розробника) — не сканується
      await writeFile('.env', 'HASURA_GRAPHQL_ENDPOINT=http://x-hl.zzz.svc.totally-wrong.internal:8080\n', 'utf8')
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
