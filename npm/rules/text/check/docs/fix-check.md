---
type: JS Module
title: fix-check.mjs
resource: npm/rules/text/check/fix-check.mjs
docgen:
  crc: 66cdaaec
---

## Огляд

T0-autofix для `text/check`: авто-fix кроки тулчейну, що їх read-only детектор не виконує.
Наразі — `markdownlint --fix` для *.md/*.mdc (markdownlint-cli2 у fix-режимі). Інші під-тули
text/check само-фіксяться у власних детекторах (dotenv-linter, shellcheck) або не мають
fix-режиму (cspell, v8r). Запис незворотний (поза rollback).

## Поведінка

- Перелічує tracked *.md/*.mdc через git, форматує їх `markdownlint --fix`.
- До списку змінених потрапляють лише файли з фактичною зміною.

## Публічний API

- `patterns` — масив T0-патернів; `text-markdownlint-fix` спрацьовує на порушенні з reason `markdownlint`.

## Гарантії поведінки

- Записуються лише фактично змінені файли; кожен реєструється через `recordWrite`.
