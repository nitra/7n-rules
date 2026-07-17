/**
 * Тести T0-codemod `fix-manifests.mjs`: чисті трансформери (modeline / patches-sort /
 * deployment-strategy / networkpolicy-egress) на представницьких YAML-фрагментах.
 */
import { describe, expect, test } from 'vitest'
import { parse } from 'yaml'
import {
  ensureDeploymentStrategy,
  ensureHasuraConfigMapRequiredEnv,
  ensureHasuraHttpRouteRule1Filters,
  ensureNetworkPolicyEgress,
  ensureSvcClusterIpType,
  ensureSvcHlClusterIp,
  moveSchemaModelineFirst,
  sortKustomizationPatches
} from '../fix-manifests.mjs'

describe('moveSchemaModelineFirst', () => {
  test('modeline нижче першого рядка → переноситься нагору (без префіксів)', () => {
    const src = ['apiVersion: v1', '  # yaml-language-server: $schema=https://x/s.json', 'kind: ConfigMap', ''].join(
      '\n'
    )
    const out = moveSchemaModelineFirst(src)
    expect(out.split('\n', 1)[0]).toBe('# yaml-language-server: $schema=https://x/s.json')
    expect(out).toContain('apiVersion: v1')
  })

  test('modeline вже перший → null', () => {
    const src = ['# yaml-language-server: $schema=https://x/s.json', 'apiVersion: v1', ''].join('\n')
    expect(moveSchemaModelineFirst(src)).toBeNull()
  })

  test('modeline відсутній → null', () => {
    expect(moveSchemaModelineFirst('apiVersion: v1\nkind: ConfigMap\n')).toBeNull()
  })
})

describe('sortKustomizationPatches', () => {
  const SRC = [
    'apiVersion: kustomize.config.k8s.io/v1beta1',
    'kind: Kustomization',
    'patches:',
    '  - target: { kind: HTTPRoute, name: x }',
    '    path: hr.yaml',
    '  - target: { kind: Deployment, name: x }',
    '    path: deploy.yaml',
    ''
  ].join('\n')

  test('невпорядковані patches → сортуються (Deployment перед HTTPRoute)', () => {
    const out = sortKustomizationPatches(SRC)
    expect(out).not.toBeNull()
    const kinds = parse(out).patches.map(p => p.target.kind)
    expect(kinds).toEqual(['Deployment', 'HTTPRoute'])
  })

  test('вже відсортовані → null', () => {
    const sorted = sortKustomizationPatches(SRC)
    expect(sortKustomizationPatches(sorted)).toBeNull()
  })

  test('< 2 patches → null', () => {
    const src = 'apiVersion: kustomize.config.k8s.io/v1beta1\nkind: Kustomization\npatches:\n  - path: a.yaml\n'
    expect(sortKustomizationPatches(src)).toBeNull()
  })
})

describe('ensureDeploymentStrategy', () => {
  test('Deployment без strategy → проставляє RollingUpdate 0/1', () => {
    const src = [
      'apiVersion: apps/v1',
      'kind: Deployment',
      'metadata:',
      '  name: d',
      'spec:',
      '  replicas: 1',
      ''
    ].join('\n')
    const out = ensureDeploymentStrategy(src)
    const strat = parse(out).spec.strategy
    expect(strat).toEqual({ type: 'RollingUpdate', rollingUpdate: { maxUnavailable: 0, maxSurge: 1 } })
  })

  test('не-Deployment → null', () => {
    expect(ensureDeploymentStrategy('apiVersion: v1\nkind: Service\nspec: {}\n')).toBeNull()
  })

  test('вже коректний strategy → null', () => {
    const src = [
      'apiVersion: apps/v1',
      'kind: Deployment',
      'spec:',
      '  strategy:',
      '    type: RollingUpdate',
      '    rollingUpdate:',
      '      maxUnavailable: 0',
      '      maxSurge: 1',
      ''
    ].join('\n')
    expect(ensureDeploymentStrategy(src)).toBeNull()
  })
})

describe('ensureNetworkPolicyEgress', () => {
  test('NetworkPolicy без канон-egress → проставляє egress зі snippet', () => {
    const src = [
      'apiVersion: networking.k8s.io/v1',
      'kind: NetworkPolicy',
      'metadata:',
      '  name: np',
      'spec:',
      '  podSelector: { matchLabels: { app: np } }',
      '  egress: []',
      ''
    ].join('\n')
    const out = ensureNetworkPolicyEgress(src)
    expect(out).not.toBeNull()
    const egress = parse(out).spec.egress
    expect(Array.isArray(egress)).toBe(true)
    expect(egress.length).toBeGreaterThan(0)
    // канонічний snippet містить kube-dns-правило з port 53
    const flat = JSON.stringify(egress)
    expect(flat).toContain('"port":53')
  })

  test('не-NetworkPolicy → null', () => {
    expect(ensureNetworkPolicyEgress('apiVersion: v1\nkind: ConfigMap\nspec: {}\n')).toBeNull()
  })
})

