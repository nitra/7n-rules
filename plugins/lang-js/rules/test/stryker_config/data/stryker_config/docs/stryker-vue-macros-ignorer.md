---
type: JS Module
title: stryker-vue-macros-ignorer.mjs
resource: plugins/lang-js/rules/test/stryker_config/data/stryker_config/stryker-vue-macros-ignorer.mjs
docgen:
  crc: 30a5e9f9
  model: omlx/gemma-4-e4b-it-OptiQ-4bit
  tier: local-min
  score: 100
  issues: judge:inaccurate:0.97
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Конфігурує механізм Stryker для ігнорування мутацій, які виникають при викликах макросів Vue (`defineProps`, `defineEmits`, `defineModel`, `defineSlots`, `defineExpose`, `defineOptions`) у середовищі `<script setup>`. Це запобігає падінню `@vue/compiler-sfc`, оскільки мутатори стандартного плагіна Stryker обгортають аргументи макросів у тернарний coverage-вираз, що порушує статичний аналіз. Механізм реалізується шляхом реєстрації плагіна у `strykerPlugins: Plugin[]` у `plugin-loader.js` та активації ігнорування за ім'ям `'vue-macros'` у `stryker.config.mjs`.

## Поведінка

Поведінка:
shouldIgnore: Позначає виклик макроса Vue `<script setup>` як ігнорований для мутації Stryker.
strykerPlugins: Визначає набір плагінів для Stryker, включаючи ігнорувальник для макросів Vue.

## Публічний API

shouldIgnore — Встановлює, які мутації викликів Vue `<script setup>`-макросів (`defineProps`, `defineEmits`, `defineModel`, `defineSlots`, `defineExpose`, `defineOptions`) мають бути пропущені аналізом Stryker.
strykerPlugins — Забезпечує механізм експорту плагінів (`Plugin[]`) для доповнення процесу сканування коду.

## Гарантії поведінки

- Read-only: не виконує операцій запису (ФС/БД).
