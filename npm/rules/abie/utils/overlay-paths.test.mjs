import { describe, expect, test } from 'bun:test'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import {
  abieOverlayK8sTreeHasDeployment,
  abieOverlayRequiresHttpRouteByVite,
  abiePackageDirFromK8sOverlay,
  isAbieK8sBaseYamlPath,
  isK8sYamlInAbiePackageExcludingUaOverlay,
  isUaKustomizationPath
} from './overlay-paths.mjs'
import { ensureDir, withTmpCwd } from '../../../scripts/utils/test-helpers.mjs'

describe('overlay-paths', () => {
  test('isUaKustomizationPath', () => {
    expect(isUaKustomizationPath('app/k8s/overlays/ua/kustomization.yaml')).toBe(true)
    expect(isUaKustomizationPath(String.raw`x\k8s\ua\kustomization.yaml`)).toBe(true)
    expect(isUaKustomizationPath('app/k8s/base/kustomization.yaml')).toBe(false)
    expect(isUaKustomizationPath('app/k8s/ua/foo.yaml')).toBe(false)
  })

  test('abiePackageDirFromK8sOverlay', () => {
    const root = '/repo'
    expect(abiePackageDirFromK8sOverlay(root, join(root, 'app/k8s/ua/kustomization.yaml'))).toBe(join(root, 'app'))
    expect(abiePackageDirFromK8sOverlay(root, join(root, 'app/k8s/base/kustomization.yaml'))).toBe(null)
  })

  test('abieOverlayK8sTreeHasDeployment', () => {
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

  test('isAbieK8sBaseYamlPath', () => {
    expect(isAbieK8sBaseYamlPath('app/k8s/base/deploy.yaml')).toBe(true)
    expect(isAbieK8sBaseYamlPath(String.raw`pkg\k8s\base\a.yaml`)).toBe(true)
    expect(isAbieK8sBaseYamlPath('app/k8s/ua/kustomization.yaml')).toBe(false)
  })

  test('isK8sYamlInAbiePackageExcludingUaOverlay', () => {
    expect(isK8sYamlInAbiePackageExcludingUaOverlay('app/k8s/base/hr.yaml', 'app')).toBe(true)
    expect(isK8sYamlInAbiePackageExcludingUaOverlay('app/k8s/ua/kustomization.yaml', 'app')).toBe(false)
    expect(isK8sYamlInAbiePackageExcludingUaOverlay('other/k8s/base/x.yaml', 'app')).toBe(false)
  })
})
