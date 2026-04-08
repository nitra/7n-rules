/**
 * Тести визначення очікуваного $schema та сегмента `k8s` у шляху (check-k8s).
 */
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { describe, expect, test } from 'bun:test'

import {
  baseKustomizationNamespaceViolation,
  classifyBackendConfigManifestPresence,
  collectKustomizeManagedRelPaths,
  deploymentHasuraGraphqlEngineImageViolation,
  deploymentResourcesViolation,
  HASURA_GRAPHQL_ENGINE_IMAGE,
  SERVICE_FORBIDDEN_GCP_ANNOTATION_KEYS,
  serviceForbiddenGcpAnnotationsViolation,
  expectedSchemaUrl,
  isBaseKustomizationPath,
  isClusterScopedKubernetesKind,
  isK8sBaseManifestYamlPath,
  isForbiddenK8sDevPath,
  metadataNamespaceForbiddenViolation,
  metadataNamespaceRequiredViolation,
  pathHasK8sSegment,
  ruKustomizationHasHealthCheckDeletePatch,
  collectGatewayApiRouteBackendServiceNames,
  kustomizationSvcYamlMissingSvcHlViolation,
  serviceSvcHlYamlHeadlessViolation,
  serviceSvcYamlClusterIpTypeViolation
} from '../scripts/check-k8s.mjs'

