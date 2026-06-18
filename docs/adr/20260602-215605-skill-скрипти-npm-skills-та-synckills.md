---
type: ADR
title: "Скіл-специфічні скрипти у `npm/skills/<id>/js/` та syncSkills top-level фільтр"
---

# Скіл-специфічні скрипти у `npm/skills/<id>/js/` та syncSkills top-level фільтр

**Status:** Accepted
**Date:** 2026-06-02

## Context and Problem Statement

Скіл `docgen` потребував CLI-scanner (`docgen-scan.mjs`), специфічного лише для нього. Постало питання: де розмістити скрипт — у `npm/scripts/` чи `npm/skills/docgen/js/`. Додатково: `syncSkills` починала передавати `readFile` на підкаталог `js/`, що кидало `EISDIR`.

## Considered Options

- `docgen-scan.mjs` у `npm/scripts/` (загальний каталог скриптів)
- `docgen-scan.mjs` у `npm/skills/docgen/js/` (каталог скіла)
- `syncSkills` копіює всі записи каталогу, включно з підкаталогами
- `syncSkills` копіює лише top-level файли

## Decision Outcome

Chosen option (розміщення): "`npm/skills/docgen/js/`", because `npm/scripts/` — крос-правильна інфраструктура; код одного скіла має жити поряд із ним, по аналогії з `npm/rules/<id>/js/`. Контракт зафіксований у `.cursor/rules/scripts.mdc`. Скіл-код публікується з пакетом (через `files: ["skills"]`) і виконується через `npx @nitra/cursor`.

Chosen option (syncSkills): "Копіювати лише top-level файли", because `js/` виконується з установленого пакета — передавати в споживача не потрібно, так само як `npm/rules/<id>/js/` не копіюється при синку правил.

### Consequences

- Good, because `npm/scripts/` залишається чистою крос-правильною інфраструктурою; `SKILL.md` і код скіла — в одному каталозі.
- Good, because у споживача копіюється лише `SKILL.md`; `js/` пропускається.
- Bad, because transcript не містить підтверджених негативних наслідків.

## More Information

Файли: `npm/skills/docgen/js/docgen-scan.mjs`, `npm/skills/docgen/js/tests/docgen-scan.test.mjs`. `npm/bin/n-cursor.js` функція `syncSkills`: `readdir(..., {withFileTypes: true})` + фільтр `entry.isFile()`. Правило: `.cursor/rules/scripts.mdc` рядок 57, рядок 120.
