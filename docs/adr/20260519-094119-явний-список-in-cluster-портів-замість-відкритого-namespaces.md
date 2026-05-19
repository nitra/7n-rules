---
session: b2548bae-dcf7-4da7-a1d3-edd830b8c5e9
captured: 2026-05-19T09:41:19+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/b2548bae-dcf7-4da7-a1d3-edd830b8c5e9.jsonl
---

## ADR Явний список in-cluster портів замість відкритого `namespaceSelector: {}` у канонічному NetworkPolicy

## Context and Problem Statement
Під час додавання підтримки сервісу типу Adminer (доступ до зовнішніх/внутрішніх БД) стало очевидно, що поточний канон NetworkPolicy дозволяє egress до будь-якого pod у кластері на довільному порту через `to: [{namespaceSelector: {}}]` без поля `ports`. Це не відповідає принципу least-privilege, і замість локального фіксу для Adminer було вирішено переробити канон глобально.

## Considered Options
* **A — Проєктний аналіз залежностей:** автоматично дозволяти порти на основі `package.json` / env (pg → 5432, mysql2 → 3306 тощо).
* **B — Статичний явний список in-cluster портів глобально** (обраний).
* **C — Зберегти відкритий in-cluster, додати DB-порти лише до `ipBlock 0.0.0.0/0` для Adminer.**

## Decision Outcome
Chosen option: "B — Статичний явний список in-cluster портів глобально", because варіант A визнаний надто складним і крихким (матриця {мова × менеджер пакетів × конвенція}, false negatives для динамічних підключень), варіант C — лише локальний патч, що не закриває загальну проблему. Варіант B дає чесний крок до least-privilege без введення зовнішніх залежностей.

### Consequences
* Good, because `namespaceSelector: {}` без `ports` більше не є catch-all — in-cluster egress обмежений дефолтним набором `80, 443, 5432, 3306, 1433, 6379, 8080, 4317, 4318`.
* Good, because єдине джерело правди — константа `NETWORK_POLICY_IN_CLUSTER_DEFAULT_PORTS` у `check.mjs`; генератор `buildNetworkPolicyYaml` не потребує змін логіки.
* Bad, because перехід зачіпає всі auto-generated `networkpolicy.yaml` у репо — потрібен аудит воркфлоу, що використовують нестандартні in-cluster порти (13133, 3488, 8000), які не потрапили до дефолту.
* Neutral, because семантика check змінена на «мінімум — лише структура правила обов'язкова» (конкретний список портів не валідується суворо), тому transcript не містить підтвердження наслідку щодо enforcement.

## More Information
- Шаблон: `npm/rules/k8s/policy/network_policy/template/networkpolicy.snippet.yaml` — оновлюється відповідно до нового канону.
- Генератор: `npm/rules/k8s/fix/manifests/check.mjs` (~L4259) — константа `NETWORK_POLICY_EGRESS_YAML` і нова `NETWORK_POLICY_IN_CLUSTER_DEFAULT_PORTS = [80, 443, 5432, 3306, 1433, 6379, 8080, 4317, 4318]`.
- Ідентифікація Adminer (первісний тригер): `metadata.name` містить підрядок `adminer` — обговорювалась як критерій для специфічних правил, але після переходу до глобального дефолту відпала потреба у спеціальній гілці: DB-порти входять до загального списку.
- Аудит фактичних портів у `nitra`: `8080` × 19 svc, `5432` × 4, `6379` × 3, `3306` × 1, `4317/4318` × 1; порти `13133`, `3488`, `8000` — одиничні аутлаєри, не вийшли у дефолт.
- K8s NetworkPolicy діє на рівні Pod IP, не Service ClusterIP; обмеження egress на рівні `namespaceSelector: {}` з портами не замінює ingress-policy на стороні БД-подів.
