/**
 * Тести пошуку коренів каталогів `k8s` для run-k8s.
 */
import { tmpdir } from 'node:os'
import { describe, expect, test } from 'vitest'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { buildKubescapeExceptionsArgs, findK8sRoots, findKustomizationDirs, k8sRootFromFile } from '../lint.mjs'
import { withTmpCwd } from '../../../../scripts/utils/test-helpers.mjs'

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
    await withTmpCwd(async root => {
      await mkdir(join('p1', 'k8s'), { recursive: true })
      await mkdir(join('p2', 'k8s', 'base'), { recursive: true })
      await writeFile(join('p1', 'k8s', 'a.yaml'), 'a: 1\n', 'utf8')
      await writeFile(join('p2', 'k8s', 'base', 'b.yaml'), 'b: 2\n', 'utf8')
      const dirs = await findK8sRoots(root)
      expect(dirs.length).toBe(2)
      expect(dirs.includes(join(root, 'p1', 'k8s'))).toBe(true)
      expect(dirs.includes(join(root, 'p2', 'k8s'))).toBe(true)
    })
  })

  test('додає --exceptions <abs-path>, коли в корені є .kubescape-exceptions.json', async () => {
    await withTmpCwd(async root => {
      await writeFile(join(root, '.kubescape-exceptions.json'), '[]', 'utf8')
      const args = buildKubescapeExceptionsArgs(root)
      expect(args).toEqual(['--exceptions', join(root, '.kubescape-exceptions.json')])
    })
  })

  test('повертає [], коли .kubescape-exceptions.json відсутній', async () => {
    await withTmpCwd(root => {
      expect(buildKubescapeExceptionsArgs(root)).toEqual([])
    })
  })

  test('findKustomizationDirs: повертає dir-и з kustomization.yaml (kind ≠ Component)', async () => {
    await withTmpCwd(async root => {
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

  test('findKustomizationDirs: порожній масив, якщо kustomization.yaml немає', async () => {
    await withTmpCwd(async root => {
      const k8sDir = join(root, 'plain', 'k8s')
      await mkdir(k8sDir, { recursive: true })
      await writeFile(join(k8sDir, 'deploy.yaml'), 'apiVersion: apps/v1\nkind: Deployment\n', 'utf8')
      const dirs = await findKustomizationDirs(k8sDir)
      expect(dirs).toEqual([])
    })
  })

  test('не включає .github/workflows, навіть коли корінь репо називається k8s/', async () => {
    // Worst-case з користувацького bug-report: репо в `…/abie/k8s/`. Без relativize у
    // pathHasK8sSegment усі yaml-файли проєкту потрапляли б у k8s-сканер, включно з
    // `.github/workflows/*.yml` (територія `ga.mdc`, де канон — `.yml`).
    await withTmpCwd(async tmp => {
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
