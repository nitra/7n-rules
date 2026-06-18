---
type: ADR
title: "Переміщення NetworkPolicy з `components/` у `base/`"
---

# Переміщення NetworkPolicy з `components/` у `base/`

**Status:** Accepted
**Date:** 2026-05-19

## Context and Problem Statement
Правило `k8s.mdc` вимагало тримати `NetworkPolicy` у `components/networkpolicy.yaml` (Kustomize `kind: Component`) і підключати лише з overlay. Це означало, що dev-середовища не включали NetworkPolicy — мережеві обмеження на них були невидимі та не застосовувались.

## Considered Options
* NetworkPolicy у `components/networkpolicy.yaml` (попередній канон): підключається лише з overlay (`components: [../components]`)
* NetworkPolicy у `base/networkpolicy.yaml`, підключений через `base/kustomization.yaml` → `resources:`

## Decision Outcome
Chosen option: "NetworkPolicy у `base/networkpolicy.yaml`", because обмеження повинні діяти і на dev-середовищі — це вимога, яку неможливо виконати, якщо NP живе виключно у `components/`.

### Consequences
* Good, because NetworkPolicy застосовується і на dev, і на prod — жодного «тихого» середовища без мережевих обмежень.
* Good, because `kubectl kustomize <base-dir>` збирає NP разом з основним маніфестом; kubescape-скан отримує повний набір ресурсів без додаткових налаштувань.
* Neutral, because overlay-specific NP поруч із overlay-маніфестом залишається дозволеним; `components/kustomization.yaml` тепер містить лише `[hpa.yaml, pdb.yaml]`.
* Bad, because усі наявні репозиторії, що слідували попередньому канону (`components/networkpolicy.yaml`), потребують міграції: перемістити файл у `base/`, додати запис у `base/kustomization.yaml resources:`, видалити з `components/kustomization.yaml resources:`.

## More Information
- Змінені файли: `npm/rules/k8s/k8s.mdc` (rule version `1.39` → `1.40`), `npm/rules/k8s/fix/manifests/check.mjs` (видалено `failIfBaseLayerHasLocalNetworkPolicy`, `validateComponentsNetworkPolicyFile`; `mkdir` прибрано з імпортів), `npm/rules/k8s/policy/base_kustomization/base_kustomization.rego` + `base_kustomization_test.rego` (знято deny на `networkpolicy.yaml` у `base/resources`; додано `test_allow_networkpolicy_yaml_in_resources`), `npm/rules/k8s/fix/manifests/check-schema.test.mjs`, `npm/rules/k8s/lint/run-roots.test.mjs`.
- Версія пакету: `1.13.52` → `1.13.53` (`npm/package.json`, `npm/CHANGELOG.md`).
- Підтверджено: `bun test npm/rules/k8s/` — 222 pass; `conftest verify` — 465 pass; `regal lint` — 0 violations.
