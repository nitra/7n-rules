---
type: ADR
title: "Виправлення LINT_TARGETS та конфігурація regal для rego-лінту"
---

# Виправлення LINT_TARGETS та конфігурація regal для rego-лінту

**Status:** Accepted
**Date:** 2026-05-17

## Context and Problem Statement

`bun run lint-rego` завершувався з exit code 0 без реального лінтингу: `LINT_TARGETS = ['npm/policy']` вказував на каталог, що зник після Phase 1 реструктуризації (всі `.rego` переїхали до `npm/rules/*/policy/`). Після виправлення regal виявив 156 прихованих violations, частина яких є інтенціональними конвенціями.

## Considered Options

- Оновити `LINT_TARGETS` до `['npm/rules']` і додати `.regal/config.yaml` для ігнорування інтенціональних правил
- Інші варіанти в transcript не обговорювалися.

## Decision Outcome

Chosen option: "Оновити LINT_TARGETS і додати .regal/config.yaml", because `npm/rules` — єдиний фактичний шлях до `.rego`-файлів; ігнорування трьох категорій violations обов'язково, бо вони є архітектурними рішеннями, а не помилками.

Три категорії ігнорування у `.regal/config.yaml`: (1) `idiomatic.directory-package-mismatch: ignore` — package-назва `<rule>.<concern>` є свідомим вибором; (2) `imports.unresolved-reference: ignore` — `data.template.*` інжектується через `--data` runtime; (3) `style.line-length.max-line-length: 220` — `opa fmt` тримає inline-об'єкти в одному рядку.

### Consequences

- Good, because `regal lint npm/rules` → 111 файлів, 0 violations; `opa test npm/rules` → 323/323 PASS.
- Good, because виявлено і виправлено 4 файли з `test-outside-test-package` та 6 файлів відформатовано через `opa fmt -w`.
- Good, because додано інтеграційний тест `lint.test.mjs` (3 тести: no-targets / broken-syntax / well-formed).
- Bad, because `LINT_TARGETS` мовчки видавав exit-0 протягом усього часу після Phase 1.

## More Information

Файли: `npm/rules/rego/lint/lint.mjs` (`LINT_TARGETS`), `.regal/config.yaml` (новий), `npm/rules/rego/lint/lint.test.mjs`.
Виправлені `test-outside-test-package`: `js-lint/policy/jscpd/jscpd_test.rego`, `js-lint/policy/vscode_extensions/vscode_extensions_test.rego`, `security/policy/gitleaks/gitleaks_test.rego`, `vue/policy/package_json/package_json_test.rego`.
Bump `1.13.9 → 1.13.10`. Коміт `81d8ea3`.

## Update 2026-05-17

Міграція ga і rego policy-концернів на template/-driven canon:

**Phase 2 — ga** (v1.13.9): 4 template-файли: `package.json.contains.json`, `extensions.json.snippet.json`, `settings.json.snippet.json`, `zizmor.yml.snippet.yml`. Паттерн drift-тесту: `test_data_template_drives_*` у `*_test.rego` передає навмисно змінений `data.template` і перевіряє що `deny` реагує. `findMissingMdcRefs("ga")` → `[]`. Коміт `3c98ecb`.

**Phase 3 — rego** (v1.13.11): 3 template-файли: `package.json.snippet.json`, `extensions.json.snippet.json`, `settings.json.snippet.json`. `opa test npm/rules` → 326/326 PASS. Коміт `b0efa4d`.

Інвентаризація концернів: `docs/adr/template-dir-concern-inventory.md`.

## Update 2026-05-17

**Phase 3.5 — ga workflow-концерни** (v1.13.12): backfill для 4 full-canon workflow концернів (`clean_ga_workflows`, `clean_merged_branch`, `lint_ga`, `git_ai`), пропущених у Phase 2.

Виявлений нюанс Go-yaml vs npm-yaml: Go-yaml (conftest) парсить `no` як `bool false`, npm yaml (v1.2) — як рядок. Вирішено через перевірку типу у Rego: `is_boolean(input.jobs["clean-merged-branch"].steps[_].with.dry_run)`. Коміт `55a6751`.

Обраний підхід — per-concern field-by-field (а не generic recursive subset-walker): зберігає явність перевірок без нового generic механізму.
