---
type: ADR
title: Repo-context для file-less правил fix-escalation
description: Коли violation не містить шляхів, LLM prompt отримує git ls-files і package manifests замість no files identified.
---

**Status:** Accepted
**Date:** 2026-06-19

## Context and Problem Statement

Для структурних правил `doc-files`, `adr` і `npm-module` функція `extractFilePaths` повертала порожній масив, бо violation описує відсутні файли, а не наявні шляхи. Prompt містив `(no files identified)`, і хмарні моделі відповідали, що їм недостатньо контексту репозиторію, тому не могли сформувати патч.

## Considered Options

- `buildRepoContext` — підставляти `git ls-files` до 300 рядків і manifests `package.json` у `buildPrompt`, коли `files.length === 0`.
- Інші варіанти в transcript не обговорювалися.

## Decision Outcome

Chosen option: "`buildRepoContext` — generic fallback з деревом репо та manifests", because хмарні моделі прямо вказали на брак контексту як причину провалу, а дерево репо з manifests є мінімальним generic-контекстом без per-rule провайдерів.

### Consequences

- Good, because cloud-модель отримує контекст репозиторію для структурних правил, де violation не містить конкретних файлів.
- Good, because якщо `extractFilePaths` знаходить конкретні файли, поведінка prompt не змінюється.
- Bad, because transcript не містить підтверджених негативних наслідків.
- Neutral, because repo-context обмежений: `git ls-files` фільтрується і обрізається до 300 рядків, manifests — до 2000 символів кожен.

## More Information

- `npm/scripts/lib/fix/llm-worker.mjs` — `buildRepoContext(projectRoot)`: `git ls-files`, фільтр `/node_modules|\.git|\.lock/`, `slice(0, 300)`, додавання `package.json` і `npm/package.json`.
- `buildPrompt` отримує `repoContext`; якщо `files.length === 0` і `repoContext != null`, вставляє `<repo-context>` блок замість `(no files identified)`.
- `export { buildPrompt, buildRepoContext }` — для тестів.
- `npm/scripts/lib/fix/tests/llm-worker.test.mjs` — тести для `buildRepoContext` і `buildPrompt`.
- Changelog у transcript: `npm/.changes/260619-1736.md`.
