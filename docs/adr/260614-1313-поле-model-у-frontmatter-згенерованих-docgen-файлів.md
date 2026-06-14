---
session: 8bd801e6-c1ea-4e77-887f-47d0a8dd4c9c
captured: 2026-06-14T13:13:40+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-cursor/8bd801e6-c1ea-4e77-887f-47d0a8dd4c9c.jsonl
---

## ADR Поле `model` у frontmatter згенерованих docgen-файлів

## Context and Problem Statement
Команда `fix-doc-files` / `fix-doc-files --stamp` штампує у frontmatter кожного md-файлу лише `source`, `crc`, і опційно `score`/`issues`. Яка LLM-модель фактично згенерувала документ — не зберігається ніде, окрім stdout-логів рантайму. Оскільки моделі (через `N_LOCAL_MIN_MODEL`, `N_CURSOR_DOCGEN_MODEL`, fallback `DEFAULT_OMLX_MODEL`) регулярно замінюються на новіші, неможливо ретроспективно визначити, яка модель стоїть за конкретним md-файлом.

## Considered Options
* Додати поле `model` до frontmatter через `buildDocFrontmatter` у `npm/rules/doc-files/js/docgen-crc.mjs`
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Додати поле `model` до frontmatter", because user мотивував потребу формулою «моделі також еволюціонують» — без цього поля неможливо дізнатися з готового md-файлу, яку модель використано, і вирішити, чи варто регенерувати документ після зміни моделі.

### Consequences
* Good, because transcript фіксує очікувану користь: з'явиться можливість ретроспективно ідентифікувати, якою LLM-моделлю згенеровано конкретний md-файл, і порівнювати якість між версіями моделей.
* Bad, because зміна сигнатури `buildDocFrontmatter`/`stampDoc` потребує оновлення викликів у `docgen-files-batch.mjs` та тестів у `npm/rules/doc-files/lint/tests/lint.test.mjs`; `--stamp`-режим (детерміноване перештампування без LLM) не матиме значення `model` і потребує явної угоди про поведінку (пропускати поле чи зберігати попереднє значення).

## More Information
- Поточний `buildDocFrontmatter`: `npm/rules/doc-files/js/docgen-crc.mjs:106` — поля `source`, `crc`, опційно `score`, `issues`.
- Результат генерації з `model` доступний у `result.model` у stdout рантайму `docgen-files-batch.mjs`, але не передається далі в `stampDoc`.
- `stampDoc` викликається з тестів: `npm/rules/doc-files/lint/tests/lint.test.mjs:23` — потребуватиме оновлення.
- Env-ланцюжок моделі: `N_CURSOR_DOCGEN_MODEL` → `resolveModel('min')` (`N_LOCAL_MIN_MODEL` → `N_LOCAL_AVG_MODEL` → `N_LOCAL_MAX_MODEL` → `N_CLOUD_MIN_MODEL`) → `omlx/${DEFAULT_OMLX_MODEL}` (`npm/lib/omlx.mjs:49`).
- На машині користувача на момент сесії: `~/.zshenv` → `N_LOCAL_MIN_MODEL=omlx/gemma-4-e4b-it-OptiQ-4bit` (щойно оновлено з `gemma-4-e2b-it-4bit`).
- Дизайн ще не реалізовано — сесія завершилась на стадії аналізу зачеплених місць.