describe('ensureHasuraConfigMapRequiredEnv', () => {
  test("порожній data → проставляє всі обов'язкові ключі", () => {
    const src = ['apiVersion: v1', 'kind: ConfigMap', 'metadata:', '  name: db-h', 'data:', '  FOO: bar', ''].join('\n')
    const out = ensureHasuraConfigMapRequiredEnv(src)
    expect(out).not.toBeNull()
    const data = parse(out).data
    expect(data.HASURA_GRAPHQL_ENABLE_REMOTE_SCHEMA_PERMISSIONS).toBe('true')
    expect(data.HASURA_GRAPHQL_ENABLE_RELAY).toBe('false')
    expect(data.HASURA_GRAPHQL_ENABLE_TELEMETRY).toBe('false')
    expect(data.HASURA_GRAPHQL_ENABLED_LOG_TYPES).toBe('startup,http-log')
    expect(data.HASURA_GRAPHQL_ENABLED_APIS).toBe('metadata,graphql,pgdump')
    expect(data.HASURA_GRAPHQL_DISABLE_EVENTING).toBe('true')
    expect(data.FOO).toBe('bar') // існуючі ключі не чіпаємо
  })

  test('boolean true/false (не рядок) вважається валідним → не чіпає', () => {
    const src = [
      'apiVersion: v1',
      'kind: ConfigMap',
      'data:',
      '  HASURA_GRAPHQL_ENABLE_REMOTE_SCHEMA_PERMISSIONS: true',
      '  HASURA_GRAPHQL_ENABLE_RELAY: false',
      '  HASURA_GRAPHQL_ENABLE_TELEMETRY: "false"',
      '  HASURA_GRAPHQL_ENABLED_LOG_TYPES: startup,http-log',
      '  HASURA_GRAPHQL_ENABLED_APIS: metadata,graphql,pgdump',
      '  HASURA_GRAPHQL_DISABLE_EVENTING: "false"',
      ''
    ].join('\n')
    expect(ensureHasuraConfigMapRequiredEnv(src)).toBeNull()
  })

  test('DISABLE_EVENTING присутній з будь-яким значенням → не чіпає', () => {
    const src = [
      'apiVersion: v1',
      'kind: ConfigMap',
      'data:',
      '  HASURA_GRAPHQL_ENABLE_REMOTE_SCHEMA_PERMISSIONS: "true"',
      '  HASURA_GRAPHQL_ENABLE_RELAY: "false"',
      '  HASURA_GRAPHQL_ENABLE_TELEMETRY: "false"',
      '  HASURA_GRAPHQL_ENABLED_LOG_TYPES: startup,http-log',
      '  HASURA_GRAPHQL_ENABLED_APIS: metadata,graphql,pgdump',
      '  HASURA_GRAPHQL_DISABLE_EVENTING: "custom"',
      ''
    ].join('\n')
    expect(ensureHasuraConfigMapRequiredEnv(src)).toBeNull()
  })

  test('неправильне значення ENABLED_LOG_TYPES → перезаписує точним рядком', () => {
    const src = [
      'apiVersion: v1',
      'kind: ConfigMap',
      'data:',
      '  HASURA_GRAPHQL_ENABLE_REMOTE_SCHEMA_PERMISSIONS: "true"',
      '  HASURA_GRAPHQL_ENABLE_RELAY: "false"',
      '  HASURA_GRAPHQL_ENABLE_TELEMETRY: "false"',
      '  HASURA_GRAPHQL_ENABLED_LOG_TYPES: "startup,http-log,query-log"',
      '  HASURA_GRAPHQL_ENABLED_APIS: metadata,graphql,pgdump',
      '  HASURA_GRAPHQL_DISABLE_EVENTING: "true"',
      ''
    ].join('\n')
    const out = ensureHasuraConfigMapRequiredEnv(src)
    expect(out).not.toBeNull()
    expect(parse(out).data.HASURA_GRAPHQL_ENABLED_LOG_TYPES).toBe('startup,http-log')
  })

  test('не-ConfigMap → null', () => {
    expect(ensureHasuraConfigMapRequiredEnv('apiVersion: apps/v1\nkind: Deployment\nspec: {}\n')).toBeNull()
  })
})

