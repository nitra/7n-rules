---
session: 67092753-dd58-41fc-95cc-62403acd1407
captured: 2026-05-25T20:30:53+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/67092753-dd58-41fc-95cc-62403acd1407.jsonl
---

## ADR Egress-правило для GKE NodeLocal DNSCache у NetworkPolicy

## Context and Problem Statement
У кластері GKE з увімкненим NodeLocal DNSCache kubelet налаштовує `/etc/resolv.conf` подів не на ClusterIP kube-dns, а на link-local адресу локального DNS-агента ноди (діапазон `169.254.0.0/16`). NetworkPolicy з `policyTypes: [Egress]` без явного дозволу на `169.254.0.0/16:53` блокує весь DNS-резолвінг у пода ще до того, як запит доходить до kube-system.

## Considered Options
* Дозволити egress на `169.254.0.0/16`, порти 53/UDP і 53/TCP
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Дозволити egress на `169.254.0.0/16`, порти 53/UDP і 53/TCP", because на GKE з NodeLocal DNSCache DNS-трафік іде через link-local адресу ноди, а не напряму до kube-dns ClusterIP; без цього правила весь DNS у пода лягає.

### Consequences
* Good, because transcript фіксує очікувану користь: DNS-резолвінг працює в усіх подах із рестриктивним Egress, включно зі stateful workloads (БД, Redis).
* Bad, because transcript не містить підтверджених негативних наслідків. (Правило на 169.254/16 у не-GKE-кластерах без NodeLocal DNSCache нічого не пропускає — на цій адресі ніхто не слухає.)

## More Information
Змінений файл: `npm/rules/k8s/policy/network_policy/template/networkpolicy.snippet.yaml` — додано блок до `egress`:
```yaml
- to:
- ipBlock:
cidr: 169.254.0.0/16
ports:
- protocol: UDP
port: 53
- protocol: TCP
port: 53
```
RFC 3927 (link-local): адреси `169.254.0.0/16` не маршрутизуються за межі машини/лінку. Правило `podSelector: {} → namespaceSelector kube-system: kube-dns` на GKE з NodeLocal DNSCache не є достатнім, бо трафік іде через link-local, а не напряму до kube-dns ClusterIP.

---

## ADR networkpolicy.snippet.yaml як єдине джерело правди для структурного канону NetworkPolicy

## Context and Problem Statement
Структурний канон NetworkPolicy (конкретно `spec.egress`) був продубльований у кількох місцях: рядкова константа `NETWORK_POLICY_EGRESS_YAML` та функція `buildNetworkPolicyYaml` у `manifests.mjs`, `valid_np` у `network_policy_test.rego`, та `networkpolicy.snippet.yaml`. Після додавання link-local DNS-правила виявилося, що зміна у snippet не впливає на runtime — генератор і валідатор читають власні hardcoded копії канону.

## Considered Options
* (A) Видалити JS повністю, лишити тільки rego + snippet
* (B) Видалити JS-валідацію, лишити JS для workload-прив'язки і fix; snippet → rego через `conftest --data`
* (C) Лишити JS для workload-context та auto-fix, але прибрати власний канон із JS; snippet → rego через `conftest --data`; JS читає snippet замість hardcoded рядка

## Decision Outcome
Chosen option: "C", because `n-fix` (автостворення `networkpolicy.yaml`, cross-file прив'язка workload→NP, міграція legacy egress) потребує workload-context, якого rego на conftest не має; тому JS-шар лишається, але знімає власну відповідальність за структурний канон.

### Consequences
* Good, because зміна канону (наприклад, новий egress-рядок у snippet) поширюється в єдиному місці — `networkpolicy.snippet.yaml` — і підхоплюється і rego (через `conftest --data`), і JS (читає файл) без ручної синхронізації.
* Bad, because transcript не містить підтверджених негативних наслідків. (Інвокація `conftest` у CI має включати `--data .../template/networkpolicy.snippet.yaml`; якщо виклик не зафіксовано в скрипті — може виникнути розсихання.)

## More Information
Спосіб підключення snippet до rego: `conftest test … --data npm/rules/k8s/policy/network_policy/template/networkpolicy.snippet.yaml`. Дані доступні в rego як `data.spec.egress` (або `data.networkpolicy.snippet.spec.egress` залежно від ключа). Rego робить structural-compare `input.spec ≡ data.spec` з одним винятком: `podSelector.matchLabels.app` перевіряється лише на присутність та непорожність (значення довільне). Snippet лишається в «загальній формі» (`matchLabels: {}`) без плейсхолдерів — JS підставляє конкретний `appLabel` програмно. Файли: `npm/rules/k8s/policy/network_policy/network_policy.rego`, `npm/rules/k8s/policy/network_policy/network_policy_test.rego`, `npm/rules/k8s/js/manifests.mjs` (`buildNetworkPolicyYaml`, `NETWORK_POLICY_EGRESS_YAML`, `regenerateLegacyNetworkPolicyDocsInFile`).
