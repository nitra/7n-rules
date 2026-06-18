---
type: ADR
title: "Rego-полісі мінімальних версій marketplace actions у GitHub Actions"
---

# Rego-полісі мінімальних версій marketplace actions у GitHub Actions

**Status:** Accepted
**Date:** 2026-05-22

## Context and Problem Statement

У `@nitra/cursor` вже існує стек лінтингу workflow (`actionlint`, `zizmor`, `conftest`+Rego), але жоден із шарів не перевіряв, що конкретна marketplace action не використовує застарілий runtime. `Infisical/secrets-action@v1.0.8` використовує `runs.using: node20`, deprecated GitHub з червня 2026. Потрібно визначити, який шар відповідає за deny на застарілі runtime-версії third-party actions, і зафіксувати конкретні мінімальні теги. Додатково: перша реалізація зафіксувала hard deny для `actions/checkout < v6.0.2` і масово замінила `checkout@v6` → `checkout@v6.0.2` у workflow-шаблонах і тестах, що спричинило великий diff у споживацьких репо.

## Considered Options

- **actionlint** — перевіряє лише «знятий з GHA» runner (node16); `node20` ще дозволений; неканонічні actions (Infisical) поза корпусом popular actions.
- **zizmor** — security-аудит (`unpinned-uses`, injection, permissions), не читає `runs.using` у чужих action.
- **conftest + Rego у `ga.workflow_common`** — вже містить канон Nitra; може порівнювати `uses:` кожного кроку з allowlist мінімальних версій у JSON-файлі.
- **Окремий скрипт із резолюцією `action.yml` через GitHub API** — потребує виклику зовнішніх API для кожного `uses:`.
- **`actions/checkout` мінімум `v6.0.2`** (hard deny, перший варіант) — вимагає оновлення всіх workflow-файлів у споживацьких репо.
- **`actions/checkout` мінімум major `v6`** — deny лише для v5 і нижче; `@v6` дозволений.

## Decision Outcome

Chosen option: "conftest + Rego у `ga.workflow_common` з JSON-канон у `template/uses-min-versions.snippet.json`; мінімум `actions/checkout` — major `v6`", because цей шар фіксує проєктний канон і архітектурно є правильним місцем для deny-правил; перевірка відбувається локально через `npx @nitra/cursor check ga` без виклику зовнішніх API; JSON-файл є єдиним місцем для оновлення канону. Hard deny на `v6.0.2` скасовано: `@v6` (major tag) вже означає major-версію без Node <6-runtime, а масова заміна не давала додаткової safety-гарантії.

Зафіксовані мінімальні версії:
- `Infisical/secrets-action` ≥ `1.0.16` (перша версія з `runs.using: node24`, підтверджено через WebFetch GitHub raw).
- `actions/checkout` ≥ major `6` (deny для v5 і нижче).

### Consequences

- Good, because порушення `Infisical/secrets-action@v1.0.8` і `actions/checkout@v5` ловляться локально на рівні `conftest deny` до push у GitHub.
- Good, because `actions/checkout@v6` залишається валідним без змін у споживацьких репо; скасовано масовий diff у workflow-шаблонах і тестах.
- Bad, because перевірка охоплює лише actions, перелічені в `uses-min-versions.snippet.json`, — нові deprecated runtimes потребують ручного оновлення JSON.
- Neutral, because `actions/checkout@v6.0.0` або `v6.0.1` (гіпотетично) пройде deny, хоча `v6.0.2` може мати патч-виправлення — transcript не містить підтвердження, що такі версії існують або є проблемними.

## More Information

- Канон версій: `npm/rules/ga/policy/workflow_common/template/uses-min-versions.snippet.json`
```json
{
  "actions/checkout": "6",
  "Infisical/secrets-action": "1.0.16"
}
```
- Rego deny-правило: `npm/rules/ga/policy/workflow_common/workflow_common.rego` (функції `action_ref_meets_min`, `version_triple`, `version_gte`).
- SHA-pin (40-символьний hex) явно виключено з перевірки (`action_ref_is_sha_pin`) — завжди дозволений.
- Semver-порівняння: `[6,0,0]` ≥ `[6,0,0]` → OK; `[5,*,*]` < `[6,0,0]` → deny.
- Тести: `npm/rules/ga/policy/workflow_common/workflow_common_test.rego`.
- Оркестратор: `npm/rules/ga/fix/workflows/check.mjs` (передає template у `runConftestBatch`).
- Запуск: `npx @nitra/cursor check ga`.
- Рекомендація `v6.0.2+` (Node 24 runtime) залишена в `ga.mdc` версія `1.10` як текстова примітка, не як deny.
- Версія пакета після змін: `1.13.76` (`npm/package.json`, `npm/CHANGELOG.md`).

## Update 2026-05-22

Додатковий контекст із другого transcript-запису тієї ж сесії (captured 13:29:39):

- Оркестратор передає template у `runConftestBatch` через `npm/rules/ga/fix/workflows/check.mjs` (підтверджено окремо).
- `ga.mdc` версія `1.10`; приклади у документі використовують `actions/checkout@v6` — узгоджено з рішенням major `v6`.
- Transcript не містить підтверджених негативних наслідків від вибору `conftest + Rego` понад вже зафіксовані.
