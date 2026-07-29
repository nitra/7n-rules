---
type: JS Module
title: vue-forbidden-imports.mjs
resource: plugins/lang-js/rules/vue/lib/vue-forbidden-imports.mjs
docgen:
  crc: 3e8a448e
  model: omlx/gemma-4-e2b-it-4bit
  tier: local-min
  score: 80
---

## Огляд

Визначає явні імпорти з модуля `vue`, які суперечать vue.mdc (має працювати unplugin-auto-import),
а також заборонені імпорти Node-нативних модулів у `.vue` SFC (`node:*` префікс або bare ім’я
вбудованого модуля Node — `fs`, `path`, `timers/promises` тощо). Vue SFC виконується у браузері,
де Node API недоступне, тож такі імпорти ламають збірку/рантайм.

Аналіз import виконується через **oxc-parser** (`parseSync`, поле `module.staticImports`) — ESTree-сумісний
розбір без евристик по рядках. Дозволені лише side-effect `import 'vue'`, повністю type-only імпорти
та `import { type A, type B } from 'vue'` (перевірка `entries[].isType`).

Для `.vue` з шаблону витягуються лише теги `<script>` / `<script setup>` (регулярний вираз); далі той самий Oxc-парсинг
вмісту скрипта з віртуальним ім’ям `*.ts` для режиму TypeScript.

## Публічний API

- findForbiddenVueImportsInText — Знаходить заборонені static import з `vue` у вже підготовленому тексті (без `<template>`).
Використовує **oxc-parser**; при синтаксичних помилках повертає порожній масив (спочатку виправ синтаксис).
- shouldSkipFileForVueImportScan — Чи слід пропустити файл під час обходу пакета (генерація, типи).
- shouldSkipFileForVueAutoImportScan — Чи слід пропустити файл під час перевірки value-імпортів Vue, які має
підставляти unplugin-auto-import. Test-runner не застосовує Vite transform
до файлів тестів, тому їхні runtime-імпорти з `vue` мають лишатися явними.
- isVueImportScanSourceFile — Чи сканувати цей файл за розширенням.
- findForbiddenVueImportsInSourceFile — Знаходить порушення в одному файлі (з урахуванням .vue script extraction).
- isNodeBuiltinSpecifier — Чи є рядок-специфікатор імпортом вбудованого Node-модуля.
Покриває обидві форми: `node:fs`, `node:timers/promises` (явний префікс) і bare-ім’я
вбудованого модуля (`fs`, `path`, `crypto` тощо), включно з підшляхами (`fs/promises`).
- findForbiddenNodeImportsInText — Знаходить заборонені імпорти Node-нативних модулів у вмісті (без `<template>`).
Vue SFC виконується у браузері, тож будь-який Node API там недоступний — навіть type-only
імпорти збивають з пантелику (краще тримати такий код у server-side утілітах).
- findForbiddenNodeImportsInVueFile — Знаходить заборонені імпорти Node-нативних модулів у `.vue` SFC.
Сканує лише `<script>` блоки (template ігноруємо). Для не-`.vue` файлів повертає `[]` —
композаблі/утіліти на Node-side можуть бути в `.ts`/`.js`, а правило стосується SFC.

## Сценарії використання

- `plugins/lang-js/rules/vue/packages/tests/vue-forbidden-imports.test.mjs` (vue-forbidden-imports (oxc); vue-forbidden-imports — Node-native у .vue) — дозволені type-only / side-effect — без порушень; заборонені value-імпорти; findForbiddenVueImportsInText — multiline import; findForbiddenVueImportsInText — не реагує на vue-router; langFromPath tsx → знаходить порушення у .tsx (line 31); ще 13

## Гарантії поведінки

- Власних операцій запису (ФС/БД) у файлі немає; виклики імпортованих модулів можуть писати.
- Містить локальні fail-safe гілки; інші помилки можуть поширюватися назовні.
