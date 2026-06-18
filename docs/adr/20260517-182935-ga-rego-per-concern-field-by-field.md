---
type: ADR
title: "GA rego: per-concern field-by-field та конвенції тест-пакетів"
---

# GA rego: per-concern field-by-field та конвенції тест-пакетів

**Status:** Accepted
**Date:** 2026-05-17

## Context and Problem Statement

Під час phase 3.5 міграції GA rule на template/-driven canon постало три технічних питання: (1) як rego перевіряє повні `.github/workflows/*.yml` — через generic subset-of walker чи через окремі field-by-field deny-правила; (2) у якому пакеті OPA мають знаходитись тест-правила (`test_*`); (3) як обробити розрив між Go-yaml і JS-yaml при парсингу `dry_run: no` у template YAML.

## Considered Options

### Патерн перевірки workflow
* Per-concern field-by-field: кожен rego читає `data.template.snippet` і перевіряє конкретні поля через deny-правила
* Generic subset-of walker: один рекурсивний walker перевіряє будь-який snippet як повне дерево `a ⊆ b`

### Іменування тест-пакетів
* `package <rule>.<concern>_test` + явний `import data.<rule>.<concern>` — стандартна OPA-конвенція
* `package <rule>.<concern>` — тести у продуктовому пакеті (поточний стан)

### Обробка `dry_run: no` у template YAML
* Коментар `# dry_run: false` у template + hardcode `false` у rego-логіці
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome

Chosen option: "Per-concern field-by-field" для перевірки workflow, because так вирішив користувач явно через `AskUserQuestion`; підхід зберігає семантичні deny-повідомлення і не потребує нового generic-механізму.

Chosen option: "`package <rule>.<concern>_test` + явний import", because це стандартна OPA-конвенція; без неї тест мовчки перестає перевіряти продуктовий пакет при перейменуванні `deny` без кваліфікованого шляху.

Chosen option: "Коментар + `false` у rego", because `false` — це значення, яке Go-yaml (conftest) повертає при парсингу YAML-літерала `no`; коментар у template документує розрив між YAML-джерелом і rego-логікою.

### Consequences

* Good, because кожен rego-файл явно показує, які поля workflow є канонічними, без generic-абстракції.
* Good, because regal перестав репортувати `test-outside-test-package` після перейменування пакетів.
* Good, because `n-cursor check ga` перейшов з 0/1 на 1/1 після зміни обробки `dry_run`.
* Bad, because template `clean-merged-branch.yml.snippet.yml` вже не є точною копією workflow — коментар обов'язковий для пояснення розходження.
* Neutral, because transcript не містить підтвердження щодо впливу на швидкість lint-запуску.

## More Information

Per-concern реалізовано у: `npm/rules/ga/policy/clean_ga_workflows/clean_ga_workflows.rego`, `clean_merged_branch.rego`, `lint_ga.rego`, `git_ai.rego`. Комміт `55a6751` (v1.13.12).

Перейменовані тест-файли на `*_test`: `npm/rules/js-lint/policy/jscpd/jscpd_test.rego`, `npm/rules/js-lint/policy/vscode_extensions/vscode_extensions_test.rego`, `npm/rules/security/policy/gitleaks/gitleaks_test.rego`, `npm/rules/vue/policy/package_json/package_json_test.rego`. Комміт `81d8ea3` (v1.13.10).

Коментар-обхід: `npm/rules/ga/policy/clean_merged_branch/template/clean-merged-branch.yml.snippet.yml`. Go-yaml (conftest) читає `no` як `bool false`; JS-yaml (npm, YAML 1.2) — як рядок `"no"`. Комміт `55a6751` (v1.13.12).

Виправлення LINT_TARGETS та конфігурація `.regal/config.yaml` зафіксовані окремо в `rego-lint-targets-та-regal-конфігурація.md`.
