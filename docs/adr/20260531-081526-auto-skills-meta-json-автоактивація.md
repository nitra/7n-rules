---
type: ADR
title: "Автоактивація скілів через поле `auto` у `meta.json`"
---

# Автоактивація скілів через поле `auto` у `meta.json`

**Status:** Accepted
**Date:** 2026-05-31

## Context and Problem Statement

Визначення, які скіли автоматично потрапляють у `.n-cursor.json` під час `n-cursor sync`, потребувало єдиного машинно-читаємого джерела правди. Захардкодована карта умов у CLI ускладнювала підтримку: додавання нового скіла з умовою автоактивації вимагало змін у двох місцях — у файлі скіла та в ядрі CLI. Паралельно скіли описували умови людинозрозумілим текстом, але без декларативного формату.

## Considered Options

* Поле `auto` у `npm/skills/<id>/meta.json` як єдине джерело правди
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome

Chosen option: "поле `auto` у `meta.json` кожного скіла", because кожен скіл сам декларує умову своєї автоактивації; `npm/scripts/auto-skills.mjs` читає ці файли й виконує логіку без hardcoded-мапи в CLI.

Підтримуються два режими поля `auto`:
- `"завжди"` — скіл активується завжди (наприклад, `fix/meta.json`: `{ "auto": "завжди", "worktree": true }`).
- Масив рядків — скіл активується лише якщо `.n-cursor.json` містить хоча б один із перелічених rule-id (наприклад, `adr-normalize/meta.json`: `{ "auto": ["adr"] }`, `taze/meta.json`: `{ "auto": ["bun"] }`).

### Consequences

* Good, because додавання нового скіла вимагає лише правки `meta.json` без зміни коду CLI — функції `detectAutoSkills` / `mergeConfigWithAutoDetected` у `npm/bin/n-cursor.js` читають метадані динамічно.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information

- `npm/scripts/auto-skills.mjs` — головний детектор умов `auto` для скілів.
- `npm/scripts/lib/skill-meta.mjs` — спільний парсер полів `meta.json` (`auto`, `worktree`).
- `npm/bin/n-cursor.js` — функції `detectAutoSkills`, `mergeConfigWithAutoDetected`.
- Аналогічний data-driven підхід для правил (Spec B): `docs/adr/20260531-080938-rules-meta-json-auto-glob-type-a.md`.
- Пов'язані clean ADR: `docs/adr/auto-skills-розщеплення-від-rules.md`, `docs/adr/auto-skills-читає-auto-md.md`.
