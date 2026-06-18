---
type: ADR
title: "NetworkPolicy snippet — джерело правди (два повних канони + annotation dispatch)"
---

# ADR: NetworkPolicy snippet — джерело правди (два повних канони + annotation dispatch)

**Дата:** 2026-05-25
**Статус:** Прийнято
**Версія `@nitra/cursor`:** 2.0.0

## Context

Канон `spec` NetworkPolicy у `@nitra/cursor` дублювався у 5+ місцях (snippet «для очей», `NETWORK_POLICY_EGRESS_YAML` у JS, rego deny-правила, rego тест-фікстури, `k8s.mdc` документація). Зміна одного правила (приклад — додавання `169.254.0.0/16` для GKE NodeLocal DNSCache) потребувала ручної синхронізації у всіх місцях; вилазили розбіжності.

Крім того, всі workload-типи (Deployment, Job, CronJob, DaemonSet, StatefulSet) отримували однаковий канон NetworkPolicy, попри те що StatefulSet потребує **intra-replica** правил (pod ↔ pod у тому ж namespace, для реплікації).

Проміжний реліз (v1.20.0) ввів два snippets у форматі **common + delta** з runtime-merge у JS і rego: `common.snippet.yaml` (для всіх workload) + `statefulset.snippet.yaml` (delta з intra-replica для StatefulSet). Це усувало дублювання канону, але вимагало merge-логіки в обох мовах і робило snippet-семантику менш прозорою.

## Decision

Перехід на **два самодостатніх повних канони** без runtime-merge.

Файли:
- `npm/rules/k8s/policy/network_policy/template/deployment.snippet.yaml` — повний канон для `Deployment`, `Job`, `CronJob`, `DaemonSet`.
- `npm/rules/k8s/policy/network_policy/template/statefulset.snippet.yaml` — повний канон для `StatefulSet` (deployment-канон + intra-replica `podSelector` правила в `egress` та `ingress`).

Disp атч за анотацією `metadata.annotations['nitra.dev/workload-kind']`, яку JS-генератор ставить автоматично. JS — через `KIND_TO_SNIPPET` + `snippetNameForKind(kind)` (обирає один snippet, без merge). Rego — через `canon_for_kind(kind)` (повертає `data.template.statefulset_snippet` для `StatefulSet`, fallback на `data.template.deployment_snippet`).

Перевірка структури — **superset** (subset проти input): кожне канонічне правило має бути присутнє в `input.spec`; додаткові правила дозволені. Safety-net deny проти allow-all `{}` лишається.

GKE NodeLocal DNSCache (`169.254.0.0/16:53 UDP+TCP`) — частина обох канонів (link-local адреса DNS-агента ноди, RFC 3927).

`networkPolicyManifestViolations` видалено з JS у v1.20.0 (breaking). У v2.0.0 додатково breaking: `buildNetworkPolicyYaml(name, app, kind)` — третій параметр `kind` обовʼязковий.

## Consequences

**Good:**
- Зміна канону = редагування одного snippet'а. JS і rego автоматично узгоджуються через `loadSnippetSpec` + conftest `data.template.*`.
- StatefulSet тепер має повний канон з intra-replica трафіком (kube-dns + link-local DNS + 0.0.0.0/0 + in-cluster + intra-replica peer).
- Жодного runtime-merge між snippets — semantically простіша модель «snippet → spec».
- Додаткові egress/ingress правила (extra-rules per workload) дозволені — subset не блокує.
- `~120` рядків коду видалено з `manifests.mjs` (рядкові шаблони і granular валідатор з v1.x).

**Bad:**
- Дублювання `egress`-правил між `deployment.snippet.yaml` і `statefulset.snippet.yaml` (~40 рядків). Свідомий tradeoff: явність runtime-семантики важливіша за DRY на статичних snippets.
- Annotation `nitra.dev/workload-kind` стає обовʼязковою (з warn-fallback на deployment-канон). Існуючі ручні NP-файли без анотації приймаються rego, але не отримують StatefulSet-specific перевірки.
- Major version bump 2.0.0 публічного `@nitra/cursor` API (видалення `networkPolicyManifestViolations` в v1.20.0 + обовʼязковий `kind` в v2.0.0).

## Alternatives considered

- **Один snippet + ручна синхронізація rego** — простіше, але не підтримує StatefulSet-канон; rego-фікстури вручну.
- **Common + delta snippets** (попередній v1.20.0) — DRY-er (~70 рядків), але вимагає runtime merge в JS і rego; менше явності. Відкинуто на користь двох повних канонів.
- **Annotation у спеціальному файлі (`workload-kind.yaml`) поруч з NP** — додає файл без додаткової цінності; анотація в самому NP — самодокументна.

## References

- Spec: `docs/superpowers/specs/2026-05-25-networkpolicy-snippet-single-source-of-truth-design.md`
- Snippets: `npm/rules/k8s/policy/network_policy/template/{deployment,statefulset}.snippet.yaml`
- Rego: `npm/rules/k8s/policy/network_policy/network_policy.rego`
- JS: `npm/rules/k8s/js/manifests.mjs` (`buildNetworkPolicyYaml`, `loadSnippetSpec`, `KIND_TO_SNIPPET`, `snippetNameForKind`)
- GKE NodeLocal DNSCache: https://cloud.google.com/kubernetes-engine/docs/how-to/nodelocal-dns-cache
- RFC 3927 (link-local 169.254/16): https://datatracker.ietf.org/doc/html/rfc3927
- Попередній реліз (common+delta): commit `72bec68`