describe('classifyBackendConfigManifestPresence', () => {
  test('only для одного BackendConfig', () => {
    const y = `apiVersion: cloud.google.com/v1
kind: BackendConfig
metadata:
  name: x
`
    expect(classifyBackendConfigManifestPresence(y)).toBe('only')
  })

  test('only для кількох BackendConfig', () => {
    const y = `apiVersion: cloud.google.com/v1
kind: BackendConfig
metadata:
  name: a
---
apiVersion: cloud.google.com/v1
kind: BackendConfig
metadata:
  name: b
`
    expect(classifyBackendConfigManifestPresence(y)).toBe('only')
  })

  test('mixed з Service', () => {
    const y = `apiVersion: cloud.google.com/v1
kind: BackendConfig
metadata:
  name: x
---
apiVersion: v1
kind: Service
metadata:
  name: s
`
    expect(classifyBackendConfigManifestPresence(y)).toBe('mixed')
  })

  test('none без BackendConfig', () => {
    expect(classifyBackendConfigManifestPresence('apiVersion: v1\nkind: Service\nmetadata:\n  name: s\n')).toBe('none')
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

describe('isForbiddenK8sDevPath', () => {
  test('true для …/k8s/dev/…', () => {
    expect(isForbiddenK8sDevPath('app/k8s/dev/foo.yaml')).toBe(true)
  })

  test('false без k8s/dev як каталогу', () => {
    expect(isForbiddenK8sDevPath('app/k8s/base/kustomization.yaml')).toBe(false)
    expect(isForbiddenK8sDevPath('app/k8s/development.yaml')).toBe(false)
  })
})

describe('isBaseKustomizationPath', () => {
  test('true для k8s/base/kustomization.yaml', () => {
    expect(isBaseKustomizationPath('x/k8s/base/kustomization.yaml')).toBe(true)
    expect(isBaseKustomizationPath('k8s/base/kustomization.yaml')).toBe(true)
  })

  test('false для kustomization.yml', () => {
    expect(isBaseKustomizationPath('k8s/base/kustomization.yml')).toBe(false)
  })

  test('false для інших kustomization', () => {
    expect(isBaseKustomizationPath('k8s/prod/kustomization.yaml')).toBe(false)
  })
})

describe('baseKustomizationNamespaceViolation', () => {
  test('null для непорожнього namespace', () => {
    expect(baseKustomizationNamespaceViolation({ namespace: 'dev', resources: [] })).toBeNull()
  })

  test('помилка без namespace', () => {
    expect(baseKustomizationNamespaceViolation({ resources: [] })).toContain('namespace')
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

describe('deploymentHasuraGraphqlEngineImageViolation', () => {
  test('null для не-Deployment', () => {
    expect(deploymentHasuraGraphqlEngineImageViolation({ kind: 'Service' })).toBeNull()
  })

  test('null без hasura/graphql-engine', () => {
    const manifest = {
      kind: 'Deployment',
      spec: {
        template: {
          spec: {
            containers: [{ name: 'app', image: 'nginx:1', resources: {} }]
          }
        }
      }
    }
    expect(deploymentHasuraGraphqlEngineImageViolation(manifest)).toBeNull()
  })

  test('ok для канонічного образу', () => {
    const manifest = {
      kind: 'Deployment',
      spec: {
        template: {
          spec: {
            containers: [
              {
                name: 'hasura',
                image: HASURA_GRAPHQL_ENGINE_IMAGE,
                resources: {}
              }
            ]
          }
        }
      }
    }
    expect(deploymentHasuraGraphqlEngineImageViolation(manifest)).toBeNull()
  })

  test('ok для docker.io/…', () => {
    const manifest = {
      kind: 'Deployment',
      spec: {
        template: {
          spec: {
            containers: [
              {
                name: 'hasura',
                image: `docker.io/${HASURA_GRAPHQL_ENGINE_IMAGE}`,
                resources: {}
              }
            ]
          }
        }
      }
    }
    expect(deploymentHasuraGraphqlEngineImageViolation(manifest)).toBeNull()
  })

  test('помилка для іншого тегу образу', () => {
    const manifest = {
      kind: 'Deployment',
      spec: {
        template: {
          spec: {
            containers: [
              {
                name: 'hasura',
                image: 'hasura/graphql-engine:v2.40.0',
                resources: {}
              }
            ]
          }
        }
      }
    }
    expect(deploymentHasuraGraphqlEngineImageViolation(manifest)).toContain(HASURA_GRAPHQL_ENGINE_IMAGE)
  })

  test('перевірка initContainers', () => {
    const manifest = {
      kind: 'Deployment',
      spec: {
        template: {
          spec: {
            initContainers: [
              {
                name: 'h',
                image: 'hasura/graphql-engine:wrong',
                resources: {}
              }
            ],
            containers: [
              {
                name: 'app',
                image: 'nginx:1',
                resources: {}
              }
            ]
          }
        }
      }
    }
    expect(deploymentHasuraGraphqlEngineImageViolation(manifest)).toContain('initContainers')
  })
})

describe('serviceForbiddenGcpAnnotationsViolation', () => {
  test('null для не-Service', () => {
    expect(serviceForbiddenGcpAnnotationsViolation({ kind: 'Deployment' })).toBeNull()
  })

  test('null без metadata.annotations', () => {
    expect(
      serviceForbiddenGcpAnnotationsViolation({
        apiVersion: 'v1',
        kind: 'Service',
        metadata: { name: 'x' }
      })
    ).toBeNull()
  })

  test('null з дозволеними анотаціями', () => {
    expect(
      serviceForbiddenGcpAnnotationsViolation({
        apiVersion: 'v1',
        kind: 'Service',
        metadata: { name: 'x', annotations: { 'prometheus.io/scrape': 'true' } }
      })
    ).toBeNull()
  })

  test('помилка для cloud.google.com/neg', () => {
    const v = serviceForbiddenGcpAnnotationsViolation({
      apiVersion: 'v1',
      kind: 'Service',
      metadata: { name: 'x', annotations: { 'cloud.google.com/neg': '{"ingress":true}' } }
    })
    expect(v).toContain('cloud.google.com/neg')
  })

  test('помилка для обох ключів', () => {
    const v = serviceForbiddenGcpAnnotationsViolation({
      apiVersion: 'v1',
      kind: 'Service',
      metadata: {
        name: 'x',
        annotations: {
          'cloud.google.com/neg': 'x',
          'cloud.google.com/backend-config': '{"default":"x"}'
        }
      }
    })
    expect(v).toContain('cloud.google.com/neg')
    expect(v).toContain('cloud.google.com/backend-config')
  })

  test('SERVICE_FORBIDDEN_GCP_ANNOTATION_KEYS містить обидва ключі', () => {
    expect([...SERVICE_FORBIDDEN_GCP_ANNOTATION_KEYS].toSorted()).toEqual(
      ['cloud.google.com/backend-config', 'cloud.google.com/neg'].toSorted()
    )
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

describe('isClusterScopedKubernetesKind', () => {
  test('true для ClusterRole', () => {
    expect(isClusterScopedKubernetesKind('ClusterRole')).toBe(true)
  })

  test('false для Deployment', () => {
    expect(isClusterScopedKubernetesKind('Deployment')).toBe(false)
  })
})

describe('metadataNamespaceRequiredViolation', () => {
  test('null для кластерного kind', () => {
    expect(
      metadataNamespaceRequiredViolation({ apiVersion: 'rbac.authorization.k8s.io/v1', kind: 'ClusterRole' })
    ).toBeNull()
  })

  test('null без apiVersion/kind', () => {
    expect(metadataNamespaceRequiredViolation({ metadata: { name: 'x' } })).toBeNull()
  })

  test('помилка без namespace у namespaced ресурсі', () => {
    expect(
      metadataNamespaceRequiredViolation({
        apiVersion: 'v1',
        kind: 'ConfigMap',
        metadata: { name: 'cm' }
      })
    ).toContain('metadata.namespace')
  })

  test('текст для k8s/base згадує base', () => {
    expect(
      metadataNamespaceRequiredViolation(
        {
          apiVersion: 'v1',
          kind: 'ConfigMap',
          metadata: { name: 'cm' }
        },
        true
      )
    ).toContain('k8s/base')
  })

  test('ok з непорожнім namespace', () => {
    expect(
      metadataNamespaceRequiredViolation({
        apiVersion: 'v1',
        kind: 'ConfigMap',
        metadata: { name: 'cm', namespace: 'app' }
      })
    ).toBeNull()
  })
})

describe('isK8sBaseManifestYamlPath', () => {
  test('true для dep.yaml у k8s/base', () => {
    expect(isK8sBaseManifestYamlPath('app/k8s/base/dep.yaml', 'dep.yaml')).toBe(true)
  })

  test('false для kustomization.yaml', () => {
    expect(isK8sBaseManifestYamlPath('app/k8s/base/kustomization.yaml', 'kustomization.yaml')).toBe(false)
  })

  test('false поза base', () => {
    expect(isK8sBaseManifestYamlPath('app/k8s/prod/patch.yaml', 'patch.yaml')).toBe(false)
  })
})

describe('collectKustomizeManagedRelPaths', () => {
  test('містить файл з resources та транзитивно з base', async () => {
    const root = await mkdtemp(join(tmpdir(), 'k8s-kust-'))
    const baseDir = join(root, 'svc/k8s/base')
    await mkdir(baseDir, { recursive: true })
    const kBase = `# yaml-language-server: $schema=https://json.schemastore.org/kustomization.json
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
namespace: dev
resources:
  - dep.yaml
`
    const dep = 'x'
    await writeFile(join(baseDir, 'kustomization.yaml'), kBase, 'utf8')
    await writeFile(join(baseDir, 'dep.yaml'), dep, 'utf8')

    const overlayDir = join(root, 'svc/k8s/prod')
    await mkdir(overlayDir, { recursive: true })
    const kProd = `# yaml-language-server: $schema=https://json.schemastore.org/kustomization.json
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
namespace: prod
resources:
  - ../base
`
    await writeFile(join(overlayDir, 'kustomization.yaml'), kProd, 'utf8')

    const yamlAbs = [
      join(baseDir, 'kustomization.yaml'),
      join(baseDir, 'dep.yaml'),
      join(overlayDir, 'kustomization.yaml')
    ]

    const managed = await collectKustomizeManagedRelPaths(root, yamlAbs)
    expect(managed.has('svc/k8s/base/dep.yaml')).toBe(true)
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

describe('serviceSvcYamlClusterIpTypeViolation', () => {
  test('ok для ClusterIP', () => {
    expect(
      serviceSvcYamlClusterIpTypeViolation({
        kind: 'Service',
        spec: { type: 'ClusterIP' }
      })
    ).toBeNull()
  })

  test('помилка без type', () => {
    expect(
      serviceSvcYamlClusterIpTypeViolation({
        kind: 'Service',
        spec: {}
      })
    ).toContain('ClusterIP')
  })

  test('не Service — null', () => {
    expect(serviceSvcYamlClusterIpTypeViolation({ kind: 'ConfigMap' })).toBeNull()
  })
})

describe('serviceSvcHlYamlHeadlessViolation', () => {
  test('ok для headless з суфіксом -hl', () => {
    expect(
      serviceSvcHlYamlHeadlessViolation({
        kind: 'Service',
        metadata: { name: 'app-hl' },
        spec: { clusterIP: 'None' }
      })
    ).toBeNull()
  })

  test('помилка без суфікса -hl у name', () => {
    expect(
      serviceSvcHlYamlHeadlessViolation({
        kind: 'Service',
        metadata: { name: 'app' },
        spec: { clusterIP: 'None' }
      })
    ).toContain('-hl')
  })

  test('помилка без clusterIP None', () => {
    expect(
      serviceSvcHlYamlHeadlessViolation({
        kind: 'Service',
        metadata: { name: 'app-hl' },
        spec: { type: 'ClusterIP' }
      })
    ).toContain('None')
  })
})

describe('kustomizationSvcYamlMissingSvcHlViolation', () => {
  const dir = resolve('/fixture/k8s/base')

  test('null коли є svc.yaml і svc-hl.yaml', () => {
    expect(kustomizationSvcYamlMissingSvcHlViolation(dir, ['svc.yaml', 'svc-hl.yaml'])).toBeNull()
  })

  test('помилка без svc-hl.yaml', () => {
    expect(kustomizationSvcYamlMissingSvcHlViolation(dir, ['svc.yaml'])).toContain('svc-hl')
  })

  test('null для вкладеного каталогу', () => {
    expect(kustomizationSvcYamlMissingSvcHlViolation(dir, ['api/svc.yaml', 'api/svc-hl.yaml'])).toBeNull()
  })

  test('помилка для вкладеного svc без hl', () => {
    expect(kustomizationSvcYamlMissingSvcHlViolation(dir, ['api/svc.yaml'])).toContain('svc-hl')
  })
})

describe('collectGatewayApiRouteBackendServiceNames', () => {
  test('збирає backendRefs до Service', () => {
    const names = collectGatewayApiRouteBackendServiceNames({
      rules: [
        {
          backendRefs: [
            { name: 'api-hl', port: 80 },
            { name: 'gw', kind: 'Gateway', group: 'gateway.networking.k8s.io' }
          ]
        }
      ]
    })
    expect(names).toContain('api-hl')
    expect(names).not.toContain('gw')
  })

  test('backendRef однина', () => {
    const names = collectGatewayApiRouteBackendServiceNames({
      rules: [{ matches: [{ path: { value: '/' } }], backendRef: { name: 'x-hl', port: 8080 } }]
    })
    expect(names).toEqual(['x-hl'])
  })
})
