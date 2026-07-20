---
type: ADR
title: T0 changelog і mkdirSync у applyChanges для fix-конформності
description: Fix-конформність отримує детермінований T0-фікс для відсутніх change-файлів і створює батьківські теки перед записом LLM-патчів.
---

**Status:** Accepted
**Date:** 2026-06-19

## Context and Problem Statement

Аналітика escalation-логу показала два практичні провали fix-конформності: порушення changelog щодо відсутнього change-файлу проходило через LLM-драбину, хоча виправлення детерміноване, а `applyChanges` падав з `ENOENT`, коли LLM пропонував записати новий файл у неіснуючу теку.

## Considered Options

- Додати T0-патерн `changelog-create-change-file` у `t0.mjs` і викликати `mkdirSync(dirname(absPath), { recursive: true })` перед `writeFileSync` у `applyChanges`.
- Залишити changelog-violation на LLM-драбині й не створювати батьківські теки перед записом файлів.

## Decision Outcome

Chosen option: "Додати T0-патерн `changelog-create-change-file` і `mkdirSync` перед `writeFileSync`", because transcript фіксує, що changelog-violation однозначно визначає workspace для `writeChange`, а diagnosis cloud-рунгів виявив `ENOENT` через запис у неіснуючу теку.

### Consequences

- Good, because changelog-violation створює change-файл детерміновано до LLM-драбини й не витрачає cloud-avg.
- Good, because LLM-фікс може записувати нові файли у нових каталогах без `ENOENT`.
- Bad, because T0-патерн фіксує `bump: 'patch'` і `section: 'Changed'`, тоді як точний semver-рівень і секція можуть потребувати ручного уточнення.
- Neutral, because transcript не містить підтвердження інших наслідків.

## More Information

- `npm/scripts/lib/fix/t0.mjs` — патерн `changelog-create-change-file`, regex для повідомлення `❌ <ws>: є релевантні зміни, але немає change-файлу`, виклик `writeChange`.
- `npm/scripts/lib/fix/tests/t0.test.mjs` — тести T0-патерну.
- `npm/scripts/lib/fix/llm-fix-apply.mjs` — `mkdirSync(dirname(absPath), { recursive: true })` перед `writeFileSync`.
- `npm/rules/release/change.mjs` — джерело `writeChange`.
- Commit: `fac8f5b2`.
