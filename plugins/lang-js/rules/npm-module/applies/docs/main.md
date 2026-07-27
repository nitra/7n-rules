---
type: JS Module
title: main.mjs
resource: plugins/lang-js/rules/npm-module/applies/main.mjs
docgen:
  crc: 79f4b5a6
---

## Огляд

`applies` визначає, чи має `npm-module` застосовувати повний канон publishable npm package до поточного репозиторію.

## Поведінка

Правило активується для репозиторію з каталогом `npm/`, root workspace `npm` або GitHub workflow `npm-publish.yml`. Це зберігає перевірки структури, type emission, hk і publish pipeline для реального publisher-а.

Bun service monorepo без жодної з цих ознак повертає `false`. Його `package.json` і service workspaces не спричиняють вимогу створювати npm package.

Некоректний JSON у root `package.json` не активує правило; валідність маніфесту перевіряють відповідні інші concerns.

## Публічний API

- `applies(cwd)` — повертає, чи є в корені явна npm-publisher topology.
