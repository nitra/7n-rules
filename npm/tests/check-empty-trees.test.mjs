/**
 * Тести check-docker і check-k8s у дереві без відповідних файлів (ранній вихід 0) та JSON6902 у kustomization.
 */
import { describe, expect, test } from 'vitest'
import { join } from 'node:path'
import { env } from 'node:process'
import { writeFile } from 'node:fs/promises'

import { runConcernDetector } from '../scripts/lib/lint-surface/detect.mjs'
import { ensureDir, withBinStubInPath, withTmpDir } from '../scripts/utils/test-helpers.mjs'

const TEST_DIR = import.meta.dirname

// `docker/lint` і `k8s/manifests` — native-концерни без `main.mjs`, тож
// виклик іде через той самий диспетчер, що й у бойовому прогоні. Перший
// аргумент `runConcernDetector` (`concern`-entry з policy-`dir`) читається
// лише в JS/wasm-гілках нижче native-перевірки (`detect.mjs:220-230`) — для
// вже native-зареєстрованого ключа `null` безпечний, той самий патерн, що й
// нижче для `checkK8s`.
const checkDocker = async dir => {
  const result = await runConcernDetector(null, { cwd: dir, ruleId: 'docker', concernId: 'lint' })
  return result.violations.length === 0 ? 0 : 1
}
// `k8s/manifests` — native-концерн без `main.mjs`, тож виклик іде через той
// самий диспетчер, що й у бойовому прогоні. Детектор шукає rego-політики й
// сніпети у КОРЕНІ ПАКЕТА, а тимчасове дерево його не містить — звідси явний
// override, задокументований саме під цей випадок (`rules_package.rs`).
// Опційна змінна (fallback за замовчуванням) — `env` з `node:process`, не
// прямий `process.env` (js-run.mdc, розділ «CheckEnv та заборона прямого
// process.env»): мандатний `checkEnv`/`@nitra/check-env` тут зайвий, бо
// значення завжди має дефолт, ніколи не вимагається ззовні.
env.N_RULES_PACKAGE_ROOT ??= join(TEST_DIR, '..')
const checkK8s = async dir => {
  const result = await runConcernDetector(null, { cwd: dir, ruleId: 'k8s', concernId: 'manifests' })
  return result.violations.length === 0 ? 0 : 1
}

const YANNH_DEPLOYMENT_APPS_V1_SCHEMA =
  'https://raw.githubusercontent.com/yannh/kubernetes-json-schema/master/v1.33.9-standalone-strict/deployment-apps-v1.json'

/**
 * Мінімальний Deployment з `$schema` yannh (спільний для інтеграційних сценаріїв check-k8s).
 * @param {string} depSchema URL схеми для `# yaml-language-server: $schema=…`
 * @returns {string} YAML-рядок мінімального Deployment
 */
function minimalDeploymentWithSchema(depSchema) {
  return `# yaml-language-server: $schema=${depSchema}
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
}

describe('check без цільових файлів', () => {
  test('check-docker — 0, якщо немає Dockerfile', async () => {
    await withTmpDir(async dir => {
      expect(await checkDocker(dir)).toBe(0)
    })
  })

  test('check-k8s — 0, якщо немає yaml під k8s', async () => {
    await withTmpDir(async dir => {
      expect(await checkK8s(dir)).toBe(0)
    })
  })

  // Стаб kubescape (exit 0) у PATH: реальний `kubescape scan` на старті тягне
  // артефакти/конфіг із хмарних API — на повільній чи закритій мережі це
  // десятки секунд wall-time і зрив testTimeout. Очікуване порушення тут
  // продукують rego-політика k8s.kustomization (remove+add) та JS-перевірка
  // validateKustomizationPatchTargetsResolved (ghost target), не kubescape.
  test('check-k8s — 1, якщо kustomization з remove+add на той самий path', async () => {
    await withBinStubInPath('kubescape', async () => {
      await withTmpDir(async dir => {
        await ensureDir(join(dir, 'app/k8s/ua'))
        const dep = minimalDeploymentWithSchema(YANNH_DEPLOYMENT_APPS_V1_SCHEMA)
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
        await writeFile(join(dir, 'app/k8s/ua/deploy.yaml'), dep, 'utf8')
        await writeFile(join(dir, 'app/k8s/ua/kustomization.yaml'), k, 'utf8')
        expect(await checkK8s(dir)).toBe(1)
      })
    })
  })

  test('check-k8s — 1, якщо patch.target вказує на неіснуючий ресурс', async () => {
    await withBinStubInPath('kubescape', async () => {
      await withTmpDir(async dir => {
        await ensureDir(join(dir, 'app/k8s/ua'))
        const dep = minimalDeploymentWithSchema(YANNH_DEPLOYMENT_APPS_V1_SCHEMA)
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
        await writeFile(join(dir, 'app/k8s/ua/deploy.yaml'), dep, 'utf8')
        await writeFile(join(dir, 'app/k8s/ua/kustomization.yaml'), k, 'utf8')
        expect(await checkK8s(dir)).toBe(1)
      })
    })
  })
})
