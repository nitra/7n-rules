---
session: af439e20-6686-4ea2-9699-db61751cdfda
captured: 2026-05-17T17:54:12+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/af439e20-6686-4ea2-9699-db61751cdfda.jsonl
---

## ADR Розширення таблиці HTTPRoute name/namespace — проєктний ns = назва середовища

## Context and Problem Statement
У `npm/rules/k8s/k8s.mdc` таблиця "Правила для name і namespace" для `HTTPRoute` містила лише два рядки: загальний випадок (`ns=<env>`) і однойменний ns (`ns=<застосунок>`). Але при цьому рядок "ns = назва застосунку" був задублікований, а окремого рядка для ситуації, коли `namespace` дорівнює назві середовища (проєктний ns, наприклад `ua`, `tr`, `kz`), не існувало.

## Considered Options
* Додати третій рядок у таблицю — "ns = назва середовища (проєктний ns)" з `metadata.namespace = <env>` — і дедублікувати весь файл автоматично
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Додати третій рядок і дедублікувати", because користувач підтвердив, що існує реальний випадок коли застосунок знаходиться в неймспейсі, що дорівнює назві середовища (`ua`, `tr`, `kz`), і ця ситуація має бути задокументована окремим рядком у таблиці. Весь файл `k8s.mdc` водночас був повністю переписаний для усунення масових дублікатів рядків (артефакт редактора).

### Consequences
* Good, because таблиця тепер охоплює усі три семантично різних випадки `metadata.namespace` для `HTTPRoute`: `<env>`, `<застосунок>`, а також проєктний `<env>`.
* Good, because transcript фіксує очікувану користь: існуюча гілка `valid_namespace(name, namespace) if { namespace == env }` у `npm/rules/k8s/policy/httproute/httproute.rego` вже покривала новий рядок — окрема гілка Rego не потрібна, лише дедублікація policy-файлу і новий тест `test_valid_project_env_ns_ua`.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- Файл правила: `npm/rules/k8s/k8s.mdc` (розділ `### Правила для name і namespace`)
- Шаблон імені: `<застосунок>-<env>` (наприклад, `sms-dev` = застосунок `sms`, середовище `dev`)
- Допустимі значення `<env>`: `dev`, `ua`, `qa`, `tr`, `kz`, `tr-qa` (з розділу `## Overlays`)
- Rego-поліс: `npm/rules/k8s/policy/httproute/httproute.rego` — функція `valid_namespace`; обидві гілки збережені без змін
- Тести: `npm/rules/k8s/policy/httproute/httproute_test.rego` — доданий `test_valid_project_env_ns_ua`; усі 7 тестів проходять (`opa test … -v`)
