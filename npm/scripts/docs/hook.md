---
type: JS Module
title: hook.mjs
resource: npm/scripts/hook.mjs
docgen:
  crc: 602cd023
  model: claude-sonnet-4-6
  score: 100
---

Точка входу для хуків Claude Code. У режимі `--post-tool-use` зчитує `file_path` зі stdin JSON (PostToolUse hook), запускає lint для цього файлу та перевіряє актуальність файлової документації (`doc-files`). У режимі `--stop` визначає змінені файли (`git diff HEAD` + untracked) і запускає lint по всьому робочому дереву. Повертає exit-код у hook-протоколі (ненуль → 2).

## Поведінка

`runHookCli` виконує відповідну логіку залежно від переданого режиму:

- **`--post-tool-use`**: читає stdin JSON → витягує `tool_input.file_path` → запускає `runLint` для цього файлу (read-only, усі per-file правила включно з `doc-files`) → повертає 2 при порушеннях.
- **`--stop`**: визначає всі змінені файли через `collectChangedFiles` → запускає `runLint` (read-only) → повертає 2 при порушеннях.

Якщо `file_path` відсутній у stdin або stdin порожній — завершується з кодом 0 (нема що перевіряти).

## Публічний API

- `extractFilePath(json)` — витягує `tool_input.file_path` зі stdin JSON Claude Code PostToolUse hook; повертає `null` якщо JSON відсутній або поле не знайдено.
- `runHookCli(argv)` — CLI-точка входу для `n-cursor hook`; повертає Promise<number> (0 — чисто, 1 — невідомий режим, 2 — є порушення).

## Гарантії поведінки

- Read-only: не виконує операцій запису (ФС/БД).
- Не кидає винятків назовні: помилки stdin та parse-помилки повертають null/0.
