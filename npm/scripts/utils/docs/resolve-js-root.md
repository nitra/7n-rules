---
type: JS Module
title: resolve-js-root.mjs
resource: npm/scripts/utils/resolve-js-root.mjs
docgen:
  crc: 99e5a8a4
  model: omlx/gemma-4-e4b-it-OptiQ-4bit
  score: 100
---

## Огляд

Визначає корінь JS-коду для проєктів, використовуючи `package.json` та `.n-cursor.json` як конфігураційні файли. Функція `resolveJsRoot` знаходить перший workspace (з підтримкою glob-патернів типу `cf/*`) для workspace-проєктів або корінь поточної директорії для single-package. Функція `resolveAllJsRoots` знаходить усі відповідні шляхи. Код свідомо ігнорує шляхи `.git` та `node_modules`. Ця утиліта є спільною для coverage-провайдера JS та test-концерну stryker_config (DRY).

## Поведінка

resolveJsRoot повертає абсолютний шлях до першого JS-кореня проєкту, якщо він існує, або null, якщо кореневий package.json відсутній.
resolveAllJsRoots повертає масив абсолютних шляхів до всіх JS-коренів проєкту, враховуючи визначення `workspaces` у кореневому package.json, ігноруючи каталоги `.git` та `node_modules`.

## Публічний API

resolveJsRoot — знаходить кореневий каталог JavaScript-проєкту.
resolveAllJsRoots — повертає шляхи до коренів усіх JavaScript-проєктів у робочому просторі.

## Гарантії поведінки

- Read-only: не виконує операцій запису (ФС/БД).
- Свідомо пропускає шляхи: `.git`, `node_modules`.
