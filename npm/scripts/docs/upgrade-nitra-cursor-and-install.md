---
type: JS Module
title: upgrade-nitra-cursor-and-install.mjs
resource: npm/scripts/upgrade-nitra-cursor-and-install.mjs
docgen:
  crc: b0742ab3
---

Файл автоматично синхронізує правила командного інтерфейсу (CLI) з останньою версією `@nitra/cursor` з npm registry. Це забезпечує, що локальна версія `@nitra/cursor` завжди актуальна, а також інсталює необхідні залежності за допомогою `bun i`. Він використовується для підтримки узгодженості між локальним проєктом та офіційним репозиторієм npm.

## Поведінка

shouldSkipNpmVersionUpgrade: Визначає, чи потрібно оновлювати версію залежності з npm, враховуючи специфікатор залежності та різні типи специфікаторів (workspace, file, link тощо).
fetchLatestNitraCursorVersionFromNpm: Отримує останню версію пакета `@nitra/cursor` з npm registry та повертає її як рядок.
resolveInstalledPackageRoot: Повертає шлях до каталогу `node_modules/@nitra/cursor` якщо залежність встановлена, інакше повертає шлях до кореня пакету поточного процесу CLI (кеш npx).
upgradeNitraCursorToLatestAndBunInstall: Оновлює версію `@nitra/cursor` у `package.json` до останньої з npm, запускає `bun i` та повертає шлях до каталогу `node_modules/@nitra/cursor`.

## Публічний API

- shouldSkipNpmVersionUpgrade — Перевіряє можливість оминання оновлення версії npm.
- fetchLatestNitraCursorVersionFromNpm — Отримує останню версію пакета `@nitra/cursor` з npm.
- resolveInstalledPackageRoot — Знаходить шлях до встановленого пакета.
- upgradeNitraCursorToLatestAndBunInstall — Оновлює `@nitra/cursor` до останньої версії та встановлює Bun.

## Гарантії поведінки

- Якщо наявна залежність через `workspace:`, `file:`, `link:` – не змінює версію в npm registry та не запускає `bun i`.
- Запускає `bun i` у корені проєкту після підтягування останньої версії `@nitra/cursor` з npm registry.
- Повертає шлях до `node_modules/@nitra/cursor`, якщо каталог існує.
- В іншому випадку повертає шлях до кореня пакету поточного процесу CLI (наприклад, кеш npx).
- Не кидає винятки.
- У разі невдачі повертає `false` або `null`.
- Не використовує кешування.
