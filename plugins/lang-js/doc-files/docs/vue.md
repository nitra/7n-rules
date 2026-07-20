---
type: JS Module
title: vue.mjs
resource: plugins/lang-js/doc-files/vue.mjs
docgen:
  crc: 8651a381
  model: openai-codex/gpt-5.4-mini
  tier: cloud-min
  score: 100
  issues: judge:inaccurate:0.98
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

`vueScriptBlock`, `extractFactsVue` і `extractUnitsVue` працюють із Vue SFC як з джерелом для подальшого витягування фактів і юнітів у координатах оригінального `.vue`. Вони підтримують fail-safe поведінку: перехоплюють помилки, не кидають винятків назовні та за окремих збоїв повертають порожнє значення, зокрема `null`, замість помилки.

## Поведінка

- `vueScriptBlock` — розбирає `.vue` як SFC і повертає `script setup` або `script` блок із дескриптором; якщо peer `vue` відсутній, SFC битий або script-блоку немає, повертає порожній результат замість помилки.
- `extractFactsVue` — формує факт-лист для Vue SFC на основі `script`-блоку: виділяє публічний контракт компонента через props, emits, expose і slots, а також додає JS-факти з `script`; якщо `vue` недоступний, SFC битий або script-блоку немає, повертає `unsupported`.
- `extractUnitsVue` — витягує JS/TS-юніти зі `script`-блоку Vue-файла і переносить їхні span-позиції в координати оригінального `.vue`; якщо `vue` недоступний, SFC битий або script-блоку немає, повертає порожній результат.

## Публічний API

- vueScriptBlock — Дістає script-блок із SFC, віддаючи пріоритет `<script setup>`, разом із дескриптором.
- extractFactsVue — Збирає публічний контракт Vue SFC: props, emits, expose і slots, а також повторно використовує JS-хелпери для header, imports і markers із тексту script-блоку; `<template>` і `<style>` у факти не потрапляють. Без peer `vue` або на битому SFC чи без script-блоку повертає `unsupported` у whole-file режимі, як до впровадження.
- extractUnitsVue — Будує JS-юніти з script-блоку `.vue` і зсуває span-и на позиції в оригінальному `.vue` файлі, щоб anchors і CRC вказували саме на вихідний SFC, а не на вирізаний фрагмент.

## Гарантії поведінки

- Read-only: не виконує операцій запису (ФС/БД).
- Перехоплює помилки і не пропускає винятків назовні (fail-safe).
- За певних помилок повертає порожнє значення (напр. `null`) замість винятку.
