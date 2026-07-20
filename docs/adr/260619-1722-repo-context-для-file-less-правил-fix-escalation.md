---
type: ADR
title: Repo-context для file-less правил fix-escalation
description: Для правил без конкретних file paths LLM-промпт отримує git ls-files і package manifests замість `(no files identified)`.
---

**Status:** Accepted
**Date:** 2026-06-19

## Context and Problem Statement

Для структурних правил `doc-files`, `adr` і `npm-module` функція `extractFilePaths` могла повертати порожній масив, бо violation описує відсутні файли або структурний стан, а не конкретні наявні шляхи. У такому разі prompt містив `(no files identified)`, і хмарні моделі відповідали, що мають недостатньо контексту репозиторію.

## Considered Options

- Додати generic fallback `buildRepoContext`: `git ls-files` з обмеженням і маніфести `package.json`, коли `files.length === 0`.
- Інші варіанти в transcript не обговорювалися.

## Decision Outcome

Chosen option: "`buildRepoContext` як generic fallback", because transcript фіксує, що хмарні моделі прямо скаржились на брак контексту, а дерево репо з маніфестами дає мінімальний контекст без окремих per-rule provider-ів.

### Consequences

- Good, because cloud-модель отримує контекст репозиторію для file-less правил і може сформувати patch замість відповіді про нестачу контексту.
- Good, because якщо violation уже містить конкретні файли, поведінка prompt не змінюється.
- Bad, because transcript не містить підтверджених негативних наслідків; потенційне збільшення prompt size обмежене зрізом `git ls-files`.
- Neutral, because per-rule provider-и залишені як інкрементальне майбутнє розширення, а не частина цього рішення.

## More Information

- `npm/scripts/lib/fix/llm-worker.mjs` — `buildRepoContext(projectRoot)`: `git ls-files`, фільтр `node_modules`, `.git`, lock-файлів, `slice(0, 300)`, плюс `package.json` і `npm/package.json` до 2000 символів кожен.
- `buildPrompt` отримує repo context і вставляє `<repo-context>` блок, коли `files.length === 0`.
- `export { buildPrompt, buildRepoContext }` — доступно для тестів.
- `npm/scripts/lib/fix/tests/llm-worker.test.mjs` — тести `buildRepoContext` і `buildPrompt` з files/repoContext/feedback.
- Changelog: `npm/.changes/260619-1736.md`.
