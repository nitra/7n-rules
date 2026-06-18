---
type: JS Module
title: packages.mjs
resource: npm/rules/vue/js/packages.mjs
docgen:
  crc: 6119ae9c
  score: 85
---

isVueComponentLibraryPkg
Перевіряє, чи є пакет бібліотекою компонентів Vue шляхом перевірки `peerDependencies`.

check
Перевіряє залежності та конфігурацію vite.config одного Vue-пакета.

## Поведінка

isVueComponentLibraryPkg
Визначає, чи є пакет бібліотекою компонентів Vue через peerDependencies

check
Перевіряє залежності та vite.config одного Vue-пакета

## Публічний API

isVueComponentLibraryPkg — забезпечує, що `+` використовується для підхоплення `vite-env.d.ts` та `.vue`.
passFn — перевіряє наявність `prefixjsconfig.json`.
check — перевіряє, чи є `vue` у `peerDependencies` пакету бібліотеки. Якщо `vue` є залежністю, то правило авто-імпорту (заборона value-імпортів з `'vue'`) не застосовується до цієї бібліотеки, оскільки імпорти з `'vue'` повинні бути явними.

## Гарантії поведінки

- Read-only: файл не виконує операцій запису у файлову систему.
- За невдачі повертає значення помилки (`false`/`null`/`Err`) замість генерування винятку чи паніки.
- Свідомо пропускає шляхи: `.git`, `node_modules`.
- Не звертається до мережі.
