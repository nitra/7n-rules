---
session: b2548bae-dcf7-4da7-a1d3-edd830b8c5e9
captured: 2026-05-19T09:36:04+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/b2548bae-dcf7-4da7-a1d3-edd830b8c5e9.jsonl
---

This transcript shows a clear design decision about the new default in-cluster egress port list and removal of the open `namespaceSelector: {}`. I'll produce the ADR now.

## ADR Новий канон egress NetworkPolicy: явний список in-cluster портів замість відкритого `namespaceSelector: {}`

## Context and Problem Statement
Канонічний шаблон egress у `npm/rules/k8s/policy/network_policy/template/networkpolicy.snippet.yaml` містив правило `to: [{namespaceSelector: {}}]` без поля `ports:`, яке фактично дозволяло Podʼам ходити на **будь-який порт будь-якого Pod** у кластері. Для сервісу типу Adminer, що має ходити на зовнішні БД, і взагалі для принципу least-privilege це надмірно широко. Виникла потреба перейти до явного статичного списку in-cluster портів.

## Considered Options
* **A** — зберегти відкритий in-cluster, додати DB-порти лише до `ipBlock 0.0.0.0/0` Adminer-подібних воркфлоу
* **B** — глобальний перехід: замінити відкритий `namespaceSelector: {}` явним переліком портів у всіх auto-generated NetworkPolicy
* **C** (проєктний аналіз) — автоматично детектити залежності сервісу (`package.json`, `pg`, `mysql2`) і дозволяти лише відповідні порти

## Decision Outcome
Chosen option: **"B — глобальний статичний список in-cluster портів"**, because він дає реальне least-privilege без складного аналізу залежностей, покриває всі фактично вживані in-cluster порти у репо nitra (встановлені аудитом containerPort/targetPort) і є одноразовою глобальною зміною.

Обраний дефолтний набір портів: `80, 443, 5432, 3306, 1433, 6379, 8080, 4317, 4318`.

Семантика перевірки `check`: **мінімум — лише структура правила обов'язкова** (наявність блоку `namespaceSelector: {}` з полем `ports:`). Додаткові порти (понад дефолт) у NP-файлі — дозволені.

Ідентифікація workload типу Adminer — за `metadata.name` містить підрядок `adminer`.

### Consequences
* Good, because відкритий `namespaceSelector: {}` без `ports:` більше не є каноном — egress in-cluster обмежено явним переліком портів.
* Good, because transcript фіксує очікувану користь: аудит фактичних `containerPort`/`targetPort` у репо підтвердив, що 9 обраних портів покривають усі реальні комунікації.
* Bad, because перехід торкається **всіх** auto-generated `networkpolicy.yaml` — потрібен аудит інстансів, де використовуються нестандартні порти (напр., `3488`, `13133`, `8000`), щоб вручну додати їх у per-workload override.

## More Information
- Шаблон: `npm/rules/k8s/policy/network_policy/template/networkpolicy.snippet.yaml`
- Генератор NP: `npm/rules/k8s/fix/manifests/check.mjs`
- Rego-перевірка: `npm/rules/k8s/policy/network_policy/network_policy.rego`
- Аудит портів: `containerPort: 8080×12, 5432×4, 6379×3, 80×3, 3306×1`; `targetPort: 8080×3, 6379×1, 4318×1, 4317×1, 3306×1, 13133×1`
- Ідентифікація Adminer: `metadata.name.contains("adminer")` → дефолтні DB-порти вже покриті загальним списком (5432, 3306, 1433)
