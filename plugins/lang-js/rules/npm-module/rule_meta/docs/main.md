---
type: JS Module
title: main.mjs
resource: plugins/lang-js/rules/npm-module/rule_meta/main.mjs
docgen:
  crc: c7424bda
  model: omlx/gemma-4-e4b-it-OptiQ-4bit
  score: 95
  issues: anchor-miss:(scripts.mdc),judge:inaccurate:0.98
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Lint-детектор concern-а `npm-module/rule_meta`: валідує метадані кожного правила у `npm/rules/<id>/` — файл `main.json` та супутні конвенції каталогу правила.

## Поведінка

1. Якщо `npm/rules/` відсутній — pass (немає правил для валідації).
2. Для кожної теки правила:
   - `auto.md` є пережитком — якщо файл лишився, порушення (метадані тепер у `main.json`).
   - `main.mdc` обовʼязковий (канон scripts.mdc) — відсутність = порушення.
   - `main.json` має існувати і бути валідним JSON-обʼєктом.
   - Поле `auto` (опційне) має відповідати одній з форм: `"завжди"` / масив / `{ glob }` / `{ predicate }`; предикат має бути зареєстрований у `RULE_PREDICATES`.
   - Поле `lint` заборонене: rule-level lint-scope скасовано (spec 2026-06-28-concern-lint-scope-design) — lint-поверхня декларується у `<rule>/<concern>/concern.json#lint`.
   - Поле `llmFix` заборонене: opt-in-прапорця немає — fix-можливість концерну визначається наявністю `fix-*.mjs`/`fix-worker.mjs`.
3. Повертає `LintResult` зі списком порушень; валідні правила репортяться як pass.

## Публічний API

lint — перевіряє `main.json` усіх правил у `npm/rules/` і повертає `{ violations }`.

## Гарантії поведінки

- Read-only: не виконує операцій запису (ФС/БД).
