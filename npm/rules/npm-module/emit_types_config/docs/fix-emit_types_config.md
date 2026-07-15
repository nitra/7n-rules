---
type: JS Module
title: fix-emit_types_config.mjs
resource: npm/rules/npm-module/emit_types_config/fix-emit_types_config.mjs
docgen:
  crc: ada42c60
  model: openai-codex/gpt-5.4-mini
  score: 100
  issues: judge:inaccurate:0.99
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

`patterns` читає `tsconfig.emit-types.json` як базовий конфіг, щоб перевіряти й підтримувати узгодженість шаблонного правила для emit-types. Це read-only джерело поведінки: воно формує очікування для контракту конфіга без записів у ФС чи БД.

## Поведінка

1. `patterns` визначає набір правил для синхронізації шаблонного конфіга `tsconfig.emit-types.json` у `npm/tsconfig.emit-types.json`.
2. `patterns` слугує джерелом одного цільового виправлення для підтримки узгодженості між базовим конфігом і npm-варіантом.
3. `patterns` не виконує запис у файлову систему чи базу даних самостійно; воно лише описує, що саме має бути виправлено.

## Гарантії поведінки

- Read-only: не виконує операцій запису (ФС/БД).
