---
type: JS Module
title: fix-lint.mjs
resource: npm/rules/style/lint/fix-lint.mjs
docgen:
  crc: 140458e8
---

## Огляд

T0-autofix для `style/lint`: детермінований прогін `stylelint --fix` по css/scss/vue-файлах.
Виправляє авто-fixable правила stylelint; решта лишається детектору на re-check, далі — LLM-ладдеру.
Запис незворотний (поза rollback).

## Поведінка

- Перелічує цільові файли: у дельта-режимі — зі списку змінених (лише css/scss/vue); у повному —
  tracked css/scss/vue через git.
- Застосовує `stylelint --fix` на них; до списку змінених потрапляють лише файли з фактичною зміною.

## Публічний API

- `patterns` — масив T0-патернів; єдиний `style-stylelint-fix` спрацьовує на агрегованому
  порушенні детектора (`stylelint-violation`).

## Гарантії поведінки

- Відсутній stylelint → no-op (без змін).
- Записуються лише фактично змінені файли; кожен реєструється через `recordWrite`.
