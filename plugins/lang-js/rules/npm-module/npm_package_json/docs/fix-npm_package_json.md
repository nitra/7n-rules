---
type: JS Module
title: fix-npm_package_json.mjs
resource: plugins/lang-js/rules/npm-module/npm_package_json/fix-npm_package_json.mjs
docgen:
  crc: 4c61a5ff
  model: openai-codex/gpt-5.4-mini
  score: 100
  issues: judge:inaccurate:0.96
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

`patterns` формує узгоджений набір правил для `package.json`, щоб проєктні package-файли лишалися в очікуваному стані за контрактом, який спирається на конфіг з `package.json`. Read-only: не пише у ФС чи БД.

## Поведінка

1. `patterns` визначає набір правил для вирівнювання `npm/package.json` з еталонним шаблоном.
2. Під час застосування кожне правило бере до уваги конфігурацію з `package.json` і використовує її як основу для корекції цільового файлу.
3. Мета `patterns` — забезпечити однакову структуру й очікуваний вміст `npm/package.json` у межах проєкту.
4. Значення `patterns` не виконує записів у файлову систему чи базу даних; воно лише описує, що і як має бути приведено до узгодженого стану.

## Гарантії поведінки

- Read-only: не виконує операцій запису (ФС/БД).
