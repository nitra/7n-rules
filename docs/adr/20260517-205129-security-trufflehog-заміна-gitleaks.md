---
type: ADR
title: "Заміна gitleaks на TruffleHog для secret scanning"
---

# Заміна gitleaks на TruffleHog для secret scanning

**Status:** Accepted
**Date:** 2026-05-17

## Context and Problem Statement

Правило `security` використовувало `gitleaks detect --no-banner --no-git` як канонічний скрипт `lint-security`. Прийнято рішення мігрувати на TruffleHog з вибором конкретного режиму сканування, фільтра результатів і механізму allowlist. Окремо постало питання щодо workflow `.github/workflows/lint-security.yml`: він зберігався як inline YAML у `security.mdc` без Rego-enforcement, на відміну від аналогічних rules (`php`, `style-lint`, `js-lint`).

## Considered Options

### Інструмент secret scanning
* TruffleHog у режимі `filesystem` з `--results=verified,unknown` та `.trufflehog-exclude`
* TruffleHog у режимі `git` (сканування git-history)
* Залишити gitleaks

### lint-security.yml workflow
* Залишити inline у `security.mdc` як опційний
* Перенести до `template/` без Rego (doc-canon, без enforcement)
* Перенести до `template/` + Rego policy з `required: true`

### template-first canon у scripts.mdc
* Додати явну вимогу до `scripts.mdc`
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome

Chosen option: "TruffleHog filesystem з `--results=verified,unknown` та `.trufflehog-exclude`", because `filesystem` сканує робоче дерево без git-індексу (аналог `--no-git`); `--results=verified,unknown` відсіює шум без відкидання потенційно реальних секретів; allowlist у `.trufflehog-exclude` замінює `.gitleaks.toml` через `--exclude-paths`.

Chosen option: "Перенести до `template/` + Rego policy з `required: true`", because це приводить `security` у відповідність із патерном інших rules; Rego policy `security.lint_security_yml` перевіряє наявність та вміст workflow.

Chosen option: "Додати вимогу template-first до `scripts.mdc`", because це закріплює наявний патерн (`php`, `style-lint`, `js-lint`) як нормативну вимогу, а не лише конвенцію.

### Consequences

* Good, because `npx @nitra/cursor check security` перевіряє `lint_security_yml: 1 файл(ів) OK (rego)` разом із `package_json` і `trufflehog` concerns.
* Good, because канонічна команда явно виражає всі три операційних рішення: scope (`filesystem`), filter (`--results`), config (`--exclude-paths`).
* Good, because режим `filesystem` не залежить від git-індексу і покриває untracked-файли.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information

Видалено: `npm/rules/security/fix/gitleaks/`, `npm/rules/security/policy/gitleaks/`, `.gitleaks.toml`.

Додано:
- `npm/rules/security/fix/trufflehog/check.mjs`, `check.test.mjs`, `template/.trufflehog-exclude.snippet.txt`
- `.trufflehog-exclude` (корінь репо)
- `npm/rules/security/policy/lint_security_yml/target.json` (`"required": true`), `lint_security_yml.rego`, `lint_security_yml_test.rego`, `template/lint-security.yml.snippet.yml`
- `.github/workflows/lint-security.yml` (у репозиторії cursor)

Оновлено:
- `npm/rules/security/policy/package_json/template/package.json.snippet.json` — канон `lint-security` скрипту
- `npm/rules/security/policy/package_json/template/package.json.deny.json` — deny для `gitleaks` у deps
- `npm/rules/security/security.mdc` — bump `1.1` → `2.0`; inline YAML → template-link
- `.cursor/rules/n-security.mdc` — пересинхронізовано
- `.cursor/rules/scripts.mdc` — додано секцію template-first, bump `1.5` → `1.6`
- `package.json` (корінь) — `scripts.lint-security` оновлено
- `npm/package.json` — bump `1.13.25` → `1.13.26`

Контекст template-first: узгоджується з «Rego-first» у `conftest.mdc` — спершу перевір `template/` перед додаванням literal у JS чи `.mdc`.

## Update 2026-05-17

### Канонічний workflow lint-security.yml перенесено до `policy/lint_security_yml/` з Rego-enforcement

Workflow YAML для `.github/workflows/lint-security.yml` був прописаний як inline fenced block у `security.mdc`. Усі інші rules зберігають workflow-канон у `policy/<concern>/template/<name>.yml.snippet.yml` і валідують реальний файл через Rego policy; `security` rule був винятком без пояснення.

Chosen option: "Перенести у `policy/lint_security_yml/` з Rego-enforcement", because користувач явно обрав варіант «Перенести + Rego полісі (повний canon)», щоб бути послідовним з іншими rules.

- Good, because `conftest verify` проходить для нового policy; `npx @nitra/cursor check security` — чистий.
- Bad, because `.github/workflows/lint-security.yml` у репо `cursor` відсутній — Rego-check на наявність workflow не активний до додавання цього файлу.

Створені файли: `npm/rules/security/policy/lint_security_yml/target.json` (`{ "files": { "single": ".github/workflows/lint-security.yml" } }`), `lint_security_yml.rego`, `lint_security_yml_test.rego`, `template/lint-security.yml.snippet.yml` (канон workflow: trigger на `push`/`pull_request` до `dev`/`main`, `concurrency`, job `security` з `trufflehog/actions@main`). `npm/scripts/utils/inline-template-links.test.mjs` оновлено: «4 template links» → «5 template links».
