---
session: 3e24d1f5-91f5-4ecb-8cd8-a93d4121e0a5
captured: 2026-05-17T20:51:29+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/3e24d1f5-91f5-4ecb-8cd8-a93d4121e0a5.jsonl
---

## ADR Заміна gitleaks на TruffleHog для secret scanning у security rule

## Context and Problem Statement
Правило `security` використовувало `gitleaks detect --no-banner --no-git` як канонічний `lint-security` скрипт. Користувач прийняв рішення замінити інструмент на TruffleHog, вибравши конкретний режим, фільтр верифікації і механізм allowlist.

## Considered Options
* TruffleHog у режимі `filesystem` з `--results=verified,unknown` та allowlist через `.trufflehog-exclude`
* TruffleHog у режимі `git` (аналог `gitleaks git`)
* Залишити gitleaks

## Decision Outcome
Chosen option: "TruffleHog filesystem з `--results=verified,unknown` та `.trufflehog-exclude`", because `filesystem` сканує робоче дерево без git-індексу (аналог попереднього `--no-git`); `--results=verified,unknown` відсіює шум без відкидання непідтверджених, але потенційно реальних секретів; allowlist у `.trufflehog-exclude` замінює `.gitleaks.toml` через `--exclude-paths`.

### Consequences
* Good, because канонічна команда `trufflehog filesystem . --no-update --exclude-paths .trufflehog-exclude --results=verified,unknown --fail` явно виражає всі три операційних рішення (scope, filter, config).
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- Видалено: `npm/rules/security/fix/gitleaks/`, `npm/rules/security/policy/gitleaks/`, `.gitleaks.toml`
- Додано: `npm/rules/security/fix/trufflehog/check.mjs`, `check.test.mjs`, `template/.trufflehog-exclude.snippet.txt`; `.trufflehog-exclude` у корені репо
- Оновлено: `npm/rules/security/policy/package_json/template/package.json.snippet.json`, `package.json.deny.json` (gitleaks → trufflehog), `package.json` кореня, `.cursor/rules/n-security.mdc`
- Реліз npm: `1.13.25` → `1.13.26`

---

## ADR Переміщення `.github/workflows/lint-security.yml` до `template/` з Rego policy та статус "обовʼязковий"

## Context and Problem Statement
Workflow `.github/workflows/lint-security.yml` у `security.mdc` був оголошений опційним і вбудований як inline YAML-фенс. Інші rules (`php`, `style-lint`, `js-lint`) тримають свої workflow-YAML у `policy/<concern>_yml/template/` з відповідною Rego policy. `security` був виключенням — Rego policy не існувало, enforcement відсутній.

## Considered Options
* Перенести до `template/` без Rego (doc-canon, без enforcement)
* Перенести до `template/` + Rego policy (повний canon, з enforcement) — обрано
* Залишити inline YAML як опційний

## Decision Outcome
Chosen option: "Перенести до `template/` + Rego policy з `required: true`", because це приводить `security` у відповідність із патерном інших rules; Rego policy `security.lint_security_yml` перевіряє наявність та вміст workflow; `required: true` у `target.json` робить файл обовʼязковим.

### Consequences
* Good, because `npx @nitra/cursor check security` тепер перевіряє `lint_security_yml: 1 файл(ів) OK (rego)` разом із `package_json` і `trufflehog` concerns.
* Good, because transcript фіксує очікувану користь: однорідність структури між усіма rules.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- Додано: `npm/rules/security/policy/lint_security_yml/target.json` (`"required": true`), `lint_security_yml.rego`, `lint_security_yml_test.rego`, `template/lint-security.yml.snippet.yml`
- Додано: `.github/workflows/lint-security.yml` у репо cursor
- Оновлено: `security.mdc` — секцію перейменовано з «опційно» на «CI workflow»; inline YAML замінено на template-link
- Оновлено: `npm/scripts/utils/inline-template-links.test.mjs` — лічильник template-links 4 → 5
- Patтерн-референс: `npm/rules/style-lint/policy/lint_style_yml/`

---

## ADR Вимога «template-first» у `scripts.mdc` для канонічних літералів

## Context and Problem Statement
До цієї сесії `scripts.mdc` описував структуру `npm/rules/` і роль `template/`, але не містив явної вимоги: якщо literal/фрагмент можна виразити через `template/`, він **повинен** бути там, а не вбудований у JS або inline у `.mdc`. Факт, що `lint-security.yml` вбудований inline у `security.mdc` на відміну від аналогічних rules, ілюструє, що без явної норми виникають виключення.

## Considered Options
* Додати вимогу до `scripts.mdc` (template-first canon)
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Додати вимогу до `scripts.mdc`", because це закріплює патерн, який вже застосований у `php`, `style-lint`, `js-lint` та інших rules, як нормативну вимогу, а не лише конвенцію.

### Consequences
* Good, because агент, що читає `scripts.mdc`, тепер отримує явну інструкцію перевіряти `template/` перед додаванням literal у JS чи `.mdc`.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- Оновлено: `.cursor/rules/scripts.mdc` — додано секцію/формулювання «template-first», bump `version: '1.5'` → `'1.6'`
- Контекст: вимога узгоджується з алгоритмом «Rego-first» у `conftest.mdc` (спершу перевір Rego; тут — спершу перевір `template/`)
