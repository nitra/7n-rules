---
type: ADR
title: "Явний список in-cluster портів замість відкритого `namespaceSelector: {}` у канонічному NetworkPolicy egress"
---

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

## Update 2026-05-19

### Склад дефолтного in-cluster списку портів

Після вибору підходу B (статичний список) визначено дефолтний набір: `80, 443, 5432, 3306, 1433, 6379, 8080, 4317, 4318`. Мінімальний набір (лише DB-порти) відхилено — зламав би ≥12 сервісів на 8080 (Hasura, HTTP-backends) та Redis (6379). Порт 1433 (MSSQL) включений як «канон Adminer» попри відсутність реальних інстансів у репо на момент рішення. Порти 3488 (`nitra/ai`) та 8000 (`open-webui`) — out-of-scope; власники мусять додавати extra-порти вручну.

Семантика check: обов'язкова лише **структура** правила (`to: [{namespaceSelector: {}}]` + непорожній `ports:`); наявність усіх 9 дефолтних портів не перевіряється; extra-порти явно дозволені.

Константа: `NETWORK_POLICY_IN_CLUSTER_DEFAULT_PORTS = [80, 443, 5432, 3306, 1433, 6379, 8080, 4317, 4318]` у `npm/rules/k8s/fix/manifests/check.mjs`.

### Стратегія міграції існуючих NetworkPolicy (M1)

Chosen option: **M1 — автоматичний повний перезапис** через `buildNetworkPolicyYaml(deployName, appLabel)`: якщо NP містить catch-all `to: [{namespaceSelector: {}}]` без `ports:`, функція `fixNetworkPolicyFile` повністю переписує файл. M2 (ручне оновлення) — повільно і потребує координації; M3 (масове видалення + fix) — може знищити локальні правки. Один детермінований прогін `npx @nitra/cursor fix k8s` приводить увесь репо у відповідність без ручних правок.

Повний перезапис знищить будь-які extra-порти чи коментарі, додані вручну після генерації — на момент міграції таких правок у репо не було (ризик прийнятий свідомо).

- Spec: `docs/superpowers/specs/2026-05-19-networkpolicy-egress-explicit-ports-design.md`
- Plan: `docs/superpowers/plans/2026-05-19-networkpolicy-egress-explicit-ports-plan.md`
- Rego deny: `npm/rules/k8s/policy/network_policy/network_policy.rego`
