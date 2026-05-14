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
  deploymentAppLabel,
  deploymentHasuraGraphqlEngineImageViolation,
  deploymentResourcesViolation,
  deploymentTopologySpreadConstraintsViolation,
  expectedSchemaUrl,
  hasuraConfigMapRemoteSchemaPermissionsViolation,
  HASURA_GRAPHQL_ENGINE_IMAGE,
  HASURA_REMOTE_SCHEMA_PERMISSIONS_KEY,
  hpaManifestViolations,
  isDevLikeK8sEnvSegment,
  k8sEnvSegmentFromRelPath,
  kustomizationPatchPathsByTargetKind,
  kustomizationResourcesSortedAlphabeticallyViolation,
  kustomizationPatchesSortedViolation,
  kustomizationInlinePatchOpsSortedViolation,
  kustomizePatchModifiedPaths,
  pdbManifestViolations,
  healthCheckPolicyTargetRefHeadlessServiceViolation,
  k8sYamlFirstDocIsAlbYcHttpBackendGroup,
  isBaseKustomizationPath,
  isClusterScopedKubernetesKind,
  isK8sBaseManifestYamlPath,
  isForbiddenK8sDevPath,
  isK8sYamlUnderBaseDirectory,
  metadataNamespaceRequiredViolation,
  pathHasK8sSegment,
  replaceBatchV1beta1ApiVersionInYamlText,
  SERVICE_FORBIDDEN_GCP_ANNOTATION_KEYS,
  serviceForbiddenGcpAnnotationsViolation,
  collectGatewayApiRouteBackendRefsWithRedundantNamespace,
  collectGatewayApiRouteBackendServiceNames,
  collectJson6902OperationsFromPatchText,
  json6902PathsWithRemoveAndAddOnSamePath,
  kustomizePatchTargetMatchesDescriptor,
  kustomizeResourceCatalogMatchesPatchTarget,
  kustomizeResourceDescriptorFromManifest,
  kustomizeResourceDescriptorsIdentityEqual,
  kustomizationSvcYamlMissingSvcHlViolation,
  kustomizePathRefsForExistenceCheck,
  kustomizeResourceTreeHpaPdbDeploymentFlags,
  validateComponentsForBaseDeployment,
  prodOverlayHpaPdbOverrideNeeds,
  prodOverlayNeedsHpaPdbOverrides,
  shouldValidateKustomizePatchTarget,
  splitK8sApiVersion,
  serviceSvcHlYamlHeadlessViolation,
  serviceSvcYamlClusterIpTypeViolation
} from '../scripts/check-k8s.mjs'

const SERVICE_V1_JSON_RE = /service-v1\.json$/

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

describe('healthCheckPolicyTargetRefHeadlessServiceViolation', () => {
  test('null для не-HealthCheckPolicy', () => {
    expect(
      healthCheckPolicyTargetRefHeadlessServiceViolation({ kind: 'Service', metadata: { name: 'x-hl' } })
    ).toBeNull()
  })

  test('null для іншого apiVersion', () => {
    expect(
      healthCheckPolicyTargetRefHeadlessServiceViolation({
        apiVersion: 'networking.gke.io/v1beta1',
        kind: 'HealthCheckPolicy',
        spec: { targetRef: { kind: 'Service', name: 'x' } }
      })
    ).toBeNull()
  })

  test('помилка, коли targetRef.name без суфікса -hl', () => {
    const v = healthCheckPolicyTargetRefHeadlessServiceViolation({
      apiVersion: 'networking.gke.io/v1',
      kind: 'HealthCheckPolicy',
      spec: { targetRef: { kind: 'Service', name: 'app' } }
    })
    expect(v).toContain('-hl')
  })

  test('null для коректного headless імені', () => {
    expect(
      healthCheckPolicyTargetRefHeadlessServiceViolation({
        apiVersion: 'networking.gke.io/v1',
        kind: 'HealthCheckPolicy',
        spec: { targetRef: { kind: 'Service', name: 'app-hl' } }
      })
    ).toBeNull()
  })

  test('null, коли targetRef.kind не Service', () => {
    expect(
      healthCheckPolicyTargetRefHeadlessServiceViolation({
        apiVersion: 'networking.gke.io/v1',
        kind: 'HealthCheckPolicy',
        spec: { targetRef: { kind: 'Pod', name: 'x' } }
      })
    ).toBeNull()
  })
})

