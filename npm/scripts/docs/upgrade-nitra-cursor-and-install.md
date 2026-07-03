---
type: JS Module
title: upgrade-nitra-cursor-and-install.mjs
resource: npm/scripts/upgrade-nitra-cursor-and-install.mjs
docgen:
  crc: 5544ffc3
  model: omlx/gemma-4-e4b-it-OptiQ-4bit
  score: 100
  issues: judge:inaccurate:0.98
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Примусове підтягування останньої опублікованої версії інструменту `@nitra/cursor` з npm registry за адресою https://registry.npmjs.org/@nitra/cursor/latest для забезпечення коректної роботи системи. Якщо залежність вже визначена в `package.json` через механізми `workspace:`, `file:`, або `link:`, зміна в registry не відбувається і `bun i` не викликається, що зберігає конфігурацію монорепозиторію. Після встановлення виводом повертається шлях до `node_modules/@nitra/cursor`, якщо каталог з `package.json` існує, або резервний шлях до коріння поточного процесу CLI.

## Поведінка

Поведінка:
shouldSkipNpmVersionUpgrade визначає, чи слід ігнорувати оновлення версії з npm для залежності, перевіряючи специфікатори, які вказують на локальні або не-npm джерела.
fetchLatestNitraCursorVersionFromNpm отримує останню версію пакета `@nitra/cursor` з URL https://registry.npmjs.org/@nitra/cursor/latest, аналізуючи вміст res.json.
resolveInstalledPackageRoot повертає шлях до каталогу `@nitra/cursor` у `node_modules` або шлях пакета з поточного процесу, якщо перший не знайдений.
upgradeNitraCursorToLatestAndBunInstall оновлює залежність `@nitra/cursor` у `package.json` до останньої версії з npm, виконує `bun i` у корені проєкту, а потім повертає шлях до встановленого пакета. При цьому процес свідомо не перевіряє каталоги `node_modules`.

## Публічний API

shouldSkipNpmVersionUpgrade — Визначає, чи можна замінити поточний специфікатор версії залежності на стандарт `semver` з npm, зберігаючи безпеку.
fetchLatestNitraCursorVersionFromNpm — Отримує актуальну версію пакета `@nitra/cursor` з реєстру npm (через поле `version` у JSON dist-tag `latest`), що доступно на https://registry.npmjs.org/@nitra/cursor/latest.
resolveInstalledPackageRoot — Знаходить абсолютний шлях до встановленого пакета у директорії `node_modules`, або надає резервний шлях.
upgradeNitraCursorToLatestAndBunInstall — Оновлює `@nitra/cursor` до останньої версії з npm (якщо це дозволено конфігурацією), виконує встановлення залежностей за допомогою `bun i`, і повертає корінь пакета для подальшої синхронізації конфігураційних файлів, таких як `mdc/`.

## Гарантії поведінки

- Свідомо пропускає шляхи: `node_modules`.
