---
type: JS Module
title: blue-oak.mjs
resource: npm/scripts/lib/blue-oak.mjs
docgen:
  crc: 9039e57f
  model: omlx/gemma-4-e4b-it-OptiQ-4bit
  score: 100
---

## Огляд

Модуль читає конфігурацію Blue Oak Council (`blue-oak.json`) для визначення дозволених рівнів SPDX. Він повертає множину SPDX-ідентифікаторів рівнів Model, Gold, Silver та Bronze. Модуль також генерує правила заборони ліцензій у форматі TOML та перевіряє відповідність будь-якого SPDX-ідентифікатора цьому списку.

## Поведінка

getBronzeAndAbove повертає множину SPDX-ідентифікаторів рівнів Model+Gold+Silver+Bronze, які беруться з конфігурації blue-oak.json.
generateDenyTomlLicenses генерує TOML-рядок для `deny.toml` (cargo-deny), дозволяючи лише SPDX-ідентифікатори, що знаходяться у множині Blue Oak Bronze+.
isSpdxAllowed перевіряє, чи відповідає наданий SPDX-вираз дозволеним ідентифікаторам, враховуючи логічні оператори `AND` та `OR`.

## Публічний API

getBronzeAndAbove — Визначає набір SPDX-ідентифікаторів (Model, Gold, Silver, Bronze), які вважаються безпечними для комерційного використання.
generateDenyTomlLicenses — Створює конфігураційний рядок TOML для файлу `deny.toml`, що забороняє використання ліцензій нижче рівня Blue Oak Bronze.
isSpdxAllowed — Визначає, чи відповідає заданий SPDX-ідентифікатор дозволеному списку Blue Oak Bronze+ згідно з логікою (одиночний ID, `A OR B`, `A AND B`).

## Гарантії поведінки

- Read-only: не виконує операцій запису (ФС/БД).
