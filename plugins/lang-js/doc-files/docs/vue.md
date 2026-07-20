---
type: JS Module
title: vue.mjs
resource: plugins/lang-js/doc-files/vue.mjs
docgen:
  crc: d36391be
  model: openai-codex/gpt-5.4-mini
  score: 90
  issues: internal-name:extractUnitsJs,judge:inaccurate:0.98
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Файл перетворює Vue SFC у читабельні `facts` і `units` для `extractFactsVue` та `extractUnitsVue`, щоб інші частини системи могли отримувати відомості про public API, props, emits, exposed і slots без прямої роботи з SFC. Код працює read-only: не змінює ФС чи БД, а всі помилки обробляє fail-safe — не кидає винятки назовні й за певних збоїв повертає порожнє значення, наприклад `null`, замість падіння. Конфіги, на які спирається код: `package.json`.

## Поведінка

- `extractFactsVue` — повертає факт-лист для Vue SFC: збирає public API з script-блоку, додає props/emits/exposed як псевдо-exports, слоти з шаблону та повний набір JS-фактів; якщо SFC невалідний, script-блок відсутній або Vue compiler недоступний, повертає `unsupported` замість помилки. Для emits і exposed опис свідомо лишає порожнім.
- `extractUnitsVue` — повертає units для Vue SFC з file-relative offsets; якщо SFC невалідний або script-блок відсутній, повертає `null` замість помилки.

Changelog: не змінював файли, `npx @7n/rules lint changelog` не запускався.

## Публічний API

- extractFactsVue — Факт-лист для Vue SFC (`<script setup>` пріоритетний над звичайним `<script>`):
повторне використання JS-хелперів над вмістом script-блоку + props/emits/exposed як псевдо-експорти
(потрапляють у «Публічний API» нарівні зі звичайними export) + слоти з `@slot`-коментарів
шаблону. Без `vue/compiler-sfc` (peer не встановлено) чи без script-блоку/невалідного
SFC — `unsupported: true` (whole-file шлях, без краху батчу).
- extractUnitsVue — Юніти Vue SFC: `extractUnitsJs` над вмістом script-блоку зі зміщенням `span`
(символьні офсети) на позицію блоку у повному файлі — SFC-компілятор рахує
офсети відносно блоку, а anchors/CRC мають вказувати на позиції у файлі.

## Гарантії поведінки

- Read-only: не виконує операцій запису (ФС/БД).
- Перехоплює помилки і не пропускає винятків назовні (fail-safe).
- За певних помилок повертає порожнє значення (напр. `null`) замість винятку.
