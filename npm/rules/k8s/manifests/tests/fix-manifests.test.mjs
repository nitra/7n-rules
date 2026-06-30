/**
 * Тести T0-codemod `fix-manifests.mjs`: чисті трансформери (modeline / patches-sort /
 * deployment-strategy / networkpolicy-egress) на представницьких YAML-фрагментах.
 */
import { describe, expect, test } from 'vitest'
import { parse } from 'yaml'
import {
  ensureDeploymentStrategy,
  ensureNetworkPolicyEgress,
  moveSchemaModelineFirst,
  sortKustomizationPatches
} from '../fix-manifests.mjs'

describe('moveSchemaModelineFirst', () => {
  test('modeline нижче першого рядка → переноситься нагору (без префіксів)', () => {
    const src = ['apiVersion: v1', '  # yaml-language-server: $schema=https://x/s.json', 'kind: ConfigMap', ''].join(
      '\n'
    )
    const out = moveSchemaModelineFirst(src)
    expect(out.split('\n')[0]).toBe('# yaml-language-server: $schema=https://x/s.json')
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
