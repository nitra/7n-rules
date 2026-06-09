---
session: 9679435d-2c63-4f06-b837-6faae249a257
captured: 2026-06-09T06:56:57+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/9679435d-2c63-4f06-b837-6faae249a257.jsonl
---

## ADR Уточнення тригера `npm-publish.yml` до `npm/.changes/**`

## Context and Problem Statement
Workflow `.github/workflows/npm-publish.yml` спрацьовував на будь-який push у `npm/**` — зміни README, типів, конфігів, скриптів. Реально публікація має сенс лише тоді, коли додано change-файл у `npm/.changes/`, бо `n-cursor release` без нього нічого не робить.

## Considered Options
* Залишити `npm/**` — широкий тригер, спрацьовує на будь-які зміни у workspace
* Звузити до `npm/.changes/**` — тригер лише на появу change-файлів

## Decision Outcome
Chosen option: "Звузити до `npm/.changes/**`", because change-файли є єдиним сигналом про наявність релізного контенту; без них `n-cursor release` все одно не виконує версійний bump.

### Consequences
* Good, because workflow не запускається на нерелізні зміни (типи, документація, конфіги), що зменшує даремні CI-runs.
* Good, because тригер узгоджується з pre-commit хуком, який блокує коміт без change-файлу.
* Bad, because якщо change-файл потрапить до репо без супутнього коду (теоретично можливо), workflow спрацює і `release` або впаде, або зробить порожній bump.

## More Information
Змінено два файли:
- `.cursor/rules/n-npm-module.mdc` — оновлено канонічний сніпет `on.push.paths` (Rego-перевірка порівнює workflow саме з ним)
- `.github/workflows/npm-publish.yml` — `paths: - 'npm/**'` → `paths: - 'npm/.changes/**'`

Change-файл: `.changes/260609-0656.md` (patch, розділ Changed).
