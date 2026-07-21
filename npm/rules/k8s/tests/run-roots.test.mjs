/**
 * Тести пошуку коренів каталогів `k8s` для run-k8s.
 */
import { tmpdir } from 'node:os'
import { describe, expect, test } from 'vitest'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { readFileSync } from 'node:fs'

import {
  autoJobCronJobProbeExceptions,
  buildKubescapeExceptionsArgs,
  findK8sRoots,
  findKustomizationDirs,
  k8sRootFromFile,
  pathHasK8sSegment
} from '../manifests/main.mjs'
import { withTmpDir } from '../../../scripts/utils/test-helpers.mjs'

describe('pathHasK8sSegment', () => {
  test('true — шлях містить сегмент k8s', () => {
    expect(pathHasK8sSegment('/app/k8s/deploy.yaml')).toBe(true)
  })

  test('true — з relativize: файл відносно root має сегмент k8s', () => {
    expect(pathHasK8sSegment('/project/k8s/base/pod.yaml', '/project')).toBe(true)
  })

  test('false — шлях не містить k8s', () => {
    expect(pathHasK8sSegment('/app/src/main.js')).toBe(false)
  })

  test('false — порожній відносний шлях після relativize', () => {
    expect(pathHasK8sSegment('/app/k8s', '/app/k8s')).toBe(false)
  })

  test('true — два k8s-сегменти у шляху', () => {
    expect(pathHasK8sSegment('/k8s/project/k8s/file.yaml', '/k8s/project')).toBe(true)
  })
})

describe('k8sRootFromFile', () => {
  test('повертає каталог k8s зі шляху до yaml', () => {
    const root = tmpdir()
    const f = join(root, 'app', 'k8s', 'base', 'd.yaml')
    expect(k8sRootFromFile(f)).toBe(join(root, 'app', 'k8s'))
  })

  test('null, якщо сегмента k8s немає', () => {
    expect(k8sRootFromFile(join(tmpdir(), 'a', 'b', 'c.yaml'))).toBe(null)
  })
})

describe('findK8sRoots', () => {
  test('знаходить унікальні корені k8s', async () => {
    await withTmpDir(async root => {
      await mkdir(join(root, 'p1', 'k8s'), { recursive: true })
      await mkdir(join(root, 'p2', 'k8s', 'base'), { recursive: true })
      await writeFile(join(root, 'p1', 'k8s', 'a.yaml'), 'a: 1\n', 'utf8')
      await writeFile(join(root, 'p2', 'k8s', 'base', 'b.yaml'), 'b: 2\n', 'utf8')
      const dirs = await findK8sRoots(root)
      expect(dirs.length).toBe(2)
      expect(dirs.includes(join(root, 'p1', 'k8s'))).toBe(true)
      expect(dirs.includes(join(root, 'p2', 'k8s'))).toBe(true)
    })
  })

  test('додає --exceptions <abs-path>, коли в корені є .kubescape-exceptions.json', async () => {
    await withTmpDir(async root => {
      await writeFile(join(root, '.kubescape-exceptions.json'), '[]', 'utf8')
      const args = buildKubescapeExceptionsArgs(root)
      expect(args).toEqual(['--exceptions', join(root, '.kubescape-exceptions.json')])
    })
  })

  test('повертає [], коли .kubescape-exceptions.json відсутній', async () => {
    await withTmpDir(root => {
      expect(buildKubescapeExceptionsArgs(root)).toEqual([])
    })
  })
})

describe('autoJobCronJobProbeExceptions', () => {
  test('генерує запис C-0056/C-0018 для CronJob з name+namespace', () => {
    const yaml = `apiVersion: batch/v1
kind: CronJob
metadata:
  name: assign-request
  namespace: dev
spec:
  schedule: "*/5 * * * *"
`
    const out = autoJobCronJobProbeExceptions(yaml)
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({
      policyType: 'postureExceptionPolicy',
      actions: ['alertOnly'],
      resources: [
        { designatorType: 'Attributes', attributes: { kind: 'CronJob', name: 'assign-request', namespace: 'dev' } }
      ],
      posturePolicies: [{ controlID: 'C-0056' }, { controlID: 'C-0018' }]
    })
  })

  test('Job без namespace — attributes без namespace-ключа', () => {
    const yaml = `apiVersion: batch/v1
kind: Job
metadata:
  name: migrate
`
    const out = autoJobCronJobProbeExceptions(yaml)
    expect(out).toHaveLength(1)
    expect(out[0].resources[0].attributes).toEqual({ kind: 'Job', name: 'migrate' })
  })

  test('Deployment — жодного запису (control реально застосовний)', () => {
    const yaml = `apiVersion: apps/v1
kind: Deployment
metadata:
  name: api
  namespace: dev
`
    expect(autoJobCronJobProbeExceptions(yaml)).toEqual([])
  })

  test('CronJob без metadata.name — пропускається (немає чим гейтувати виняток)', () => {
    const yaml = `apiVersion: batch/v1
kind: CronJob
spec:
  schedule: "*/5 * * * *"
`
    expect(autoJobCronJobProbeExceptions(yaml)).toEqual([])
  })

  test('декілька документів — по одному запису на кожен Job/CronJob, Deployment пропущено', () => {
    const yaml = `apiVersion: batch/v1
kind: CronJob
metadata:
  name: a
  namespace: dev
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: b
  namespace: dev
---
apiVersion: batch/v1
kind: Job
metadata:
  name: c
  namespace: dev
`
    const out = autoJobCronJobProbeExceptions(yaml)
    expect(out.map(e => e.resources[0].attributes.name)).toEqual(['a', 'c'])
  })
})

