/**
 * Тести визначення очікуваного $schema та сегмента `k8s` у шляху (check-k8s).
 */
import { describe, expect, test } from 'bun:test'

import {
  deploymentImagePullPolicyViolation,
  deploymentResourcesViolation,
  expectedSchemaUrl,
  isRuKustomizationPath,
  metadataNamespaceForbiddenViolation,
  pathHasK8sSegment,
  ruKustomizationHasHealthCheckDeletePatch
} from '../scripts/check-k8s.mjs'

describe('isRuKustomizationPath', () => {
  test('true для …/ru/kustomization.yaml', () => {
    expect(isRuKustomizationPath('app/k8s/overlays/ru/kustomization.yaml')).toBe(true)
    expect(isRuKustomizationPath(String.raw`x\k8s\ru\kustomization.yaml`)).toBe(true)
  })

  test('false для інших kustomization', () => {
    expect(isRuKustomizationPath('app/k8s/base/kustomization.yaml')).toBe(false)
    expect(isRuKustomizationPath('app/k8s/ru/foo.yaml')).toBe(false)
  })
})

describe('ruKustomizationHasHealthCheckDeletePatch', () => {
  test('true для patch delete HealthCheckPolicy', () => {
    const y = `
patches:
  - target:
      kind: HealthCheckPolicy
    patch: |-
      kind: HealthCheckPolicy
      metadata:
        name: my-svc
      $patch: delete
`
    expect(ruKustomizationHasHealthCheckDeletePatch(y)).toBe(true)
  })

  test('false без $patch: delete', () => {
    expect(ruKustomizationHasHealthCheckDeletePatch('kind: HealthCheckPolicy')).toBe(false)
  })
})

describe('pathHasK8sSegment', () => {
  test('true, коли є компонент k8s', () => {
    expect(pathHasK8sSegment('apps/foo/k8s/deployment.yaml')).toBe(true)
    expect(pathHasK8sSegment(String.raw`k8s\a.yml`)).toBe(true)
  })

  test('false без сегмента k8s', () => {
    expect(pathHasK8sSegment('foo/bar/baz.yaml')).toBe(false)
  })
})

describe('deploymentResourcesViolation', () => {
  test('null для не-Deployment', () => {
    expect(deploymentResourcesViolation({ kind: 'Service' })).toBeNull()
  })

  test('null без масиву containers', () => {
    expect(deploymentResourcesViolation({ kind: 'Deployment', spec: { template: { spec: {} } } })).toBeNull()
  })

  test('помилка, коли немає resources', () => {
    const manifest = {
      kind: 'Deployment',
      spec: { template: { spec: { containers: [{ name: 'app', image: 'x:y' }] } } }
    }
    expect(deploymentResourcesViolation(manifest)).toContain('resources: {}')
  })

  test('ok для resources: {}', () => {
    const manifest = {
      kind: 'Deployment',
      spec: { template: { spec: { containers: [{ name: 'app', image: 'x:y', resources: {} }] } } }
    }
    expect(deploymentResourcesViolation(manifest)).toBeNull()
  })

  test('ok для resources з limits', () => {
    const manifest = {
      kind: 'Deployment',
      spec: {
        template: {
          spec: {
            containers: [{ name: 'app', image: 'x:y', resources: { limits: { memory: '128Mi' } } }]
          }
        }
      }
    }
    expect(deploymentResourcesViolation(manifest)).toBeNull()
  })
})

describe('deploymentImagePullPolicyViolation', () => {
  test('null для не-Deployment', () => {
    expect(deploymentImagePullPolicyViolation({ kind: 'Service' })).toBeNull()
  })

  test('помилка без imagePullPolicy', () => {
    const manifest = {
      kind: 'Deployment',
      spec: {
        template: {
          spec: {
            containers: [{ name: 'app', image: 'x:y', resources: {} }]
          }
        }
      }
    }
    expect(deploymentImagePullPolicyViolation(manifest)).toContain('Always')
  })

  test('ok для imagePullPolicy: Always', () => {
    const manifest = {
      kind: 'Deployment',
      spec: {
        template: {
          spec: {
            containers: [{ name: 'app', image: 'x:y', resources: {}, imagePullPolicy: 'Always' }]
          }
        }
      }
    }
    expect(deploymentImagePullPolicyViolation(manifest)).toBeNull()
  })
})

