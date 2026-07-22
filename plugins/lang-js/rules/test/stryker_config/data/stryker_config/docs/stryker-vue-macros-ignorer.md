---
type: JS Module
title: stryker-vue-macros-ignorer.mjs
resource: plugins/lang-js/rules/test/stryker_config/data/stryker_config/stryker-vue-macros-ignorer.mjs
docgen:
  crc: bbfeea49
  model: openai-codex/gpt-5.4-mini
  tier: cloud-min
  score: 100
  issues: judge:error
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Окремий Stryker `Ignore`-плагін `vue-macros`, який пропускає мутації виклику Vue `<script setup>`-макросів `defineProps`, `defineEmits`, `defineModel`, `defineSlots`, `defineExpose` і `defineOptions`. Це потрібно, щоб Stryker не перетворював їхні аргументи на тернарний coverage-вираз на кшталт `stryMutAct_9fa48 ? {} : (stryCov_9fa48, {...})`, бо тоді `@vue/compiler-sfc` падає з помилкою `defineProps in <script setup> cannot reference locally declared variables`: ці макроси мають лишатися статично-аналізованими на етапі compile-sfc. Плагін експонує `shouldIgnore` і `strykerPlugins` у форматі, який очікує стандартний Stryker plugin-loader (`@stryker-mutator/core/.../plugin-loader.js`), а в `stryker.config.mjs` підключається через `plugins: ['./stryker-vue-macros-ignorer.mjs']` і вмикається через `ignorers: ['vue-macros']`.

## Поведінка

Реєстрація `strykerPlugins` віддає Stryker один `Ignore`-плагін з іменем `vue-macros`, а `shouldIgnore` є спільним правилом відсікання для цього плагіна: він пропускає лише виклики Vue `<script setup>`-макросів із переліку `defineProps`, `defineEmits`, `defineModel`, `defineSlots`, `defineExpose`, `defineOptions`, щоб Stryker не мутував аргументи, які `@vue/compiler-sfc` має бачити статично. Якщо вузол не є викликом, якщо викликається не ідентифікатор, або якщо ім’я не належить до цього набору, мутація не блокується. Відповідь `shouldIgnore` є сигналом для Stryker: непорожнє повідомлення означає пропуск піддерева, а відсутність відповіді — продовження мутації без спеціального винятку.

## Публічний API

- strykerPlugins — Реєстрація ignorer-плагіна `vue-macros` для Stryker plugin-loader (деталі — у header вище).
- shouldIgnore — визначає, чи слід пропустити шлях під час перевірки, зокрема для каталогів, тимчасових файлів і службових артефактів.

## Гарантії поведінки

- Власних операцій запису (ФС/БД) у файлі немає; виклики імпортованих модулів можуть писати.
