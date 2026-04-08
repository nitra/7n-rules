/**
 * Тести check-abie.mjs: умовне ввімкнення через .n-cursor.json, ignore_branches, hc.yaml.
 */
import { describe, expect, test } from 'bun:test'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import {
  ABIE_HC_SCHEMA_URL,
  ABIE_REQUIRED_IGNORE_BRANCHES,
  ignoreBranchesIncludesRequired,
  parseCleanMergedIgnoreBranches,
  validateAbieHcYaml,
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
      containers: []
`
      await writeFile(join('app/k8s/base/deploy.yaml'), dep, 'utf8')
      expect(await check()).toBe(1)
    })
  })

  test('abie: Deployment + hc.yaml + ru patch — 0', async () => {
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
      containers: []
`
      await writeFile(join('app/k8s/base/deploy.yaml'), dep, 'utf8')
      await writeFile(join('app/k8s/base/hc.yaml'), HC_MIN, 'utf8')
      const ruK = `apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
patches:
  - target:
      kind: HealthCheckPolicy
    patch: |-
      kind: HealthCheckPolicy
      metadata:
        name: my-svc
      $patch: delete
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
