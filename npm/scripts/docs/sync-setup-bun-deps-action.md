---
type: JS Module
title: sync-setup-bun-deps-action.mjs
resource: npm/scripts/sync-setup-bun-deps-action.mjs
docgen:
  crc: 327991b2
  model: omlx/gemma-4-e4b-it-OptiQ-4bit
  score: 100
---

## Огляд

Копіює composite GitHub Action `setup-bun-deps` з каталогу `github-actions/setup-bun-deps/` у цільовий репозиторій (`.github/actions/setup-bun-deps/`). Це забезпечує можливість робочим процесам з правил `ga`, `js` та `text` викликати локально розміщений action (`uses: ./.github/actions/setup-bun-deps`) одразу після виконання `actions/checkout@v6`, використовуючи CLI `npx \@nitra/cursor`.

## Поведінка

1. Перевіряє наявність шаблону composite action у корені встановленого пакету `@nitra/cursor`.
2. Створює необхідну директорію для composite action у корені цільового репозиторію, ігноруючи шляхи `.github` та `.git`.
3. Зчитує вміст шаблону composite action.
4. Записує вміст шаблону у цільовий шлях composite action у корені цільового репозиторію, гарантуючи наявність завершального символу нового рядка.
5. Повертає підтвердження успішного запису та повний шлях до файлу.

## Публічний API

syncSetupBunDepsAction — фіксує в `projectRoot` композитну дію з коренем встановленого `@nitra/cursor`.

## Гарантії поведінки

- Свідомо пропускає шляхи: `.github`, `.git`.
