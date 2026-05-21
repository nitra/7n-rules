# Явний список in-cluster портів замість відкритого `namespaceSelector: {}` у канонічному NetworkPolicy egress

**Status:** Accepted
**Date:** 2026-05-19

## Context and Problem Statement

Канонічний шаблон egress у `npm/rules/k8s/policy/network_policy/template/networkpolicy.snippet.yaml` містив правило `to: [{namespaceSelector: {}}]` без поля `ports:`, яке фактично дозволяло Podʼам ходити на будь-який порт будь-якого Pod у кластері. Під час додавання підтримки сервісу типу Adminer стало очевидно, що це порушує принцип least-privilege. Виникла потреба перейти до явного статичного списку in-cluster портів.

## Considered Options

- **A — Проєктний аналіз залежностей:** автоматично дозволяти порти на основі `package.json` / env (pg → 5432, mysql2 → 3306 тощо).
- **B — Статичний явний список in-cluster портів глобально.**
- **C — Зберегти відкритий in-cluster, додати DB-порти лише до `ipBlock 0.0.0.0/0` для Adminer.**

## Decision Outcome

Chosen option: "B — Статичний явний список in-cluster портів глобально", because варіант A визнаний надто складним і крихким (матриця {мова × менеджер пакетів × конвенція}, false negatives для динамічних підключень); варіант C — лише локальний патч, що не закриває загальну проблему; варіант B дає реальний крок до least-privilege без введення зовнішніх залежностей.

Обраний дефолтний набір портів: `80, 443, 5432, 3306, 1433, 6379, 8080, 4317, 4318`.
Семантика перевірки `check`: мінімум — лише структура правила обов'язкова (наявність блоку `namespaceSelector: {}` з полем `ports:`); конкретний список портів не валідується суворо.

### Consequences

- Good, because відкритий `namespaceSelector: {}` без `ports:` більше не є каноном — egress in-cluster обмежено явним переліком портів.
- Good, because аудит фактичних `containerPort`/`targetPort` у репо підтвердив, що 9 обраних портів покривають усі реальні комунікації: `8080` × 19 svc, `5432` × 4, `6379` × 3, `3306` × 1, `4317/4318` × 1.
- Bad, because перехід торкається всіх auto-generated `networkpolicy.yaml` — потрібен аудит воркфлоу, що використовують нестандартні in-cluster порти (`13133`, `3488`, `8000`), які не потрапили до дефолту.
- Neutral, because K8s NetworkPolicy діє на рівні Pod IP, не Service ClusterIP; обмеження egress з портами не замінює ingress-policy на стороні БД-подів.

## More Information

- Шаблон: `npm/rules/k8s/policy/network_policy/template/networkpolicy.snippet.yaml`.
- Генератор NP: `npm/rules/k8s/fix/manifests/check.mjs` — нова константа `NETWORK_POLICY_IN_CLUSTER_DEFAULT_PORTS = [80, 443, 5432, 3306, 1433, 6379, 8080, 4317, 4318]`.
- Rego-перевірка: `npm/rules/k8s/policy/network_policy/network_policy.rego`.
- Ідентифікація Adminer (первісний тригер): `metadata.name` містить підрядок `adminer` — DB-порти входять до загального списку, спеціальна гілка відпала.
- Порти-аутлаєри, що не ввійшли до дефолту: `13133`, `3488`, `8000` (одиничні випадки у репо nitra).
