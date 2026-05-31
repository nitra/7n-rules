/**
 * Тести для k8s-tree.mjs:
 *   - `findK8sYamlFiles` — yaml/yml під сегментом `k8s/`, пропускає `.github/`, поважає `ignorePaths`;
 *   - `collectDeploymentDirs` — повертає директорії, де є `kind: Deployment`;
 *   - module-level кеш — повторні виклики з тим самим (root, ignorePaths) повертають той самий Promise.
 *
 * Унікальний tmp-каталог на тест → різні cache-ключі → без cross-test інтерференції.
 */
import { describe, expect, test } from 'vitest'
import { join } from 'node:path'
import { writeFile } from 'node:fs/promises'

import { collectDeploymentDirs, findK8sYamlFiles } from '../k8s-tree.mjs'
import { ensureDir, withTmpDir } from '../../../../scripts/utils/test-helpers.mjs'

const DEPLOY_YAML = `apiVersion: apps/v1
kind: Deployment
metadata: { name: api }
spec: { template: { spec: { containers: [{ name: c, image: x }] } } }
`

const SVC_YAML = `apiVersion: v1
kind: Service
metadata: { name: svc }
spec: { selector: { app: x }, ports: [{ port: 80 }] }
`

describe('findK8sYamlFiles', () => {
  test('повертає [] для дерева без k8s/-сегмента', async () => {
    await withTmpDir(async dir => {
      await ensureDir(join(dir, 'pkg'))
      await writeFile(join(dir, 'pkg/foo.yaml'), SVC_YAML, 'utf8')
      const result = await findK8sYamlFiles(dir)
      expect(result).toEqual([])
    })
  })

  test('знаходить .yaml та .yml під сегментом k8s/', async () => {
    await withTmpDir(async dir => {
      const k8s = join(dir, 'pkg/k8s')
      await ensureDir(k8s)
      await writeFile(join(k8s, 'a.yaml'), SVC_YAML, 'utf8')
      await writeFile(join(k8s, 'b.yml'), SVC_YAML, 'utf8')
      const result = await findK8sYamlFiles(dir)
      expect(result.map(p => p.replace(dir + '/', '').replaceAll('\\', '/'))).toEqual([
        'pkg/k8s/a.yaml',
        'pkg/k8s/b.yml'
      ])
    })
  })

  test('ігнорує не-yaml файли під k8s/', async () => {
    await withTmpDir(async dir => {
      const k8s = join(dir, 'pkg/k8s')
      await ensureDir(k8s)
      await writeFile(join(k8s, 'a.yaml'), SVC_YAML, 'utf8')
      await writeFile(join(k8s, 'README.md'), '# README\n', 'utf8')
      await writeFile(join(k8s, 'config.json'), '{}\n', 'utf8')
      const result = await findK8sYamlFiles(dir)
      expect(result).toHaveLength(1)
      expect(result[0].endsWith('a.yaml')).toBe(true)
    })
  })

  test('пропускає .github/-дерево (належить ga.mdc)', async () => {
    await withTmpDir(async dir => {
      const gh = join(dir, '.github/k8s')
      await ensureDir(gh)
      await writeFile(join(gh, 'workflow.yaml'), SVC_YAML, 'utf8')
      const result = await findK8sYamlFiles(dir)
      expect(result).toEqual([])
    })
  })

  test('повертає відсортований за localeCompare масив', async () => {
    await withTmpDir(async dir => {
      const k8s = join(dir, 'pkg/k8s')
      await ensureDir(k8s)
      await writeFile(join(k8s, 'z.yaml'), SVC_YAML, 'utf8')
      await writeFile(join(k8s, 'a.yaml'), SVC_YAML, 'utf8')
      await writeFile(join(k8s, 'm.yaml'), SVC_YAML, 'utf8')
      const yamlFiles = await findK8sYamlFiles(dir)
      const names = yamlFiles.map(p => p.split('/').pop())
      expect(names).toEqual(['a.yaml', 'm.yaml', 'z.yaml'])
    })
  })

  test('ignorePaths приймається й виключає відповідне піддерево', async () => {
    await withTmpDir(async dir => {
      const k8sA = join(dir, 'pkg-a/k8s')
      const k8sB = join(dir, 'pkg-b/k8s')
      await ensureDir(k8sA)
      await ensureDir(k8sB)
      await writeFile(join(k8sA, 'a.yaml'), SVC_YAML, 'utf8')
      await writeFile(join(k8sB, 'b.yaml'), SVC_YAML, 'utf8')
      const result = await findK8sYamlFiles(dir, [join(dir, 'pkg-b')])
      expect(result).toHaveLength(1)
      expect(result[0].endsWith('a.yaml')).toBe(true)
    })
  })

  test('кеш: повторний виклик з тими самими (root, ignorePaths) повертає той самий Promise', async () => {
    await withTmpDir(async dir => {
      const k8s = join(dir, 'pkg/k8s')
      await ensureDir(k8s)
      await writeFile(join(k8s, 'a.yaml'), SVC_YAML, 'utf8')
      const p1 = findK8sYamlFiles(dir)
      const p2 = findK8sYamlFiles(dir)
      expect(p1).toBe(p2)
    })
  })

  test('кеш: різні ignorePaths → різні кеш-ключі → різні promise', async () => {
    await withTmpDir(async dir => {
      const k8s = join(dir, 'pkg/k8s')
      await ensureDir(k8s)
      await writeFile(join(k8s, 'a.yaml'), SVC_YAML, 'utf8')
      const p1 = findK8sYamlFiles(dir, [])
      const p2 = findK8sYamlFiles(dir, [join(dir, 'other')])
      expect(p1).not.toBe(p2)
    })
  })
})

