---
type: JS Module
title: sync-setup-bun-deps-action.mjs
resource: npm/scripts/sync-setup-bun-deps-action.mjs
docgen:
  crc: bbd996d1
  model: omlx/gemma-4-e4b-it-OptiQ-4bit
  score: 100
---

Копіює composite GitHub Action `setup-bun-deps` з каталогу `github-actions/setup-bun-deps/` у корені tarball пакету `@7n/rules` у цільовий репозиторій за шлях `.github/actions/setup-bun-deps/action.yml`. Це забезпечує можливість для workflow з правил `ga`, `js` або `text` викликати цей action для налаштування залежностей Bun одразу після виконання `actions/checkout@v6`.

## Поведінка

1. Перевіряє наявність шаблону composite action у корені встановленого пакету `@7n/rules`.
2. Створює необхідну директорію у корені цільового репозиторію для розміщення composite action.
3. Зчитує вміст шаблону composite action з кореня встановленого пакету.
4. Записує вміст шаблону composite action у цільовий шлях у корені репозиторію.
5. Повертає підтвердження успішного запису та повний шлях до файлу.
6. Не перевіряє шляхи `.github` чи `.git`.

## Публічний API

syncSetupBunDepsAction — фіксує у `projectRoot` композитну дію, що вказує на корінь встановленого `@7n/rules`.

## Гарантії поведінки

- Свідомо пропускає шляхи: `.github`, `.git`.