describe('buildKubescapeExceptionsArgs з autoExceptions (merge)', () => {
  test('без user-файлу і без autoExceptions — []', async () => {
    await withTmpDir(root => {
      expect(buildKubescapeExceptionsArgs(root, [])).toEqual([])
    })
  })

  test('з autoExceptions, без user-файлу — пише tmp-файл лише з auto-записами', async () => {
    await withTmpDir(root => {
      const auto = [{ name: 'auto-cronjob-dev-a-probes', policyType: 'postureExceptionPolicy' }]
      const args = buildKubescapeExceptionsArgs(root, auto)
      expect(args[0]).toBe('--exceptions')
      expect(args[1]).not.toBe(join(root, '.kubescape-exceptions.json'))
      const written = JSON.parse(readFileSync(args[1], 'utf8'))
      expect(written).toEqual(auto)
    })
  })

  test('мержить user-файл з autoExceptions в один tmp-файл', async () => {
    await withTmpDir(async root => {
      const userExceptions = [{ name: 'hasura-jwt-public-config', policyType: 'postureExceptionPolicy' }]
      await writeFile(join(root, '.kubescape-exceptions.json'), JSON.stringify(userExceptions), 'utf8')
      const auto = [{ name: 'auto-cronjob-dev-a-probes', policyType: 'postureExceptionPolicy' }]
      const args = buildKubescapeExceptionsArgs(root, auto)
      const written = JSON.parse(readFileSync(args[1], 'utf8'))
      expect(written).toEqual([...userExceptions, ...auto])
    })
  })
})

describe('findKustomizationDirs', () => {
  test('повертає dir-и з kustomization.yaml (kind ≠ Component)', async () => {
    await withTmpDir(async root => {
      const k8sDir = join(root, 'app', 'k8s')
      await mkdir(join(k8sDir, 'base'), { recursive: true })
      await mkdir(join(k8sDir, 'components'), { recursive: true })
      await mkdir(join(k8sDir, 'ua'), { recursive: true })
      // base: Kustomization (без явного kind теж рахуємо)
      await writeFile(
        join(k8sDir, 'base', 'kustomization.yaml'),
        'namespace: dev\nresources:\n  - deploy.yaml\n',
        'utf8'
      )
      // components: Component — пропускається
      await writeFile(
        join(k8sDir, 'components', 'kustomization.yaml'),
        'apiVersion: kustomize.config.k8s.io/v1alpha1\nkind: Component\nresources:\n  - hpa.yaml\n  - pdb.yaml\n',
        'utf8'
      )
      // ua: явний kind: Kustomization
      await writeFile(
        join(k8sDir, 'ua', 'kustomization.yaml'),
        'apiVersion: kustomize.config.k8s.io/v1beta1\nkind: Kustomization\nnamespace: ua\nresources:\n  - ../base\n',
        'utf8'
      )
      const dirs = await findKustomizationDirs(k8sDir)
      expect(dirs).toEqual([join(k8sDir, 'base'), join(k8sDir, 'ua')])
    })
  })

  test('порожній масив, якщо kustomization.yaml немає', async () => {
    await withTmpDir(async root => {
      const k8sDir = join(root, 'plain', 'k8s')
      await mkdir(k8sDir, { recursive: true })
      await writeFile(join(k8sDir, 'deploy.yaml'), 'apiVersion: apps/v1\nkind: Deployment\n', 'utf8')
      const dirs = await findKustomizationDirs(k8sDir)
      expect(dirs).toEqual([])
    })
  })
})

describe('findK8sRoots (edge cases)', () => {
  test('не включає .github/workflows, навіть коли корінь репо називається k8s/', async () => {
    // Worst-case з користувацького bug-report: репо в `…/abie/k8s/`. Без relativize у
    // pathHasK8sSegment усі yaml-файли проєкту потрапляли б у k8s-сканер, включно з
    // `.github/workflows/*.yml` (територія `ga.mdc`, де канон — `.yml`).
    await withTmpDir(async tmp => {
      const projectRoot = join(tmp, 'k8s')
      await mkdir(join(projectRoot, '.github', 'workflows'), { recursive: true })
      await mkdir(join(projectRoot, 'adminer', 'k8s', 'base'), { recursive: true })
      await writeFile(join(projectRoot, '.github', 'workflows', 'apply-k8s.yml'), 'on: push\n', 'utf8')
      await writeFile(join(projectRoot, 'adminer', 'k8s', 'base', 'hr.yaml'), 'a: 1\n', 'utf8')
      const dirs = await findK8sRoots(projectRoot)
      expect(dirs).toEqual([join(projectRoot, 'adminer', 'k8s')])
    })
  })
})
