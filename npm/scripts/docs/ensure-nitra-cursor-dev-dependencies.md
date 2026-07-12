---
type: JS Module
title: ensure-nitra-cursor-dev-dependencies.mjs
resource: npm/scripts/ensure-nitra-cursor-dev-dependencies.mjs
docgen:
  crc: 423a90d5
  model: hand
  score: 100
---

## Огляд

Файл гарантує присутність інструменту `@nitra/cursor` у кореневому `package.json` проєкту — лише якщо проєкт ідентифікується як workspace-root за наявністю поля `workspaces` у `package.json` поруч із точкою запуску. Це забезпечує відтворюваність команд `npx @nitra/cursor` і скриптів з `node_modules/@nitra/cursor/scripts/` після `bun install` / `npm install`.

Крім дописування відсутнього пакета, реалізовано **self-upgrade**: якщо `@nitra/cursor` уже присутній у `devDependencies` зі старішим числовим піном, він апгрейдиться до `^<версія встановленого CLI>` при кожному запуску. Це прибирає дрейф версії self-lint у споживачів.

## Поведінка

`readBundledPackageVersion` повертає версію пакета `@nitra/cursor` з його власного `package.json` або `null`, якщо файл не знайдено чи не вдалося розпарсити.

`ensureNitraCursorInRootDevDependencies` знаходить кореневий `package.json` (workspace-root) і:

- якщо `@nitra/cursor` **відсутній** у `devDependencies`/`dependencies` — дописує його в `devDependencies` як `^<bundledVersion>`;
- якщо вже **присутній у `devDependencies`** зі старішим числовим піном — апгрейдить пін до `^<bundledVersion>` (ніколи не понижує; нечислові піни `workspace:*`/`latest`/git не чіпаються);
- якщо присутній у `dependencies` (нестандартне розміщення) — лишає незмінним.

Порівняння версій — за числовими компонентами `major.minor.patch` (`parseVersionParts` розбирає діапазон із опційним оператором `^`/`~`/`>=`/`<=`/`>`/`<`/`=`/`v`; `isBundledNewer` порівнює покомпонентно).

## Публічний API

`readBundledPackageVersion` — витягує `version` пакета `@nitra/cursor` з його `package.json`, або `null`.
`ensureNitraCursorInRootDevDependencies(root, options?)` — гарантує актуальний пін `@nitra/cursor` у `devDependencies` кореневого `package.json`: додає за відсутності або апгрейдить старіший числовий пін. `options.bundledVersion` — версія для тестів; `options.silent` — не логувати. Повертає `true`, якщо `package.json` змінено на диску.

## Гарантії поведінки

- Перехоплює помилки читання/парсингу і не пропускає винятків назовні (fail-safe).
- За помилок повертає `false`/`null` замість винятку.
- Ніколи не понижує пін і не чіпає нечислові специфікатори версій.
