---
type: JS Module
title: packages.mjs
resource: npm/rules/vue/js/packages.mjs
docgen:
  crc: 8589151d
  model: omlx/gemma-4-e4b-it-OptiQ-4bit
  score: 100
---

Модуль визначає, чи є пакет бібліотекою компонентів Vue, виходячи з даних у `package.json`, `jsconfig.json`, `package-lock.json`, `extensions.json`. Він також перевіряє відповідність усіх пакетів, що залежать від `vue`, критеріям, описаним у `vue.mdc`, і повертає код виходу.

## Поведінка

isVueComponentLibraryPkg визначає, чи є пакет бібліотекою компонентів Vue, перевіряючи наявність `vue` у `peerDependencies` його `package.json`.
check перевіряє відповідність проєкту правилам vue.mdc для всіх пакетів, що містять `vue` у `dependencies`, і повертає код виходу. При цьому ігноруються шляхи `.git` та `node_modules`.

## Публічний API

isVueComponentLibraryPkg — визначає, чи є пакет бібліотекою компонентів Vue, щоб IDE коректно обробляла файли `.vue` та `vite-env.d.ts`.
passFn — підтверджує наявність файлу `jsconfig.json` у вказаній директорії.
check — перевіряє, чи відповідає проєкт вимогам vue.mdc, а саме: чи є `vue` у залежностях кореневого та всіх workspace-пакетів.

## Гарантії поведінки

- Read-only: не виконує операцій запису (ФС/БД).
- Перехоплює помилки і не пропускає винятків назовні (fail-safe).
- Свідомо пропускає шляхи: `.git`, `node_modules`.
