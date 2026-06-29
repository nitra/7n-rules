---
type: JS Module
title: main.mjs
resource: npm/rules/vue/packages/main.mjs
docgen:
  crc: 57dfbf32
  model: omlx/gemma-4-e4b-it-OptiQ-4bit
  tier: local-min
  score: 100
  issues: judge:inaccurate:0.98
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Модуль визначає, чи є поточний пакет бібліотекою компонентів Vue, та проводить валідацію проєкту на відповідність стандартам, визначеним у `vue.mdc`, враховуючи конфігураційні файли `package-lock.json`, `jsconfig.json`, `package.json`, `extensions.json`.

isVueComponentLibraryPkg визначає, чи є пакет бібліотекою компонентів Vue, аналізуючи його залежності.
main перевіряє відповідність проєкту правилам vue.mdc для пакетів з Vue, включаючи перевірки конфігурації Vite, імпортів, `esbuild` та рекомендації IDE. Логіка роботи не викликає винятків назовні (fail-safe), ігноруючи каталоги `.git` та `node_modules`. (vue.mdc)

## Поведінка

Поведінка
isVueComponentLibraryPkg визначає, чи є пакет бібліотекою компонентів Vue, аналізуючи його залежності.
main перевіряє відповідність проєкту правилам vue.mdc для пакетів з Vue, включаючи перевірки конфігурації Vite, імпортів, `esbuild` та рекомендації IDE. При цьому ігноруються каталоги `.git` та `node_modules`, а також файли локів `package-lock.json`, `bun.lock` тощо.

## Публічний API

isVueComponentLibraryPkg — визначає, чи повинен проект розглядатися як бібліотека компонентів Vue, що впливає на правила імпорту в IDE.
main — гарантує, що всі компоненти у робочому просторі коректно декларують залежність від Vue відповідно до стандартів.

## Гарантії поведінки

- Read-only: не виконує операцій запису (ФС/БД).
- Перехоплює помилки і не пропускає винятків назовні (fail-safe).
- Свідомо пропускає шляхи: `.git`, `node_modules`.