describe('replaceBatchV1beta1ApiVersionInYamlText', () => {
  test('замінює apiVersion: batch/v1beta1 на batch/v1', () => {
    const y = 'apiVersion: batch/v1beta1\nkind: CronJob\n'
    const { changed, content } = replaceBatchV1beta1ApiVersionInYamlText(y)
    expect(changed).toBe(true)
    expect(content).toBe('apiVersion: batch/v1\nkind: CronJob\n')
  })

  test('у multi-doc обох документах', () => {
    const y = 'apiVersion: batch/v1beta1\n---\napiVersion: batch/v1beta1\n'
    const { content } = replaceBatchV1beta1ApiVersionInYamlText(y)
    expect(content).toBe('apiVersion: batch/v1\n---\napiVersion: batch/v1\n')
  })

  test('у лапках', () => {
    const y = 'apiVersion: "batch/v1beta1"\n'
    const { content } = replaceBatchV1beta1ApiVersionInYamlText(y)
    expect(content).toBe('apiVersion: batch/v1\n')
  })

  test('не змінює # коментар', () => {
    const y = '# apiVersion: batch/v1beta1\n'
    const { changed, content } = replaceBatchV1beta1ApiVersionInYamlText(y)
    expect(changed).toBe(false)
    expect(content).toBe(y)
  })

  test('зберігає CRLF', () => {
    const y = 'apiVersion: batch/v1beta1\r\n'
    const { content } = replaceBatchV1beta1ApiVersionInYamlText(y)
    expect(content).toBe('apiVersion: batch/v1\r\n')
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

  test('з root: ігнорує сегмент `k8s` у самому префіксі кореня', () => {
    // Worst-case: корінь репо буквально називається `k8s/` (як `/Users/.../abie/k8s/`).
    // Без relativize всі файли проєкту повертали б true (включно з `.github/workflows/`),
    // що ламає скоп check-k8s vs ga.mdc.
    // Перевірка чисто рядкова — fs не зачіпаємо, тому використовуємо синтетичний префікс.
    const root = '/home/test/some/k8s'
    expect(pathHasK8sSegment(`${root}/.github/workflows/x.yml`, root)).toBe(false)
    expect(pathHasK8sSegment(`${root}/adminer/k8s/base/hr.yaml`, root)).toBe(true)
    expect(pathHasK8sSegment(`${root}/Dockerfile`, root)).toBe(false)
  })

  test('з root: сам корінь не вважається k8s-файлом', () => {
    const root = '/home/test/some/k8s'
    expect(pathHasK8sSegment(root, root)).toBe(false)
  })

  test('з root: маніфест під вкладеним k8s/ розпізнається', () => {
    const root = '/repo/root'
    expect(pathHasK8sSegment('/repo/root/site/k8s/base/deployment.yaml', root)).toBe(true)
  })
})

describe('deploymentResourcesViolation', () => {
  test('null для не-Deployment', () => {
    expect(deploymentResourcesViolation({ kind: 'Service' })).toBeNull()
    expect(deploymentResourcesViolation({ kind: 'Service' }, true)).toBeNull()
  })

  test('null без масиву containers', () => {
    expect(deploymentResourcesViolation({ kind: 'Deployment', spec: { template: { spec: {} } } })).toBeNull()
  })

  test('помилка, коли немає resources', () => {
    const manifest = {
      kind: 'Deployment',
      spec: { template: { spec: { containers: [{ name: 'app', image: 'x:y' }] } } }
    }
    expect(deploymentResourcesViolation(manifest)).toContain('resources.requests')
  })

  test('помилка для resources: {} (бракує requests.cpu)', () => {
    const manifest = {
      kind: 'Deployment',
      spec: { template: { spec: { containers: [{ name: 'app', image: 'x:y', resources: {} }] } } }
    }
    expect(deploymentResourcesViolation(manifest)).toContain('requests.cpu')
  })

  test('помилка для resources з limits без requests.cpu', () => {
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
    expect(deploymentResourcesViolation(manifest)).toContain('requests.cpu')
  })

  test('помилка без requests.memory (є cpu)', () => {
    const manifest = {
      kind: 'Deployment',
      spec: {
        template: {
          spec: { containers: [{ name: 'app', image: 'x:y', resources: { requests: { cpu: '500m' } } }] }
        }
      }
    }
    expect(deploymentResourcesViolation(manifest, false)).toContain('requests.memory')
  })

  test('ok для resources.requests.cpu + memory поза base', () => {
    const manifest = {
      kind: 'Deployment',
      spec: {
        template: {
          spec: {
            containers: [{ name: 'app', image: 'x:y', resources: { requests: { cpu: '500m', memory: '512Mi' } } }]
          }
        }
      }
    }
    expect(deploymentResourcesViolation(manifest, false)).toBeNull()
  })

  test('ok для resources.requests.cpu числом 0.5 і memory', () => {
    const manifest = {
      kind: 'Deployment',
      spec: {
        template: {
          spec: {
            containers: [{ name: 'app', image: 'x:y', resources: { requests: { cpu: 0.5, memory: '512Mi' } } }]
          }
        }
      }
    }
    expect(deploymentResourcesViolation(manifest, false)).toBeNull()
  })

  test('помилка у base, якщо cpu не 0.02', () => {
    const manifest = {
      kind: 'Deployment',
      spec: {
        template: {
          spec: {
            containers: [{ name: 'app', image: 'x:y', resources: { requests: { cpu: '500m', memory: '128Mi' } } }]
          }
        }
      }
    }
    expect(deploymentResourcesViolation(manifest, true)).toContain('0.02')
  })

  test('помилка у base, якщо memory не 128Mi', () => {
    const manifest = {
      kind: 'Deployment',
      spec: {
        template: {
          spec: {
            containers: [{ name: 'app', image: 'x:y', resources: { requests: { cpu: '0.02', memory: '512Mi' } } }]
          }
        }
      }
    }
    expect(deploymentResourcesViolation(manifest, true)).toContain('128Mi')
  })

  test('ok для base з 0.02 та 128Mi', () => {
    const manifest = {
      kind: 'Deployment',
      spec: {
        template: {
          spec: {
            containers: [{ name: 'app', image: 'x:y', resources: { requests: { cpu: '0.02', memory: '128Mi' } } }]
          }
        }
      }
    }
    expect(deploymentResourcesViolation(manifest, true)).toBeNull()
  })

  test('ok для base з 128mi (регістр Mi)', () => {
    const manifest = {
      kind: 'Deployment',
      spec: {
        template: {
          spec: {
            containers: [{ name: 'app', image: 'x:y', resources: { requests: { cpu: '0.02', memory: '128mi' } } }]
          }
        }
      }
    }
    expect(deploymentResourcesViolation(manifest, true)).toBeNull()
  })

  test('помилка для resources.requests.cpu з порожнім рядком', () => {
    const manifest = {
      kind: 'Deployment',
      spec: {
        template: {
          spec: {
            containers: [
              {
                name: 'app',
                image: 'x:y',
                resources: { requests: { cpu: '', memory: '512Mi' } }
              }
            ]
          }
        }
      }
    }
    expect(deploymentResourcesViolation(manifest, false)).toContain('requests.cpu')
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

// `isForbiddenAutoscalingV1Manifest` — JS-предикат видалено разом з orchestrator
// `failIfAutoscalingV1InDocument` (Plan B). Тестове покриття `apiVersion: autoscaling/v1`
// заборони — у `npm/policy/k8s/manifest/manifest_test.rego::test_deny_autoscaling_v1`.

describe('hasuraConfigMapRemoteSchemaPermissionsViolation', () => {
  test('null для не-ConfigMap', () => {
    expect(hasuraConfigMapRemoteSchemaPermissionsViolation({ kind: 'Deployment' })).toBeNull()
  })

  test('null коли ключ є зі значенням "true"', () => {
    expect(
      hasuraConfigMapRemoteSchemaPermissionsViolation({
        kind: 'ConfigMap',
        metadata: { name: 'x' },
        data: { [HASURA_REMOTE_SCHEMA_PERMISSIONS_KEY]: 'true' }
      })
    ).toBeNull()
  })

  test('null для булевого true', () => {
    expect(
      hasuraConfigMapRemoteSchemaPermissionsViolation({
        kind: 'ConfigMap',
        metadata: { name: 'x' },
        data: { [HASURA_REMOTE_SCHEMA_PERMISSIONS_KEY]: true }
      })
    ).toBeNull()
  })

  test('помилка, якщо data відсутній', () => {
    const msg = hasuraConfigMapRemoteSchemaPermissionsViolation({
      kind: 'ConfigMap',
      metadata: { name: 'x' }
    })
    expect(msg).toContain(HASURA_REMOTE_SCHEMA_PERMISSIONS_KEY)
  })

  test('помилка, якщо ключ відсутній у data', () => {
    const msg = hasuraConfigMapRemoteSchemaPermissionsViolation({
      kind: 'ConfigMap',
      metadata: { name: 'x' },
      data: { OTHER: 'true' }
    })
    expect(msg).toContain(HASURA_REMOTE_SCHEMA_PERMISSIONS_KEY)
  })

  test('помилка, якщо значення не true', () => {
    const msg = hasuraConfigMapRemoteSchemaPermissionsViolation({
      kind: 'ConfigMap',
      metadata: { name: 'x' },
      data: { [HASURA_REMOTE_SCHEMA_PERMISSIONS_KEY]: 'false' }
    })
    expect(msg).toContain('"true"')
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

describe('k8sYamlFirstDocIsAlbYcHttpBackendGroup', () => {
  test('true для першого документа HttpBackendGroup alb.yc.io/v1alpha1', () => {
    const y = `apiVersion: alb.yc.io/v1alpha1
kind: HttpBackendGroup
metadata:
  name: be
`
    expect(k8sYamlFirstDocIsAlbYcHttpBackendGroup(y)).toBe(true)
  })

  test('false для Deployment', () => {
    expect(
      k8sYamlFirstDocIsAlbYcHttpBackendGroup(`apiVersion: apps/v1
kind: Deployment
metadata:
  name: d
`)
    ).toBe(false)
  })

  test('false якщо HttpBackendGroup лише у другому документі', () => {
    const y = `apiVersion: v1
kind: Service
metadata:
  name: s
---
apiVersion: alb.yc.io/v1alpha1
kind: HttpBackendGroup
metadata:
  name: be
`
    expect(k8sYamlFirstDocIsAlbYcHttpBackendGroup(y)).toBe(false)
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
    expect(expected).toMatch(SERVICE_V1_JSON_RE)
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

describe('splitK8sApiVersion / kustomize patch target', () => {
  test('splitK8sApiVersion — core v1', () => {
    expect(splitK8sApiVersion('v1')).toEqual({ group: '', version: 'v1' })
  })

  test('splitK8sApiVersion — apps/v1', () => {
    expect(splitK8sApiVersion('apps/v1')).toEqual({ group: 'apps', version: 'v1' })
  })

  test('shouldValidateKustomizePatchTarget — потрібні kind і name', () => {
    expect(shouldValidateKustomizePatchTarget({ kind: 'Deployment', name: 'x' })).toBe(true)
    expect(shouldValidateKustomizePatchTarget({ kind: 'Deployment' })).toBe(false)
    expect(shouldValidateKustomizePatchTarget({ name: 'x' })).toBe(false)
  })

  test('shouldValidateKustomizePatchTarget — пропуск за labelSelector', () => {
    expect(
      shouldValidateKustomizePatchTarget({
        kind: 'Deployment',
        name: 'x',
        labelSelector: 'app=web'
      })
    ).toBe(false)
  })

  test('kustomizePatchTargetMatchesDescriptor — збіг з namespace у target', () => {
    const res = { group: 'apps', version: 'v1', kind: 'Deployment', name: 'x', namespace: 'ns1' }
    expect(
      kustomizePatchTargetMatchesDescriptor(
        { kind: 'Deployment', name: 'x', namespace: 'ns1', version: 'v1', group: 'apps' },
        res
      )
    ).toBe(true)
    expect(kustomizePatchTargetMatchesDescriptor({ kind: 'Deployment', name: 'x', namespace: 'other' }, res)).toBe(
      false
    )
  })

  test('kustomizeResourceCatalogMatchesPatchTarget', () => {
    const catalog = [{ group: 'apps', version: 'v1', kind: 'Deployment', name: 'x', namespace: 'ns1' }]
    expect(kustomizeResourceCatalogMatchesPatchTarget(catalog, { kind: 'Deployment', name: 'x' })).toBe(true)
    expect(kustomizeResourceCatalogMatchesPatchTarget(catalog, { kind: 'Deployment', name: 'y' })).toBe(false)
  })

  test('kustomizeResourceDescriptorFromManifest — default namespace з kustomization', () => {
    const d = kustomizeResourceDescriptorFromManifest(
      {
        apiVersion: 'apps/v1',
        kind: 'Deployment',
        metadata: { name: 'app' }
      },
      'ns1'
    )
    expect(d).toEqual({ group: 'apps', version: 'v1', kind: 'Deployment', name: 'app', namespace: 'ns1' })
  })

  test('kustomizeResourceDescriptorsIdentityEqual', () => {
    const a = { group: '', version: 'v1', kind: 'Service', name: 's', namespace: 'n' }
    const b = { group: '', version: 'v1', kind: 'Service', name: 's', namespace: 'n' }
    expect(kustomizeResourceDescriptorsIdentityEqual(a, b)).toBe(true)
    expect(kustomizeResourceDescriptorsIdentityEqual(a, { ...b, name: 't' })).toBe(false)
  })
})

describe('kustomizationResourcesSortedAlphabeticallyViolation', () => {
  const k = {
    apiVersion: 'kustomize.config.k8s.io/v1beta1',
    kind: 'Kustomization',
    resources: []
  }

  test('null, якщо kind не Kustomization', () => {
    expect(
      kustomizationResourcesSortedAlphabeticallyViolation({
        ...k,
        kind: 'ConfigMap',
        resources: ['b.yaml', 'a.yaml']
      })
    ).toBeNull()
  })

  test('null, якщо apiVersion не kustomize.config.k8s.io/…', () => {
    expect(
      kustomizationResourcesSortedAlphabeticallyViolation({
        ...k,
        apiVersion: 'v1',
        resources: ['b.yaml', 'a.yaml']
      })
    ).toBeNull()
  })

  test('null для відсортованого resources', () => {
    expect(
      kustomizationResourcesSortedAlphabeticallyViolation({
        ...k,
        resources: ['atlas-to-base.yaml', 'b2b-to-base.yaml', 'contract-to-base.yaml', 'ft-to-base.yaml']
      })
    ).toBeNull()
  })

  test('помилка, якщо resources не за алфавітом', () => {
    const msg = kustomizationResourcesSortedAlphabeticallyViolation({
      ...k,
      resources: ['b2b-to-base.yaml', 'contract-to-base.yaml', 'ft-to-base.yaml', 'atlas-to-base.yaml']
    })
    expect(msg).toContain('atlas-to-base')
    expect(msg).toContain('очікувано')
  })

  test('null, якщо resources відсутнє або < 2 непорожніх рядків', () => {
    expect(
      kustomizationResourcesSortedAlphabeticallyViolation({
        apiVersion: 'kustomize.config.k8s.io/v1beta1',
        kind: 'Kustomization'
      })
    ).toBeNull()
    expect(
      kustomizationResourcesSortedAlphabeticallyViolation({
        ...k,
        resources: ['a.yaml']
      })
    ).toBeNull()
  })
})

describe('kustomizationPatchesSortedViolation', () => {
  const k = {
    apiVersion: 'kustomize.config.k8s.io/v1beta1',
    kind: 'Kustomization'
  }

  test('null, якщо kind не Kustomization', () => {
    expect(
      kustomizationPatchesSortedViolation({
        ...k,
        kind: 'ConfigMap',
        patches: [{ target: { kind: 'A', name: 'b' } }, { target: { kind: 'A', name: 'a' } }]
      })
    ).toBeNull()
  })

  test('null, якщо patches відсутнє або < 2', () => {
    expect(kustomizationPatchesSortedViolation({ ...k })).toBeNull()
    expect(kustomizationPatchesSortedViolation({ ...k, patches: [{ target: { kind: 'A', name: 'b' } }] })).toBeNull()
  })

  test('null для відсортованих patches за target.kind/name', () => {
    expect(
      kustomizationPatchesSortedViolation({
        ...k,
        patches: [
          { target: { kind: 'HorizontalPodAutoscaler', name: 'api' } },
          { target: { kind: 'PodDisruptionBudget', name: 'api' } },
          { target: { kind: 'ReferenceGrant', name: 'apruv-to-base' } },
          { target: { kind: 'ReferenceGrant', name: 'atlas-to-base' } }
        ]
      })
    ).toBeNull()
  })

  test('помилка, якщо patches не за алфавітом (приклад із k8s.mdc)', () => {
    const msg = kustomizationPatchesSortedViolation({
      ...k,
      patches: [
        { target: { kind: 'ReferenceGrant', name: 'atlas-to-base' } },
        { target: { kind: 'ReferenceGrant', name: 'apruv-to-base' } }
      ]
    })
    expect(msg).toContain('очікувано')
    expect(msg).toContain('ReferenceGrant/apruv-to-base')
    expect(msg).toContain('ReferenceGrant/atlas-to-base')
    expect(msg.indexOf('очікувано')).toBeLessThan(msg.lastIndexOf('apruv-to-base'))
  })

  test('тайбрейкер за target.namespace', () => {
    expect(
      kustomizationPatchesSortedViolation({
        ...k,
        patches: [
          { target: { kind: 'ConfigMap', name: 'app', namespace: 'b' } },
          { target: { kind: 'ConfigMap', name: 'app', namespace: 'a' } }
        ]
      })
    ).not.toBeNull()
  })

  test('тайбрейкер за path (зовнішній strategic-merge без target)', () => {
    expect(
      kustomizationPatchesSortedViolation({
        ...k,
        patches: [{ path: 'b.yaml' }, { path: 'a.yaml' }]
      })
    ).not.toBeNull()
  })

  test('помилка, якщо patches не масив', () => {
    expect(kustomizationPatchesSortedViolation({ ...k, patches: 'oops' })).toContain('масивом')
  })
})

describe('kustomizationInlinePatchOpsSortedViolation', () => {
  test('null, якщо < 2 операцій', () => {
    expect(
      kustomizationInlinePatchOpsSortedViolation('- op: replace\n  path: /spec/maxReplicas\n  value: 10\n')
    ).toBeNull()
  })

  test('null, якщо текст не масив YAML-операцій', () => {
    expect(kustomizationInlinePatchOpsSortedViolation('foo: bar\n')).toBeNull()
    expect(kustomizationInlinePatchOpsSortedViolation('not yaml: : :')).toBeNull()
  })

  test('null для відсортованого add/replace набору', () => {
    const text =
      '- op: replace\n  path: /spec/maxReplicas\n  value: 10\n- op: add\n  path: /spec/minReplicas\n  value: 2\n'
    expect(kustomizationInlinePatchOpsSortedViolation(text)).toBeNull()
  })

  test('помилка для приклада з k8s.mdc (add minReplicas → replace maxReplicas)', () => {
    const text =
      '- op: add\n  path: /spec/minReplicas\n  value: 2\n- op: replace\n  path: /spec/maxReplicas\n  value: 10\n'
    const msg = kustomizationInlinePatchOpsSortedViolation(text)
    expect(msg).toContain('/spec/maxReplicas')
    expect(msg).toContain('/spec/minReplicas')
    expect(msg.indexOf('очікувано')).toBeGreaterThan(-1)
    const want = msg.slice(msg.indexOf('очікувано'))
    expect(want.indexOf('/spec/maxReplicas')).toBeLessThan(want.indexOf('/spec/minReplicas'))
  })

  test('null, якщо є op ∉ {add, replace} (move/test/remove/copy — порядок семантичний)', () => {
    const text =
      '- op: test\n  path: /spec/minReplicas\n  value: 1\n- op: replace\n  path: /spec/maxReplicas\n  value: 10\n'
    expect(kustomizationInlinePatchOpsSortedViolation(text)).toBeNull()
  })

  test('null, якщо path-и не дизʼюнктні (один префікс іншого)', () => {
    const text =
      '- op: add\n  path: /spec/template/spec/containers\n  value: []\n' +
      '- op: replace\n  path: /spec/template\n  value: {}\n'
    expect(kustomizationInlinePatchOpsSortedViolation(text)).toBeNull()
  })

  test('null, якщо path-и однакові (повтор)', () => {
    const text = '- op: add\n  path: /spec/x\n  value: 1\n- op: replace\n  path: /spec/x\n  value: 2\n'
    expect(kustomizationInlinePatchOpsSortedViolation(text)).toBeNull()
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

  test('не плутає HTTPHeaderMatch (name + type + value) з backendRef', () => {
    const names = collectGatewayApiRouteBackendServiceNames({
      rules: [
        {
          matches: [
            {
              headers: [{ name: 'Upgrade', type: 'Exact', value: 'websocket' }]
            }
          ],
          backendRefs: [{ name: 'app-hl', port: 8080 }]
        }
      ]
    })
    expect(names).toEqual(['app-hl'])
  })
})

describe('collectGatewayApiRouteBackendRefsWithRedundantNamespace', () => {
  test('фіксує backendRef з namespace, що збігається з namespace маршруту', () => {
    const names = collectGatewayApiRouteBackendRefsWithRedundantNamespace(
      {
        rules: [
          {
            backendRefs: [{ name: 'auth-hl', namespace: 'dev-b2b', port: 8080 }]
          }
        ]
      },
      'dev-b2b'
    )
    expect(names).toEqual(['auth-hl'])
  })

  test('не фіксує backendRef без namespace', () => {
    const names = collectGatewayApiRouteBackendRefsWithRedundantNamespace(
      {
        rules: [{ backendRefs: [{ name: 'auth-hl', port: 8080 }] }]
      },
      'dev-b2b'
    )
    expect(names).toEqual([])
  })

  test('не фіксує backendRef з іншим namespace (cross-namespace)', () => {
    const names = collectGatewayApiRouteBackendRefsWithRedundantNamespace(
      {
        rules: [{ backendRefs: [{ name: 'auth-hl', namespace: 'shared', port: 8080 }] }]
      },
      'dev-b2b'
    )
    expect(names).toEqual([])
  })

  test('обходить однину backendRef', () => {
    const names = collectGatewayApiRouteBackendRefsWithRedundantNamespace(
      {
        rules: [{ backendRef: { name: 'x-hl', namespace: 'dev', port: 80 } }]
      },
      'dev'
    )
    expect(names).toEqual(['x-hl'])
  })
})

describe('JSON6902 remove+add на той самий path (k8s.mdc)', () => {
  test('collectJson6902OperationsFromPatchText — YAML-масив операцій', () => {
    const y = `- op: remove
  path: /spec/a
- op: add
  path: /spec/a
  value: 1
`
    const ops = collectJson6902OperationsFromPatchText(y)
    expect(ops).toEqual([
      { op: 'remove', path: '/spec/a' },
      { op: 'add', path: '/spec/a' }
    ])
  })

  test('collectJson6902OperationsFromPatchText — JSON-масив', () => {
    const j = '[{"op":"remove","path":"/x"},{"op":"add","path":"/x","value":1}]'
    expect(collectJson6902OperationsFromPatchText(j).length).toBe(2)
  })

  test('strategic merge / не масив — порожньо', () => {
    expect(collectJson6902OperationsFromPatchText('kind: Deployment\nmetadata:\n  name: x')).toEqual([])
  })

  test('json6902PathsWithRemoveAndAddOnSamePath — знаходить path', () => {
    const ops = [
      { op: 'remove', path: '/spec/x' },
      { op: 'add', path: '/spec/x' }
    ]
    expect(json6902PathsWithRemoveAndAddOnSamePath(ops)).toEqual(['/spec/x'])
  })

  test('json6902PathsWithRemoveAndAddOnSamePath — лише replace', () => {
    const ops = [{ op: 'replace', path: '/spec/x' }]
    expect(json6902PathsWithRemoveAndAddOnSamePath(ops)).toEqual([])
  })

  test('remove і add на різних path — ок', () => {
    const y = `- op: remove
  path: /a
- op: add
  path: /b
  value: 1
`
    expect(json6902PathsWithRemoveAndAddOnSamePath(collectJson6902OperationsFromPatchText(y))).toEqual([])
  })
})

describe('k8sEnvSegmentFromRelPath / isDevLikeK8sEnvSegment', () => {
  test('витягує сегмент після /k8s/', () => {
    expect(k8sEnvSegmentFromRelPath('app/k8s/base/deploy.yaml')).toBe('base')
    expect(k8sEnvSegmentFromRelPath('svc/k8s/tr-qa/kustomization.yaml')).toBe('tr-qa')
    expect(k8sEnvSegmentFromRelPath('k8s/ua/deploy.yaml')).toBe('ua')
  })

  test('null, якщо немає /k8s/', () => {
    expect(k8sEnvSegmentFromRelPath('src/app.ts')).toBeNull()
  })

  test('dev-like: base, dev, *-qa', () => {
    expect(isDevLikeK8sEnvSegment('base')).toBe(true)
    expect(isDevLikeK8sEnvSegment('dev')).toBe(true)
    expect(isDevLikeK8sEnvSegment('tr-qa')).toBe(true)
    expect(isDevLikeK8sEnvSegment('abc-qa')).toBe(true)
  })

  test('прод: решта', () => {
    expect(isDevLikeK8sEnvSegment('ua')).toBe(false)
    expect(isDevLikeK8sEnvSegment('prod')).toBe(false)
    expect(isDevLikeK8sEnvSegment('')).toBe(false)
    expect(isDevLikeK8sEnvSegment(null)).toBe(false)
  })
})

describe('deploymentAppLabel', () => {
  test('витягує spec.selector.matchLabels.app', () => {
    expect(
      deploymentAppLabel({
        kind: 'Deployment',
        spec: { selector: { matchLabels: { app: 'backend-api' } } }
      })
    ).toBe('backend-api')
  })

  test('null, якщо app відсутній', () => {
    expect(deploymentAppLabel({ kind: 'Deployment', spec: { selector: { matchLabels: {} } } })).toBeNull()
    expect(deploymentAppLabel({ kind: 'Deployment' })).toBeNull()
  })
})

/**
 * Канонічний мінімальний HPA, валідний у прод (для тестів).
 * @param {Record<string, unknown>} overrides перекриття полів spec
 * @returns {Record<string, unknown>} HPA manifest
 */
function makeHpa(overrides = {}) {
  return {
    apiVersion: 'autoscaling/v2',
    kind: 'HorizontalPodAutoscaler',
    metadata: { name: 'x' },
    spec: {
      scaleTargetRef: { apiVersion: 'apps/v1', kind: 'Deployment', name: 'x' },
      minReplicas: 2,
      maxReplicas: 10,
      metrics: [
        { type: 'Resource', resource: { name: 'cpu', target: { type: 'Utilization', averageUtilization: 70 } } }
      ],
      behavior: {
        scaleUp: { policies: [{ type: 'Percent', value: 100, periodSeconds: 30 }] },
        scaleDown: { policies: [{ type: 'Percent', value: 25, periodSeconds: 120 }] }
      },
      ...overrides
    }
  }
}

describe('hpaManifestViolations', () => {
  test('прод: канонічний HPA — без порушень', () => {
    expect(hpaManifestViolations(makeHpa(), 'x', false)).toEqual([])
  })

  test('dev-like: minReplicas=1, maxReplicas=1 — ок', () => {
    expect(hpaManifestViolations(makeHpa({ minReplicas: 1, maxReplicas: 1 }), 'x', true)).toEqual([])
  })

  test('dev-like: minReplicas !== 1 — помилка', () => {
    const errs = hpaManifestViolations(makeHpa({ minReplicas: 2, maxReplicas: 2 }), 'x', true)
    expect(errs.some(e => e.includes('minReplicas'))).toBe(true)
  })

  test('dev-like: maxReplicas !== 1 — помилка', () => {
    const errs = hpaManifestViolations(makeHpa({ minReplicas: 1, maxReplicas: 10 }), 'x', true)
    expect(errs.some(e => e.includes('maxReplicas'))).toBe(true)
  })

  test('прод: minReplicas < 2 — помилка', () => {
    const errs = hpaManifestViolations(makeHpa({ minReplicas: 1 }), 'x', false)
    expect(errs.some(e => e.includes('minReplicas'))).toBe(true)
  })

  test('прод: maxReplicas < 2 — помилка', () => {
    const errs = hpaManifestViolations(makeHpa({ minReplicas: 1, maxReplicas: 1 }), 'x', false)
    expect(errs.some(e => e.includes('maxReplicas'))).toBe(true)
  })

  test('apiVersion != autoscaling/v2 — помилка', () => {
    const m = makeHpa()
    m.apiVersion = 'autoscaling/v1'
    const errs = hpaManifestViolations(m, 'x', false)
    expect(errs.some(e => e.includes('autoscaling/v2'))).toBe(true)
  })

  test('scaleTargetRef.name не збігається — помилка', () => {
    const errs = hpaManifestViolations(makeHpa(), 'other', false)
    expect(errs.some(e => e.includes('scaleTargetRef.name'))).toBe(true)
  })

  test('відсутній behavior — помилка', () => {
    const errs = hpaManifestViolations(makeHpa({ behavior: undefined }), 'x', false)
    expect(errs.some(e => e.includes('behavior'))).toBe(true)
  })

  test('порожній metrics — помилка', () => {
    const errs = hpaManifestViolations(makeHpa({ metrics: [] }), 'x', false)
    expect(errs.some(e => e.includes('metrics'))).toBe(true)
  })
})

describe('pdbManifestViolations', () => {
  const okPdb = {
    apiVersion: 'policy/v1',
    kind: 'PodDisruptionBudget',
    metadata: { name: 'x' },
    spec: { minAvailable: 1, selector: { matchLabels: { app: 'x' } } }
  }

  test('прод: канонічний PDB — без порушень', () => {
    expect(pdbManifestViolations(okPdb, 'x', false)).toEqual([])
  })

  test('dev-like: minAvailable === 0 — ок', () => {
    expect(
      pdbManifestViolations(
        {
          apiVersion: 'policy/v1',
          kind: 'PodDisruptionBudget',
          metadata: { name: 'x' },
          spec: { minAvailable: 0, selector: { matchLabels: { app: 'x' } } }
        },
        'x',
        true
      )
    ).toEqual([])
  })

  test('dev-like: minAvailable !== 0 — помилка', () => {
    const errs = pdbManifestViolations(okPdb, 'x', true)
    expect(errs.some(e => e.includes('minAvailable'))).toBe(true)
  })

  test('прод: minAvailable < 1 — помилка', () => {
    const errs = pdbManifestViolations(
      {
        apiVersion: 'policy/v1',
        kind: 'PodDisruptionBudget',
        metadata: { name: 'x' },
        spec: { minAvailable: 0, selector: { matchLabels: { app: 'x' } } }
      },
      'x',
      false
    )
    expect(errs.some(e => e.includes('minAvailable'))).toBe(true)
  })

  test('apiVersion != policy/v1 — помилка', () => {
    const errs = pdbManifestViolations({ ...okPdb, apiVersion: 'policy/v1beta1' }, 'x', false)
    expect(errs.some(e => e.includes('policy/v1'))).toBe(true)
  })

  test('matchLabels.app не збігається — помилка', () => {
    const errs = pdbManifestViolations(okPdb, 'other', false)
    expect(errs.some(e => e.includes('matchLabels.app'))).toBe(true)
  })
})

describe('deploymentTopologySpreadConstraintsViolation', () => {
  const canonical = {
    maxSkew: 1,
    topologyKey: 'kubernetes.io/hostname',
    whenUnsatisfiable: 'ScheduleAnyway',
    labelSelector: { matchLabels: { app: 'x' } }
  }

  test('null для не-Deployment', () => {
    expect(deploymentTopologySpreadConstraintsViolation({ kind: 'Service' }, 'x')).toBeNull()
  })

  test('null, якщо канонічний запис присутній', () => {
    expect(
      deploymentTopologySpreadConstraintsViolation(
        {
          kind: 'Deployment',
          spec: { template: { spec: { topologySpreadConstraints: [canonical] } } }
        },
        'x'
      )
    ).toBeNull()
  })

  test('помилка, якщо topologySpreadConstraints відсутні', () => {
    const v = deploymentTopologySpreadConstraintsViolation(
      { kind: 'Deployment', spec: { template: { spec: {} } } },
      'x'
    )
    expect(v).toContain('topologySpreadConstraints')
  })

  test('помилка, якщо app не збігається', () => {
    const v = deploymentTopologySpreadConstraintsViolation(
      {
        kind: 'Deployment',
        spec: { template: { spec: { topologySpreadConstraints: [canonical] } } }
      },
      'other'
    )
    expect(v).toContain('other')
  })

  test('помилка, якщо whenUnsatisfiable інший', () => {
    const v = deploymentTopologySpreadConstraintsViolation(
      {
        kind: 'Deployment',
        spec: {
          template: {
            spec: { topologySpreadConstraints: [{ ...canonical, whenUnsatisfiable: 'DoNotSchedule' }] }
          }
        }
      },
      'x'
    )
    expect(v).toContain('ScheduleAnyway')
  })
})

describe('kustomizePatchModifiedPaths', () => {
  test('JSON6902 — шляхи з op/path', () => {
    const text = `- op: replace
  path: /spec/minReplicas
  value: 2
- op: replace
  path: /spec/maxReplicas
  value: 10
`
    const paths = kustomizePatchModifiedPaths(text)
    expect(paths.has('/spec/minReplicas')).toBe(true)
    expect(paths.has('/spec/maxReplicas')).toBe(true)
  })

  test('Strategic Merge — плоскі шляхи листків', () => {
    const text = `apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: x
spec:
  minReplicas: 3
  maxReplicas: 10
`
    const paths = kustomizePatchModifiedPaths(text)
    expect(paths.has('/spec/minReplicas')).toBe(true)
    expect(paths.has('/spec/maxReplicas')).toBe(true)
    expect(paths.has('/metadata/name')).toBe(true)
    expect(paths.has('/spec')).toBe(false) // проміжний об'єкт — не листок
  })

  test('Порожній / не-YAML — порожній результат', () => {
    expect(kustomizePatchModifiedPaths('').size).toBe(0)
    expect(kustomizePatchModifiedPaths('   ').size).toBe(0)
  })
})

describe('kustomizationPatchPathsByTargetKind', () => {
  test('збирає шляхи за target.kind (JSON6902)', () => {
    const kust = {
      patches: [
        {
          target: { kind: 'HorizontalPodAutoscaler', name: 'x' },
          patch: '- op: replace\n  path: /spec/minReplicas\n  value: 3\n'
        },
        {
          target: { kind: 'PodDisruptionBudget', name: 'x' },
          patch: '- op: replace\n  path: /spec/minAvailable\n  value: 1\n'
        }
      ]
    }
    const byKind = kustomizationPatchPathsByTargetKind(kust)
    expect(byKind.get('HorizontalPodAutoscaler').has('/spec/minReplicas')).toBe(true)
    expect(byKind.get('PodDisruptionBudget').has('/spec/minAvailable')).toBe(true)
  })

  test('без target.kind — бере kind з тіла Strategic Merge', () => {
    const kust = {
      patches: [
        {
          patch:
            'apiVersion: autoscaling/v2\nkind: HorizontalPodAutoscaler\nmetadata:\n  name: x\nspec:\n  maxReplicas: 5\n'
        }
      ]
    }
    const byKind = kustomizationPatchPathsByTargetKind(kust)
    expect(byKind.get('HorizontalPodAutoscaler').has('/spec/maxReplicas')).toBe(true)
  })

  test('без patches — порожня мапа', () => {
    expect(kustomizationPatchPathsByTargetKind({}).size).toBe(0)
  })
})

describe('kustomizePathRefsForExistenceCheck', () => {
  test('збирає patchesJson6902 і configurations', () => {
    const k = {
      kind: 'Kustomization',
      resources: ['a.yaml'],
      patchesJson6902: [{ path: 'json6902.yaml', target: { kind: 'Deployment', name: 'x' } }],
      configurations: ['openapi.yaml'],
      replacements: [{ path: 'rep.yaml' }]
    }
    const xs = kustomizePathRefsForExistenceCheck(k).toSorted()
    expect(xs).toEqual(['a.yaml', 'json6902.yaml', 'openapi.yaml', 'rep.yaml'].toSorted())
  })
})

describe('isK8sYamlUnderBaseDirectory', () => {
  test('true для будь-якого yaml під …/k8s/…/base/', () => {
    expect(isK8sYamlUnderBaseDirectory('k8s/foo/base/deploy.yaml')).toBe(true)
    expect(isK8sYamlUnderBaseDirectory('app/k8s/foo/base/deploy.yaml')).toBe(true)
    expect(isK8sYamlUnderBaseDirectory('app/k8s/foo/base/deployment.yaml')).toBe(true)
    expect(isK8sYamlUnderBaseDirectory('k8s/base/cronjob.yaml')).toBe(true)
  })

  test('false поза шаром base після k8s', () => {
    expect(isK8sYamlUnderBaseDirectory('app/k8s/prod/deploy.yaml')).toBe(false)
    expect(isK8sYamlUnderBaseDirectory('other/deploy.yaml')).toBe(false)
  })
})

describe('kustomizeResourceTreeHpaPdbDeploymentFlags', () => {
  test('у base tree лише HPA — hasDeployment false', async () => {
    const root = await mkdtemp(join(tmpdir(), 'k8s-flags-'))
    const k8sBase = join(root, 'k8s', 'base')
    await mkdir(k8sBase, { recursive: true })
    const hpa = `# yaml-language-server: $schema=x
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: ap
  namespace: dev
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: ap
  minReplicas: 1
  maxReplicas: 1
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 50
  behavior:
    scaleUp:
      policies:
        - type: Percent
          value: 10
          periodSeconds: 15
    scaleDown:
      policies:
        - type: Percent
          value: 10
          periodSeconds: 15
`
    const k = `apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
namespace: dev
resources:
  - hpa.yaml
`
    await writeFile(join(k8sBase, 'hpa.yaml'), hpa, 'utf8')
    await writeFile(join(k8sBase, 'kustomization.yaml'), k, 'utf8')
    const f = await kustomizeResourceTreeHpaPdbDeploymentFlags(join(k8sBase, 'kustomization.yaml'), resolve(root))
    expect(f.hasHpa).toBe(true)
    expect(f.hasDeployment).toBe(false)
    expect(f.hasPdb).toBe(false)
  })

  test('Deployment у deployment.yaml під base — hasDeployment true', async () => {
    const root = await mkdtemp(join(tmpdir(), 'k8s-flags-dep-'))
    const k8sBase = join(root, 'k8s', 'base')
    await mkdir(k8sBase, { recursive: true })
    const dep = `# yaml-language-server: $schema=x
apiVersion: apps/v1
kind: Deployment
metadata:
  name: ap
  namespace: dev
spec:
  replicas: 1
  selector:
    matchLabels:
      app: ap
  template:
    metadata:
      labels:
        app: ap
    spec:
      containers:
        - name: ap
          image: x:y
`
    const k = `apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
namespace: dev
resources:
  - deployment.yaml
`
    await writeFile(join(k8sBase, 'deployment.yaml'), dep, 'utf8')
    await writeFile(join(k8sBase, 'kustomization.yaml'), k, 'utf8')
    const f = await kustomizeResourceTreeHpaPdbDeploymentFlags(join(k8sBase, 'kustomization.yaml'), resolve(root))
    expect(f.hasDeployment).toBe(true)
  })

  test('Deployment у deploy.yaml — hasDeployment true', async () => {
    const root = await mkdtemp(join(tmpdir(), 'k8s-flags-good-'))
    const k8sBase = join(root, 'k8s', 'base')
    await mkdir(k8sBase, { recursive: true })
    const dep = `# yaml-language-server: $schema=x
apiVersion: apps/v1
kind: Deployment
metadata:
  name: ap
  namespace: dev
spec:
  replicas: 1
  selector:
    matchLabels:
      app: ap
  template:
    metadata:
      labels:
        app: ap
    spec:
      containers:
        - name: ap
          image: x:y
`
    const k = `apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
namespace: dev
resources:
  - deploy.yaml
`
    await writeFile(join(k8sBase, 'deploy.yaml'), dep, 'utf8')
    await writeFile(join(k8sBase, 'kustomization.yaml'), k, 'utf8')
    const f = await kustomizeResourceTreeHpaPdbDeploymentFlags(join(k8sBase, 'kustomization.yaml'), resolve(root))
    expect(f.hasDeployment).toBe(true)
  })
})

describe('prodOverlayNeedsHpaPdbOverrides', () => {
  test('false для prod overlay, якщо base не містить Deployment+HPA/PDB', async () => {
    const root = await mkdtemp(join(tmpdir(), 'k8s-prod-ovr-0-'))
    const baseDir = join(root, 'k8s', 'base')
    const prodDir = join(root, 'k8s', 'prod')
    await mkdir(baseDir, { recursive: true })
    await mkdir(prodDir, { recursive: true })

    const cron = `# yaml-language-server: $schema=x
apiVersion: batch/v1
kind: CronJob
metadata:
  name: ap
  namespace: dev
spec:
  schedule: "* * * * *"
  jobTemplate:
    spec:
      template:
        spec:
          restartPolicy: Never
          containers:
            - name: ap
              image: x:y
`
    const baseK = `apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
namespace: dev
resources:
  - cron.yaml
`
    const prodK = `apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
namespace: dev
resources:
  - ../base
`

    await writeFile(join(baseDir, 'cron.yaml'), cron, 'utf8')
    await writeFile(join(baseDir, 'kustomization.yaml'), baseK, 'utf8')
    await writeFile(join(prodDir, 'kustomization.yaml'), prodK, 'utf8')

    expect(await prodOverlayNeedsHpaPdbOverrides(resolve(root), join(prodDir, 'kustomization.yaml'))).toBe(false)
  })

  test('true для prod overlay, що підключає sibling components/ з HPA і PDB', async () => {
    const root = await mkdtemp(join(tmpdir(), 'k8s-prod-ovr-1-'))
    const componentsDir = join(root, 'k8s', 'components')
    const baseDir = join(root, 'k8s', 'base')
    const prodDir = join(root, 'k8s', 'prod')
    await mkdir(componentsDir, { recursive: true })
    await mkdir(baseDir, { recursive: true })
    await mkdir(prodDir, { recursive: true })

    const dep = `# yaml-language-server: $schema=x
apiVersion: apps/v1
kind: Deployment
metadata:
  name: ap
  namespace: dev
spec:
  replicas: 1
  selector:
    matchLabels:
      app: ap
  template:
    metadata:
      labels:
        app: ap
    spec:
      containers:
        - name: ap
          image: x:y
          resources:
            requests:
              cpu: '0.02'
              memory: '128Mi'
      topologySpreadConstraints:
        - maxSkew: 1
          topologyKey: kubernetes.io/hostname
          whenUnsatisfiable: ScheduleAnyway
          labelSelector:
            matchLabels:
              app: ap
`
    const hpa = `# yaml-language-server: $schema=x
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: ap
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: ap
  minReplicas: 1
  maxReplicas: 1
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 50
`
    const pdb = `# yaml-language-server: $schema=x
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: ap
spec:
  minAvailable: 0
  selector:
    matchLabels:
      app: ap
`
    const componentsK = `apiVersion: kustomize.config.k8s.io/v1alpha1
kind: Component
resources:
  - hpa.yaml
  - pdb.yaml
`
    const baseK = `apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
namespace: dev
resources:
  - deployment.yaml
`
    const prodK = `apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
namespace: dev
resources:
  - ../base
components:
  - ../components
`

    await writeFile(join(componentsDir, 'hpa.yaml'), hpa, 'utf8')
    await writeFile(join(componentsDir, 'pdb.yaml'), pdb, 'utf8')
    await writeFile(join(componentsDir, 'kustomization.yaml'), componentsK, 'utf8')
    await writeFile(join(baseDir, 'deployment.yaml'), dep, 'utf8')
    await writeFile(join(baseDir, 'kustomization.yaml'), baseK, 'utf8')
    await writeFile(join(prodDir, 'kustomization.yaml'), prodK, 'utf8')

    const prodKust = join(prodDir, 'kustomization.yaml')
    expect(await prodOverlayNeedsHpaPdbOverrides(resolve(root), prodKust)).toBe(true)
    const needs = await prodOverlayHpaPdbOverrideNeeds(resolve(root), prodKust)
    expect(needs.needsHpaReplicaPatches).toBe(true)
    expect(needs.needsPdbMinAvailablePatch).toBe(true)
  })

  test('prodOverlayHpaPdbOverrideNeeds: лише PDB у overlay-дереві (без HPA) → needs PDB only', async () => {
    const root = await mkdtemp(join(tmpdir(), 'k8s-prod-ovr-pdbonly-'))
    const componentsDir = join(root, 'k8s', 'components')
    const baseDir = join(root, 'k8s', 'base')
    const prodDir = join(root, 'k8s', 'prod')
    await mkdir(componentsDir, { recursive: true })
    await mkdir(baseDir, { recursive: true })
    await mkdir(prodDir, { recursive: true })

    const dep = `# yaml-language-server: $schema=x
apiVersion: apps/v1
kind: Deployment
metadata:
  name: ap
  namespace: dev
spec:
  replicas: 1
  selector:
    matchLabels:
      app: ap
  template:
    metadata:
      labels:
        app: ap
    spec:
      containers:
        - name: ap
          image: x:y
`
    const pdb = `# yaml-language-server: $schema=x
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: ap
spec:
  minAvailable: 0
  selector:
    matchLabels:
      app: ap
`
    const componentsK = `apiVersion: kustomize.config.k8s.io/v1alpha1
kind: Component
resources:
  - pdb.yaml
`
    const baseK = `apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
namespace: dev
resources:
  - deployment.yaml
`
    const prodK = `apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
namespace: dev
resources:
  - ../base
components:
  - ../components
`

    await writeFile(join(componentsDir, 'pdb.yaml'), pdb, 'utf8')
    await writeFile(join(componentsDir, 'kustomization.yaml'), componentsK, 'utf8')
    await writeFile(join(baseDir, 'deployment.yaml'), dep, 'utf8')
    await writeFile(join(baseDir, 'kustomization.yaml'), baseK, 'utf8')
    await writeFile(join(prodDir, 'kustomization.yaml'), prodK, 'utf8')

    const prodKust = join(prodDir, 'kustomization.yaml')
    const n = await prodOverlayHpaPdbOverrideNeeds(resolve(root), prodKust)
    expect(n.needsHpaReplicaPatches).toBe(false)
    expect(n.needsPdbMinAvailablePatch).toBe(true)
    expect(await prodOverlayNeedsHpaPdbOverrides(resolve(root), prodKust)).toBe(true)
  })

  test('prodOverlayHpaPdbOverrideNeeds: kind: Component (components/kustomization.yaml) → не overlay, без потреби патчів', async () => {
    const root = await mkdtemp(join(tmpdir(), 'k8s-prod-ovr-component-'))
    const componentsDir = join(root, 'k8s', 'components')
    await mkdir(componentsDir, { recursive: true })

    const hpa = `# yaml-language-server: $schema=x
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: ap
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: ap
  minReplicas: 1
  maxReplicas: 1
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 70
`
    const pdb = `# yaml-language-server: $schema=x
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: ap
spec:
  minAvailable: 0
  selector:
    matchLabels:
      app: ap
`
    const componentsK = `apiVersion: kustomize.config.k8s.io/v1alpha1
kind: Component
resources:
  - hpa.yaml
  - pdb.yaml
`
    await writeFile(join(componentsDir, 'hpa.yaml'), hpa, 'utf8')
    await writeFile(join(componentsDir, 'pdb.yaml'), pdb, 'utf8')
    await writeFile(join(componentsDir, 'kustomization.yaml'), componentsK, 'utf8')

    const componentsKust = join(componentsDir, 'kustomization.yaml')
    const n = await prodOverlayHpaPdbOverrideNeeds(resolve(root), componentsKust)
    expect(n.needsHpaReplicaPatches).toBe(false)
    expect(n.needsPdbMinAvailablePatch).toBe(false)
    expect(await prodOverlayNeedsHpaPdbOverrides(resolve(root), componentsKust)).toBe(false)
  })
})

/**
 * Створює пару `fail`/`pass` колектори для асертів `validateComponentsForBaseDeployment`.
 * @returns {{ fail: (m: string) => void, pass: (m: string) => void, fails: string[], passes: string[] }} лічильники повідомлень
 */
const collectors = () => {
  /** @type {string[]} */
  const fails = []
  /** @type {string[]} */
  const passes = []
  return {
    fail: m => fails.push(m),
    pass: m => passes.push(m),
    fails,
    passes
  }
}

describe('validateComponentsForBaseDeployment', () => {
  test('fail, якщо sibling components/ відсутній', async () => {
    const root = await mkdtemp(join(tmpdir(), 'k8s-comp-missing-'))
    const baseDir = join(root, 'k8s', 'base')
    await mkdir(baseDir, { recursive: true })
    const c = collectors()
    await validateComponentsForBaseDeployment(baseDir, 'ap', 'ap', resolve(root), c.fail, c.pass)
    expect(c.fails.some(m => m.includes('components/'))).toBe(true)
  })

  test('fail, якщо components/kustomization.yaml не Component', async () => {
    const root = await mkdtemp(join(tmpdir(), 'k8s-comp-kind-'))
    const baseDir = join(root, 'k8s', 'base')
    const componentsDir = join(root, 'k8s', 'components')
    await mkdir(baseDir, { recursive: true })
    await mkdir(componentsDir, { recursive: true })
    const wrongK = `apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
resources:
  - hpa.yaml
  - pdb.yaml
`
    await writeFile(join(componentsDir, 'kustomization.yaml'), wrongK, 'utf8')
    const c = collectors()
    await validateComponentsForBaseDeployment(baseDir, 'ap', 'ap', resolve(root), c.fail, c.pass)
    expect(c.fails.some(m => m.includes('kind') && m.includes('Component'))).toBe(true)
  })

  test('fail, якщо components/hpa.yaml відсутній', async () => {
    const root = await mkdtemp(join(tmpdir(), 'k8s-comp-no-hpa-'))
    const baseDir = join(root, 'k8s', 'base')
    const componentsDir = join(root, 'k8s', 'components')
    await mkdir(baseDir, { recursive: true })
    await mkdir(componentsDir, { recursive: true })
    const okK = `apiVersion: kustomize.config.k8s.io/v1alpha1
kind: Component
resources:
  - hpa.yaml
  - pdb.yaml
`
    const pdb = `apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: ap
spec:
  minAvailable: 0
  selector:
    matchLabels:
      app: ap
`
    await writeFile(join(componentsDir, 'kustomization.yaml'), okK, 'utf8')
    await writeFile(join(componentsDir, 'pdb.yaml'), pdb, 'utf8')
    const c = collectors()
    await validateComponentsForBaseDeployment(baseDir, 'ap', 'ap', resolve(root), c.fail, c.pass)
    expect(c.fails.some(m => m.includes('hpa.yaml') && m.includes('відсутній'))).toBe(true)
  })

  test('pass для канонічного components/ з hpa.yaml і pdb.yaml', async () => {
    const root = await mkdtemp(join(tmpdir(), 'k8s-comp-ok-'))
    const baseDir = join(root, 'k8s', 'base')
    const componentsDir = join(root, 'k8s', 'components')
    await mkdir(baseDir, { recursive: true })
    await mkdir(componentsDir, { recursive: true })
    const okK = `apiVersion: kustomize.config.k8s.io/v1alpha1
kind: Component
resources:
  - hpa.yaml
  - pdb.yaml
`
    const hpa = `apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: ap
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: ap
  minReplicas: 1
  maxReplicas: 1
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 50
  behavior:
    scaleUp:
      policies:
        - type: Percent
          value: 10
          periodSeconds: 15
    scaleDown:
      policies:
        - type: Percent
          value: 10
          periodSeconds: 15
`
    const pdb = `apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: ap
spec:
  minAvailable: 0
  selector:
    matchLabels:
      app: ap
`
    await writeFile(join(componentsDir, 'kustomization.yaml'), okK, 'utf8')
    await writeFile(join(componentsDir, 'hpa.yaml'), hpa, 'utf8')
    await writeFile(join(componentsDir, 'pdb.yaml'), pdb, 'utf8')
    const c = collectors()
    await validateComponentsForBaseDeployment(baseDir, 'ap', 'ap', resolve(root), c.fail, c.pass)
    expect(c.fails).toEqual([])
    expect(c.passes.length).toBeGreaterThan(0)
  })

  test('fail, якщо HPA scaleTargetRef.name не дорівнює Deployment name', async () => {
    const root = await mkdtemp(join(tmpdir(), 'k8s-comp-mismatch-'))
    const baseDir = join(root, 'k8s', 'base')
    const componentsDir = join(root, 'k8s', 'components')
    await mkdir(baseDir, { recursive: true })
    await mkdir(componentsDir, { recursive: true })
    const okK = `apiVersion: kustomize.config.k8s.io/v1alpha1
kind: Component
resources:
  - hpa.yaml
  - pdb.yaml
`
    const hpa = `apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: ap
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: other
  minReplicas: 1
  maxReplicas: 1
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 50
`
    const pdb = `apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: ap
spec:
  minAvailable: 0
  selector:
    matchLabels:
      app: ap
`
    await writeFile(join(componentsDir, 'kustomization.yaml'), okK, 'utf8')
    await writeFile(join(componentsDir, 'hpa.yaml'), hpa, 'utf8')
    await writeFile(join(componentsDir, 'pdb.yaml'), pdb, 'utf8')
    const c = collectors()
    await validateComponentsForBaseDeployment(baseDir, 'ap', 'ap', resolve(root), c.fail, c.pass)
    expect(c.fails.some(m => m.includes('hpa.yaml'))).toBe(true)
  })
})
