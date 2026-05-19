---
session: b2548bae-dcf7-4da7-a1d3-edd830b8c5e9
captured: 2026-05-19T09:53:30+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/b2548bae-dcf7-4da7-a1d3-edd830b8c5e9.jsonl
---

## ADR Новий канон in-cluster egress: явний список портів замість catch-all

## Context and Problem Statement
Канонічний `networkpolicy.yaml` у `npm/rules/k8s` мав egress-rule `to: [{namespaceSelector: {}}]` без поля `ports:` — це catch-all, що дозволяє будь-який in-cluster трафік на будь-якому порту. Задача — зрушитися до least-privilege NetworkPolicy для сервісів типу Adminer та інших воркфлоу.

## Considered Options
* **A** — Детектувати залежності у `package.json` / інших менеджерах пакетів і дозволяти тільки відповідні порти (Postgres → 5432, Redis → 6379 тощо)
* **B** — Замінити catch-all на статичний список явних портів, однаковий для всіх NetworkPolicy глобально
* **C** — Зберегти відкритий in-cluster для всіх, але додати DB-порти до `ipBlock 0.0.0.0/0` тільки для Adminer (зовнішні БД)

## Decision Outcome
Chosen option: "B — глобальний статичний список портів", because варіант A визнано надто крихким (динамічні залежності, мультимовність, необхідність ребілду NP при кожній зміні `package.json`); варіант C вирішує лише зовнішній egress Adminer, не покращуючи in-cluster картину.

### Consequences
* Good, because transcript фіксує очікувану користь: рух до least-privilege NetworkPolicy — кожен workload явно декларує, до яких in-cluster ресурсів має ходити.
* Bad, because воркфлоу з нестандартними портами (3488, 8000 — виявлені аудитом) після міграції матимуть зламаний in-cluster трафік і потребують ручного додавання extra-портів; відповідальні за ці сервіси мають бути окремо поінформовані.

## More Information
Аудит портів у `/Users/vitaliytv/www/nitra` (Service + containerPort): 8080×19/12, 5432×4, 6379×3/3, 80×3, 3306×1/1, 4317/4318×1, 13133×1, 8000×1, 3488×1. Аутлаєри 3488 та 8000 поза дефолтним канон. Файли: `npm/rules/k8s/fix/manifests/check.mjs`, `npm/rules/k8s/policy/network_policy/network_policy.rego`, `npm/rules/k8s/policy/network_policy/template/networkpolicy.snippet.yaml`.

---

## ADR Склад дефолтного in-cluster списку портів

## Context and Problem Statement
Після вибору підходу B (статичний список) необхідно визначити, які саме порти входять у дефолтний канон `namespaceSelector: {}` — занадто вузький набір зламає реальні воркфлоу, занадто широкий знецінить least-privilege.

## Considered Options
* **Мінімальний** — тільки DB-порти: 5432, 3306, 1433
* **Широкий** — 80, 443, 5432, 3306, 1433, 6379, 8080, 4317, 4318

## Decision Outcome
Chosen option: "Широкий — 80, 443, 5432, 3306, 1433, 6379, 8080, 4317, 4318", because мінімальний набір зламав би ≥12 сервісів на 8080 (Hasura, HTTP-backends) та Redis (6379), тоді як широкий покриває фактичний розподіл портів виявлений аудитом.

### Consequences
* Good, because transcript фіксує очікувану користь: дефолт покриває всі актуальні внутрішні сервіси репо `nitra` без ручних доповнень при міграції.
* Bad, because 1433 (MSSQL) має 0 фактичних інстансів у репо на момент сесії — включений як «канон Adminer», що розширює дозволену поверхню без реального трафіку.

## More Information
Константа `NETWORK_POLICY_IN_CLUSTER_DEFAULT_PORTS = [80, 443, 5432, 3306, 1433, 6379, 8080, 4317, 4318]` у `npm/rules/k8s/fix/manifests/check.mjs`. Порти 3488 та 8000 явно виключено з дефолту і позначено для вирішення окремим тікетом. Семантика check — «мінімум: лише наявність структури правила обов'язкова»; extra-порти у файлі дозволені.

---

## ADR Стратегія міграції існуючих NetworkPolicy при зміні канону

## Context and Problem Statement
Усі наявні `networkpolicy.yaml` у репо містять старий catch-all `to: [{namespaceSelector: {}}]` без `ports:`. Після введення нового rego-deny CI впаде одразу для всіх воркфлоу, поки файли не оновляться. Потрібно визначити механізм переходу.

## Considered Options
* **M1** — Автоматичний: `fixNetworkPolicyFile` детектує старий catch-all і повністю перезаписує файл через `buildNetworkPolicyYaml`
* **M2** — Ручне оновлення кожного файлу власником сервісу
* **M3** — Видалити всі `networkpolicy.yaml`, потім `npx @nitra/cursor fix k8s` відновить їх

## Decision Outcome
Chosen option: "M1 — автоматичний повний перезапис через buildNetworkPolicyYaml", because M2 повільно і потребує координації усіх команд; M3 простий, але може втратити будь-які локальні ручні правки (навіть якщо їх зараз немає — ризик непомічений); M1 дає один детермінований прогін без ручного втручання.

### Consequences
* Good, because transcript фіксує очікувану користь: один виклик `npx @nitra/cursor fix k8s` (або відповідний fix-крок) приводить усі файли у новий канон без ручної роботи.
* Bad, because повний перезапис файлу знищить будь-які extra-порти чи коментарі, які хтось міг додати вручну після генерації — на момент міграції таких правок немає, але підхід не є накопичувальним.

## More Information
Реалізація: `fixNetworkPolicyFile` (`npm/rules/k8s/fix/manifests/check.mjs:4337`) розширюється логікою: якщо файл існує і його in-cluster egress-rule не має `ports:` — повний перезапис через `buildNetworkPolicyYaml(name, appLabel)`. Spec: `docs/superpowers/specs/2026-05-19-networkpolicy-egress-explicit-ports-design.md`. Plan: `docs/superpowers/plans/2026-05-19-networkpolicy-egress-explicit-ports-plan.md`.
