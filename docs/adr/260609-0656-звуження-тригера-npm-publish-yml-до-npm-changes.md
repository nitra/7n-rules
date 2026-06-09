---
session: 9679435d-2c63-4f06-b837-6faae249a257
captured: 2026-06-09T06:56:11+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/9679435d-2c63-4f06-b837-6faae249a257.jsonl
---

## ADR Звуження тригера `npm-publish.yml` до `npm/.changes/**`

## Context and Problem Statement
Workflow `.github/workflows/npm-publish.yml` спрацьовував на будь-який push у директорію `npm/**`, включаючи зміни документації, типів, конфігів — тобто push без change-файлів, по яких `n-cursor release` визначає, чи є що публікувати.

## Considered Options
* Залишити `npm/**` (поточний стан — широкий тригер)
* Замінити на `npm/.changes/**` — тригер лише по change-файлах

## Decision Outcome
Chosen option: "Замінити на `npm/.changes/**`", because релізний флоу повністю побудований навколо change-файлів у `npm/.changes/` — без них `n-cursor release` все одно не публікує нічого; вужчий тригер прибирає зайві запуски CI.

### Consequences
* Good, because CI не запускається на зміни в `npm/types/`, `npm/policy/`, документації та інших файлах, що не впливають на версію пакету.
* Bad, because якщо change-файл потрапить у репозиторій без супутнього коду (edge-case), workflow спрацює, але `n-cursor release` або впаде, або зробить порожній bump — transcript зазначає цей ризик як малоймовірний через `check changelog` у CI.

## More Information
Змінено три файли одночасно для підтримки консистентності:
- `.github/workflows/npm-publish.yml` — `paths: - 'npm/**'` → `paths: - 'npm/.changes/**'`
- `.cursor/rules/n-npm-module.mdc` (v1.14) — канонічний сніпет у розділі `## CI / .github/workflows/npm-publish.yml`
- `npm/check-npm-module.mjs` — функція `checkNpmPublishWorkflow`, рядок: `paths.includes('npm/**')` → `paths.includes('npm/.changes/**')` разом з відповідним повідомленням помилки