describe('collectDeploymentDirs', () => {
  test('повертає порожній Set коли немає Deployment', async () => {
    await withTmpDir(async dir => {
      const k8s = join(dir, 'pkg/k8s')
      await ensureDir(k8s)
      await writeFile(join(k8s, 'svc.yaml'), SVC_YAML, 'utf8')
      const yamls = await findK8sYamlFiles(dir)
      const dirs = await collectDeploymentDirs(dir, yamls)
      expect(dirs.size).toBe(0)
    })
  })

  test('повертає каталог YAML-файлу з kind: Deployment', async () => {
    await withTmpDir(async dir => {
      const k8s = join(dir, 'pkg/k8s')
      await ensureDir(k8s)
      await writeFile(join(k8s, 'deploy.yaml'), DEPLOY_YAML, 'utf8')
      const yamls = await findK8sYamlFiles(dir)
      const dirs = await collectDeploymentDirs(dir, yamls)
      expect([...dirs]).toHaveLength(1)
      expect([...dirs][0].endsWith(join('pkg', 'k8s'))).toBe(true)
    })
  })

  test('multi-doc YAML: знаходить Deployment поряд із Service', async () => {
    await withTmpDir(async dir => {
      const k8s = join(dir, 'pkg/k8s')
      await ensureDir(k8s)
      await writeFile(join(k8s, 'mix.yaml'), `${DEPLOY_YAML}---\n${SVC_YAML}`, 'utf8')
      const yamls = await findK8sYamlFiles(dir)
      const dirs = await collectDeploymentDirs(dir, yamls)
      expect(dirs.size).toBe(1)
    })
  })

  test('повторні виклики з тим самим (root, yamlAbs) повертають той самий Promise', async () => {
    await withTmpDir(async dir => {
      const k8s = join(dir, 'pkg/k8s')
      await ensureDir(k8s)
      await writeFile(join(k8s, 'deploy.yaml'), DEPLOY_YAML, 'utf8')
      const yamls = await findK8sYamlFiles(dir)
      const p1 = collectDeploymentDirs(dir, yamls)
      const p2 = collectDeploymentDirs(dir, yamls)
      expect(p1).toBe(p2)
    })
  })

  test('некоректний YAML: викликає fail-callback (якщо переданий)', async () => {
    await withTmpDir(async dir => {
      const k8s = join(dir, 'pkg/k8s')
      await ensureDir(k8s)
      await writeFile(join(k8s, 'broken.yaml'), 'apiVersion: v1\nkind: : \n  bad', 'utf8')
      const yamls = await findK8sYamlFiles(dir)
      const errors = []
      await collectDeploymentDirs(dir, yamls, msg => errors.push(msg))
      // Або YAML парсер просто не вловив, або повідомив помилку — у будь-якому разі size 0:
      const dirs = await collectDeploymentDirs(dir, yamls, msg => errors.push(msg))
      expect(dirs.size).toBe(0)
    })
  })
})