describe('metadataNamespaceForbiddenViolation', () => {
  test('null без metadata.namespace', () => {
    expect(metadataNamespaceForbiddenViolation({ kind: 'Deployment', metadata: { name: 'x' } })).toBeNull()
  })

  test('помилка при metadata.namespace', () => {
    expect(
      metadataNamespaceForbiddenViolation({ kind: 'Deployment', metadata: { name: 'x', namespace: 'ns' } })
    ).toContain('metadata.namespace')
  })
})

describe('expectedSchemaUrl', () => {
  test('kustomization.yaml — Schema Store', () => {
    const { expected, reason } = expectedSchemaUrl('base/k8s/kustomization.yaml', '')
    expect(expected).toContain('kustomization.json')
    expect(reason).toContain('kustomization')
  })

  test('core v1 — yannh', () => {
    const doc = 'apiVersion: v1\nkind: Service\nmetadata:\n  name: x\n'
    const { expected, reason } = expectedSchemaUrl('base/k8s/svc.yaml', doc)
    expect(expected).toMatch(/service-v1\.json$/)
    expect(reason).toContain('yannh')
  })

  test('apps/v1 Deployment — yannh', () => {
    const doc = 'apiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: x\n'
    const { expected } = expectedSchemaUrl('base/k8s/d.yaml', doc)
    expect(expected).toContain('deployment-apps-v1.json')
  })

  test('CRD-група — datree (GitHub Pages)', () => {
    const doc = 'apiVersion: gateway.networking.k8s.io/v1\nkind: HTTPRoute\nmetadata:\n  name: x\n'
    const { expected, reason } = expectedSchemaUrl('base/k8s/route.yaml', doc)
    expect(expected).toBe('https://datreeio.github.io/CRDs-catalog/gateway.networking.k8s.io/httproute_v1.json')
    expect(reason).toContain('datree')
  })

  test('HTTPRoute v1beta1 — datree (GitHub Pages)', () => {
    const doc = 'apiVersion: gateway.networking.k8s.io/v1beta1\nkind: HTTPRoute\nmetadata:\n  name: x\n'
    const { expected } = expectedSchemaUrl('base/k8s/route-beta.yaml', doc)
    expect(expected).toBe('https://datreeio.github.io/CRDs-catalog/gateway.networking.k8s.io/httproute_v1beta1.json')
  })

  test('networking.gke.io HealthCheckPolicy — datree', () => {
    const doc = 'apiVersion: networking.gke.io/v1\nkind: HealthCheckPolicy\nmetadata:\n  name: x\n'
    const { expected } = expectedSchemaUrl('base/k8s/hcp.yaml', doc)
    expect(expected).toBe('https://datreeio.github.io/CRDs-catalog/networking.gke.io/healthcheckpolicy_v1.json')
  })

  test('Secret v1 type kubernetes.io/basic-auth — yannh secret-v1.json', () => {
    const doc =
      'apiVersion: v1\nkind: Secret\ntype: kubernetes.io/basic-auth\nmetadata:\n  name: x\nstringData:\n  username: u\n'
    const { expected, reason } = expectedSchemaUrl('base/k8s/basic-auth.yaml', doc)
    expect(expected).toBe(
      'https://raw.githubusercontent.com/yannh/kubernetes-json-schema/master/v1.33.9-standalone-strict/secret-v1.json'
    )
    expect(reason).toContain('yannh')
  })

  test('InfisicalSecret v1alpha1 — datree raw (не GitHub Pages)', () => {
    const doc = 'apiVersion: secrets.infisical.com/v1alpha1\nkind: InfisicalSecret\nmetadata:\n  name: x\nspec: {}\n'
    const { expected, reason } = expectedSchemaUrl('base/k8s/infisical.yaml', doc)
    expect(expected).toBe(
      'https://raw.githubusercontent.com/datreeio/CRDs-catalog/main/secrets.infisical.com/infisicalsecret_v1alpha1.json'
    )
    expect(reason).toContain('InfisicalSecret')
  })
})
