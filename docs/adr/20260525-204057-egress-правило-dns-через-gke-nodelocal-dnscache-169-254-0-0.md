---
session: 67092753-dd58-41fc-95cc-62403acd1407
captured: 2026-05-25T20:40:57+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/67092753-dd58-41fc-95cc-62403acd1407.jsonl
---

## ADR Egress-правило DNS через GKE NodeLocal DNSCache (169.254.0.0/16) у NetworkPolicy

## Context and Problem Statement
На GKE кластерах з увімкненим NodeLocal DNSCache kubelet прописує у `/etc/resolv.conf` подів не ClusterIP kube-dns, а локальний DNS-агент ноди з link-local адресою (з діапазону `169.254.0.0/16`, RFC 3927). Якщо NetworkPolicy містить `policyTypes: [Egress]`, DNS-запити з пода блокуються до того, як вони взагалі доходять до CoreDNS чи kube-dns — і pod стає нездатним резолвити будь-яке ім'я.

## Considered Options
* Додати `ipBlock: cidr: 169.254.0.0/16, ports: 53/UDP+TCP` в `egress`
* Покладатися лише на правило `namespaceSelector: {kubernetes.io/metadata.name: kube-system}` (стара поведінка — тільки kube-dns ClusterIP)

## Decision Outcome
Chosen option: "Додати `ipBlock: cidr: 169.254.0.0/16, ports: 53/UDP+TCP` в `egress`", because на GKE з NodeLocal DNSCache трафік до kube-dns ClusterIP взагалі не виходить безпосередньо з пода — він іде через link-local агент ноди, і тільки він проксує у CoreDNS. Правило на `kube-system` не покриває цей шлях.

### Consequences
* Good, because transcript фіксує очікувану користь: DNS-резолвінг усередині NetworkPolicy-обмежених подів на GKE починає працювати.
* Bad, because у не-GKE кластерах без NodeLocal DNSCache правило пропускає порожній діапазон (на 169.254.x.x там ніхто не слухає) і шкоди не робить — Neutral, because transcript не містить підтвердження негативних наслідків.

## More Information
Змінений файл: `npm/rules/k8s/policy/network_policy/template/networkpolicy.snippet.yaml` (рядки 10–25 після редагування).
Команда перевірки: `conftest test --data npm/rules/k8s/policy/network_policy/template/networkpolicy.snippet.yaml -p npm/rules/k8s/policy/network_policy`.
Офіційна документація GKE NodeLocal DNSCache: https://cloud.google.com/kubernetes-engine/docs/how-to/nodelocal-dns-cache — посилання взято з transcript, де асистент запропонував додати його до .mdc.

---

## ADR networkpolicy.snippet.yaml як єдине джерело правди канону NetworkPolicy

## Context and Problem Statement
Канон egress-правил NetworkPolicy дублювався у 7 місцях одночасно: `networkpolicy.snippet.yaml` (еталон-для-очей), `NETWORK_POLICY_EGRESS_YAML` (JS-рядок), `networkPolicyManifestViolations` (JS-валідатор), `network_policy.rego` (OPA-перевірка), `network_policy_test.rego` (rego-фікстури), `check-schema.test.mjs` (JS-тести), `k8s.mdc` (документація). Будь-яка зміна (наприклад, додавання link-local DNS-правила) вимагала синхронного оновлення всіх 7 і легко розсихалася.

## Considered Options
* (A) Прибрати rego повністю: JS — єдиний owner, rego-файли видаляються
* (B) Прибрати тільки JS-валідацію: `networkPolicyManifestViolations` видаляється, cross-file прив'язка і fix лишаються в JS
* (C) JS тонкий шар (I/O + cross-file binding), rego — структурна перевірка; обидва читають snippet — власного канону в коді нема

Для з'єднання snippet → rego:
* (1) `conftest --data snippet.yaml` — snippet підставляється як `data.network_policy_snippet` в runtime
* (2) codegen: pre-step генерує `_canon.json`, rego імпортує його
* (3) snapshot-тест: rego-фікстури зіставляються з окремим JS-побудованим об'єктом

Для форми snippet'а:
* (α) Загальна форма: `matchLabels: {}`, JS merge-підставляє `app: <label>` при генерації
* (β) Плейсхолдери (`app: __APP__`) у snippet
* (γ) Повний канонічний документ із прикладовими значеннями

## Decision Outcome
Chosen option: "(C) JS тонкий шар + (1) conftest --data + (α) matchLabels:{}", because це найкоротший шлях від зміни у snippet до автоматичного підтягування і в JS-генераторі, і в rego-валідаторі без проміжних артефактів і кодогенерації. JS зберігає cross-file логіку (яку conftest не вміє — бачить один документ за раз), rego стає єдиним owner'ом структурного канону.

### Consequences
* Good, because transcript фіксує очікувану користь: зміна канону = редагування одного файлу snippet; решта підтягується автоматично.
* Good, because transcript фіксує очікувану користь: `NETWORK_POLICY_EGRESS_YAML` (рядковий дубль), `networkPolicyManifestViolations`, `NETWORK_POLICY_IN_CLUSTER_DEFAULT_PORTS` видаляються з `manifests.mjs` — це зменшує область для розсихання.
* Bad, because видалення `networkPolicyManifestViolations` — breaking change публічного JS-API `@nitra/cursor` → major version bump. Transcript фіксує це як заплановану дію (Phase 4d плану).
* Bad, because `conftest` стає новою обов'язковою залежністю в CI та локальному `lint-k8s`. Transcript не містить підтвердження, що це спричинить проблему — але фіксує як known risk #1.

## More Information
Спек: `docs/superpowers/specs/2026-05-25-networkpolicy-snippet-single-source-of-truth-design.md`
План реалізації: `docs/superpowers/plans/2026-05-25-networkpolicy-snippet-single-source-of-truth.md`
Ключові файли змін: `npm/rules/k8s/js/manifests.mjs` (функції `buildNetworkPolicyYaml`, `loadNetworkPolicyCanonSpec`), `npm/rules/k8s/policy/network_policy/network_policy.rego`, `npm/rules/k8s/policy/network_policy/network_policy_test.rego`, `npm/rules/k8s/k8s.mdc`, `npm/rules/k8s/package.json` (або root `package.json`), `.github/workflows/lint-k8s.yml`.
Конфігурація conftest: `conftest test --data npm/rules/k8s/policy/network_policy/template/networkpolicy.snippet.yaml -p npm/rules/k8s/policy/network_policy --namespace k8s.network_policy`.
Стан на момент transcript: snippet оновлено (link-local блок додано), решта — Phase 1-4 плану.
