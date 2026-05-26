import { describe, expect, test } from 'vitest'

import {
  getCombinedNginxRunPatchTextFromKustomization,
  kustomizationHasAbieDeploymentNodeSelectorPatch,
  kustomizationHasAbieNginxRunHttpRoutePatch,
  validateAbieNginxRunHttpRoutePatches
} from '../kustomization-patches.mjs'

const UA_KUSTOMIZATION_NODE_SELECTOR_PATCH = `apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
patches:
  - target:
      kind: Deployment
      name: x
    patch: |-
      - op: add
        path: /spec/template/spec/nodeSelector
        value:
          preem: 'false'
`

const UA_KUSTOMIZATION_HTTPROUTE = `apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
patches:
  - target:
      kind: HTTPRoute
      name: my-httproute
    patch: |-
      - op: replace
        path: /spec/hostnames
        value:
          - "abie.app"
      - op: replace
        path: /spec/parentRefs/0/namespace
        value: ua
`

describe('kustomizationHasAbieDeploymentNodeSelectorPatch', () => {
  test('ua', () => {
    expect(kustomizationHasAbieDeploymentNodeSelectorPatch(UA_KUSTOMIZATION_NODE_SELECTOR_PATCH, 'ua')).toBe(true)
  })

  test('ua з op replace теж підходить', () => {
    const uaReplace = UA_KUSTOMIZATION_NODE_SELECTOR_PATCH.replace('op: add', 'op: replace')
    expect(kustomizationHasAbieDeploymentNodeSelectorPatch(uaReplace, 'ua')).toBe(true)
  })

  test('відхиляє ua без preem false', () => {
    const bad = UA_KUSTOMIZATION_NODE_SELECTOR_PATCH.replace("preem: 'false'", "preem: 'true'")
    expect(kustomizationHasAbieDeploymentNodeSelectorPatch(bad, 'ua')).toBe(false)
  })
})

describe('getCombinedNginxRunPatchTextFromKustomization', () => {
  test('збирає patch для HTTPRoute з довільним target.name', () => {
    const joined = getCombinedNginxRunPatchTextFromKustomization(UA_KUSTOMIZATION_HTTPROUTE)
    expect(joined).toContain('/spec/hostnames')
    expect(joined).toContain('abie.app')
  })

  test('не збирає HTTPRoute без target.name', () => {
    const raw = `apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
patches:
  - target:
      kind: HTTPRoute
    patch: |-
      - op: replace
        path: /spec/hostnames
        value:
          - "abie.app"
`
    expect(getCombinedNginxRunPatchTextFromKustomization(raw).trim()).toBe('')
  })
})

describe('validateAbieNginxRunHttpRoutePatches', () => {
  test('ua — без помилок', () => {
    const uaCombined = getCombinedNginxRunPatchTextFromKustomization(UA_KUSTOMIZATION_HTTPROUTE)
    expect(validateAbieNginxRunHttpRoutePatches(uaCombined, 'ua')).toBeNull()
  })

  test('ua-* (b2b) теж валідне', () => {
    const uaB2b = UA_KUSTOMIZATION_HTTPROUTE.replace('\n        value: ua\n', '\n        value: ua-b2b\n')
    const uaCombined = getCombinedNginxRunPatchTextFromKustomization(uaB2b)
    expect(validateAbieNginxRunHttpRoutePatches(uaCombined, 'ua')).toBeNull()
  })

  test('shared refCount без patch namespace — помилка', () => {
    const uaCombined = getCombinedNginxRunPatchTextFromKustomization(UA_KUSTOMIZATION_HTTPROUTE)
    expect(validateAbieNginxRunHttpRoutePatches(uaCombined, 'ua', undefined, 1)).toContain('auth-run-hl')
  })

  test('shared refCount з patch namespace — OK', () => {
    const raw = `apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
patches:
  - target:
      kind: HTTPRoute
      name: my-httproute
    patch: |-
      - op: replace
        path: /spec/hostnames
        value:
          - "abie.app"
      - op: replace
        path: /spec/parentRefs/0/namespace
        value: ua
      - op: replace
        path: /spec/rules/0/backendRefs/0/namespace
        value: ua-b2b
`
    const c = getCombinedNginxRunPatchTextFromKustomization(raw)
    expect(validateAbieNginxRunHttpRoutePatches(c, 'ua', undefined, 1)).toBeNull()
  })
})

describe('kustomizationHasAbieNginxRunHttpRoutePatch', () => {
  test('ua', () => {
    expect(kustomizationHasAbieNginxRunHttpRoutePatch(UA_KUSTOMIZATION_HTTPROUTE, 'ua')).toBe(true)
  })
})
