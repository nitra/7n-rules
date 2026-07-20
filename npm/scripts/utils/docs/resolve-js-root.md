---
type: JS Module
title: resolve-js-root.mjs
resource: npm/scripts/utils/resolve-js-root.mjs
docgen:
  crc: 46c5af46
  model: omlx/gemma-4-e4b-it-OptiQ-4bit
  score: 100
---

Визначає корінь JS-коду в проєкті, відповідно до логіки для workspace-projects (перший workspace з підтримкою glob-патернів `cf/*`) або single-package (корінь cwd). Ця утиліта є спільною для coverage-провайдера JS та test-концерну `stryker_config` (DRY). Публічні функції дозволяють отримати один або повний список шляхів до всіх JS-коренів, при цьому свідомо виключаються каталоги `.git` та `node_modules`. Код спирається на конфігураційні файли `package.json` та `.n-rules.json`.

## Поведінка

resolveJsRoot повертає абсолютний шлях до першого JS-кореня проєкту. Якщо кореневий `package.json` відсутній, повертає null.
resolveAllJsRoots повертає масив абсолютних шляхів до всіх JS-коренів проєкту. Ігнорує каталоги `.git` та `node_modules`.

## Публічний API

resolveJsRoot — знаходить кореневий каталог JavaScript-проєкту.
resolveAllJsRoots — повертає всі каталоги JavaScript-проєктів у робочому просторі.

## Гарантії поведінки

- Read-only: не виконує операцій запису (ФС/БД).
- Свідомо пропускає шляхи: `.git`, `node_modules`.
