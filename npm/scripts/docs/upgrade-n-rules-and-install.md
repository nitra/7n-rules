---
type: JS Module
title: upgrade-n-rules-and-install.mjs
resource: npm/scripts/upgrade-n-rules-and-install.mjs
docgen:
  crc: f33841b9
  model: omlx/gemma-4-e4b-it-OptiQ-4bit
  score: 100
  issues: judge:inaccurate:0.98
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Примусове підтягування останньої опублікованої версії інструменту `@7n/rules` з npm registry за адресою https://registry.npmjs.org/@7n/rules/latest для забезпечення коректної роботи системи. Якщо залежність вже визначена в `package.json` через механізми `workspace:`, `file:`, або `link:`, зміна в registry не відбувається і `bun i` не викликається, що зберігає конфігурацію монорепозиторію. Після встановлення виводом повертається шлях до `node_modules/@7n/rules`, якщо каталог з `package.json` існує, або резервний шлях до коріння поточного процесу CLI.

## Поведінка

Поведінка:
shouldSkipNpmVersionUpgrade визначає, чи слід ігнорувати оновлення версії з npm для залежності, перевіряючи специфікатори, які вказують на локальні або не-npm джерела.
fetchLatestNRulesVersionFromNpm отримує останню версію пакета `@7n/rules` з URL https://registry.npmjs.org/@7n/rules/latest, аналізуючи вміст res.json.
resolveInstalledPackageRoot повертає шлях до каталогу `@7n/rules` у `node_modules` або шлях пакета з поточного процесу, якщо перший не знайдений.
upgradeNRulesToLatestAndBunInstall оновлює залежність `@7n/rules` у `package.json` до останньої версії з npm, виконує `bun i` у корені проєкту, а потім повертає шлях до встановленого пакета. При цьому процес свідомо не перевіряє каталоги `node_modules`.

## Публічний API

shouldSkipNpmVersionUpgrade — Визначає, чи можна замінити поточний специфікатор версії залежності на стандарт `semver` з npm, зберігаючи безпеку.
fetchLatestNRulesVersionFromNpm — Отримує актуальну версію пакета `@7n/rules` з реєстру npm (через поле `version` у JSON dist-tag `latest`), що доступно на https://registry.npmjs.org/@7n/rules/latest.
resolveInstalledPackageRoot — Знаходить абсолютний шлях до встановленого пакета у директорії `node_modules`, або надає резервний шлях.
upgradeNRulesToLatestAndBunInstall — Оновлює `@7n/rules` до останньої версії з npm (якщо це дозволено конфігурацією), виконує встановлення залежностей за допомогою `bun i`, і повертає корінь пакета для подальшої синхронізації конфігураційних файлів, таких як `mdc/`.

## Гарантії поведінки

- Свідомо пропускає шляхи: `node_modules`.

**Міграція перейменування:** `migrateLegacyDependencyName` переносить legacy-ключ `@nitra/cursor` → `@7n/rules` у тій самій секції package.json перед оновленням версії; якщо registry ще не має `@7n/rules` (404 до першої публікації), версія береться з package.json пакету поточного процесу (fallback).

**packageName:** `resolveInstalledPackageRoot(projectRoot, fallbackPackageRoot, packageName)` — третій параметр (дефолт `@7n/rules`) дозволяє резолвити встановлені плагіни.
