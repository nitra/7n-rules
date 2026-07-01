---
type: JS Module
title: fix-check.mjs
resource: npm/rules/text/check/fix-check.mjs
docgen:
  crc: 477227d1
---

## Огляд

T0-autofix для `text/check`: детерміновані авто-fix кроки тулчейну, що їх read-only детектор
не виконує — `markdownlint --fix` (*.md/*.mdc), `shellcheck -f diff | patch` (*.sh) і
`dotenv-linter fix` (.env*). cspell/v8r fix-режиму не мають. Запис незворотний (поза rollback).

## Поведінка

- **markdownlint**: tracked *.md/*.mdc (git) → markdownlint-cli2 у fix-режимі.
- **shellcheck**: *.sh → ітеративний `shellcheck -f diff` + `patch` (runShellcheckText, не-readOnly).
- **dotenv-linter**: .env* (fs-walk, бо часто git-ignored) → `dotenv-linter fix`.
- До списку змінених у кожному разі — лише файли з фактичною зміною (порівняння до/після).

## Публічний API

- `patterns` — три T0-патерни; кожен реагує лише на свій reason детектора
  (`markdownlint` / `shellcheck` / `dotenv-linter`).

## Гарантії поведінки

- Записуються лише фактично змінені файли; кожен реєструється через `recordWrite`.
- Відсутній тул (shellcheck/patch/dotenv-linter) → відповідна fix-функція завершується без змін.