describe('ensureHasuraHttpRouteRule1Filters', () => {
  test('правило 1 без filters → проставляє RequestRedirect', () => {
    const src = [
      'apiVersion: gateway.networking.k8s.io/v1',
      'kind: HTTPRoute',
      'metadata:',
      '  name: db-h',
      'spec:',
      '  rules:',
      '    - matches:',
      '        - path: { type: Exact, value: /api/ql }',
      ''
    ].join('\n')
    const out = ensureHasuraHttpRouteRule1Filters(src)
    expect(out).not.toBeNull()
    const rule = parse(out).spec.rules[0]
    expect(rule.filters).toEqual([
      {
        type: 'RequestRedirect',
        requestRedirect: { statusCode: 302, path: { type: 'ReplaceFullPath', replaceFullPath: '/api/ql/console' } }
      }
    ])
  })

  test('правило 1 з невірним filters → перезаписує канонічним', () => {
    const src = [
      'apiVersion: gateway.networking.k8s.io/v1',
      'kind: HTTPRoute',
      'spec:',
      '  rules:',
      '    - matches:',
      '        - path: { type: Exact, value: /ql }',
      '      filters:',
      '        - type: RequestRedirect',
      '          requestRedirect:',
      '            statusCode: 301',
      ''
    ].join('\n')
    const out = ensureHasuraHttpRouteRule1Filters(src)
    expect(out).not.toBeNull()
    const filters = parse(out).spec.rules[0].filters
    expect(filters[0].requestRedirect.statusCode).toBe(302)
    expect(filters[0].requestRedirect.path.replaceFullPath).toBe('/ql/console')
  })

  test('правило 1 вже канонічне → null', () => {
    const src = [
      'apiVersion: gateway.networking.k8s.io/v1',
      'kind: HTTPRoute',
      'spec:',
      '  rules:',
      '    - matches:',
      '        - path: { type: Exact, value: /ql }',
      '      filters:',
      '        - type: RequestRedirect',
      '          requestRedirect:',
      '            statusCode: 302',
      '            path: { type: ReplaceFullPath, replaceFullPath: /ql/console }',
      ''
    ].join('\n')
    expect(ensureHasuraHttpRouteRule1Filters(src)).toBeNull()
  })

  test('нема правила 1 (canon_start не знайдено) → null', () => {
    const src = ['apiVersion: gateway.networking.k8s.io/v1', 'kind: HTTPRoute', 'spec:', '  rules: []', ''].join('\n')
    expect(ensureHasuraHttpRouteRule1Filters(src)).toBeNull()
  })

  test('не-HTTPRoute → null', () => {
    expect(ensureHasuraHttpRouteRule1Filters('apiVersion: v1\nkind: ConfigMap\nspec: {}\n')).toBeNull()
  })
})

describe('ensureSvcClusterIpType', () => {
  test('spec.type відсутній → проставляє ClusterIP', () => {
    const src = 'apiVersion: v1\nkind: Service\nmetadata:\n  name: s\nspec:\n  ports: []\n'
    const out = ensureSvcClusterIpType(src)
    expect(out).not.toBeNull()
    expect(parse(out).spec.type).toBe('ClusterIP')
  })

  test('spec.type невірний → перезаписує ClusterIP', () => {
    const src = 'apiVersion: v1\nkind: Service\nspec:\n  type: NodePort\n'
    const out = ensureSvcClusterIpType(src)
    expect(parse(out).spec.type).toBe('ClusterIP')
  })

  test('вже ClusterIP → null', () => {
    expect(ensureSvcClusterIpType('apiVersion: v1\nkind: Service\nspec:\n  type: ClusterIP\n')).toBeNull()
  })

  test('не-Service → null', () => {
    expect(ensureSvcClusterIpType('apiVersion: apps/v1\nkind: Deployment\nspec: {}\n')).toBeNull()
  })
})

describe('ensureSvcHlClusterIp', () => {
  test('spec.clusterIP відсутній → проставляє None', () => {
    const src = 'apiVersion: v1\nkind: Service\nmetadata:\n  name: db-h-hl\nspec:\n  ports: []\n'
    const out = ensureSvcHlClusterIp(src)
    expect(out).not.toBeNull()
    expect(parse(out).spec.clusterIP).toBe('None')
  })

  test('вже None → null', () => {
    expect(ensureSvcHlClusterIp('apiVersion: v1\nkind: Service\nspec:\n  clusterIP: None\n')).toBeNull()
  })

  test('не чіпає metadata.name (суфікс -hl не T0)', () => {
    const src = 'apiVersion: v1\nkind: Service\nmetadata:\n  name: db-h\nspec:\n  ports: []\n'
    const out = ensureSvcHlClusterIp(src)
    expect(out).not.toBeNull()
    expect(parse(out).metadata.name).toBe('db-h') // без -hl суфікса — не наша справа
    expect(parse(out).spec.clusterIP).toBe('None')
  })

  test('не-Service → null', () => {
    expect(ensureSvcHlClusterIp('apiVersion: apps/v1\nkind: Deployment\nspec: {}\n')).toBeNull()
  })
})
