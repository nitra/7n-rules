---
type: JS Module
title: ensure-n-rules-dev-dependencies.mjs
resource: npm/scripts/ensure-n-rules-dev-dependencies.mjs
docgen:
  crc: 0b47c3b7
  model: hand
  score: 100
---

## Огляд

Файл гарантує присутність інструменту `@7n/rules` у кореневому `package.json` проєкту — лише якщо проєкт ідентифікується як workspace-root за наявністю поля `workspaces` у `package.json` поруч із точкою запуску. Це забезпечує відтворюваність команд `npx @7n/rules` і скриптів з `node_modules/@7n/rules/scripts/` після `bun install` / `npm install`.

Крім дописування відсутнього пакета, реалізовано **self-upgrade**: якщо `@7n/rules` уже присутній у `devDependencies` зі старішим числовим піном, він апгрейдиться до `^<версія встановленого CLI>` при кожному запуску. Це прибирає дрейф версії self-lint у споживачів.

## Поведінка

`readBundledPackageVersion` повертає версію пакета `@7n/rules` з його власного `package.json` або `null`, якщо файл не знайдено чи не вдалося розпарсити.

`ensureNRulesInRootDevDependencies` знаходить кореневий `package.json` (workspace-root) і:

- якщо `@7n/rules` **відсутній** у `devDependencies`/`dependencies` — дописує його в `devDependencies` як `^<bundledVersion>`;
- якщо вже **присутній у `devDependencies`** зі старішим числовим піном — апгрейдить пін до `^<bundledVersion>` (ніколи не понижує; нечислові піни `workspace:*`/`latest`/git не чіпаються);
- якщо присутній у `dependencies` (нестандартне розміщення) — лишає незмінним.

Порівняння версій — за числовими компонентами `major.minor.patch` (`parseVersionParts` розбирає діапазон із опційним оператором `^`/`~`/`>=`/`<=`/`>`/`<`/`=`/`v`; `isBundledNewer` порівнює покомпонентно).

## Публічний API

`readBundledPackageVersion` — витягує `version` пакета `@7n/rules` з його `package.json`, або `null`.
`ensureNRulesInRootDevDependencies(root, options?)` — гарантує актуальний пін `@7n/rules` у `devDependencies` кореневого `package.json`: додає за відсутності або апгрейдить старіший числовий пін. `options.bundledVersion` — версія для тестів; `options.silent` — не логувати. Повертає `true`, якщо `package.json` змінено на диску.

## Гарантії поведінки

- Перехоплює помилки читання/парсингу і не пропускає винятків назовні (fail-safe).
- За помилок повертає `false`/`null` замість винятку.
- Ніколи не понижує пін і не чіпає нечислові специфікатори версій.

**Міграція перейменування:** `migrateLegacyPackageKey` переносить legacy-ключ `@nitra/cursor` → `@7n/rules` у devDependencies/dependencies (пін зберігається) перед звичайною ensure/self-upgrade логікою.
