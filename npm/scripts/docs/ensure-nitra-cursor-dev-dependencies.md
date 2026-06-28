---
type: JS Module
title: ensure-nitra-cursor-dev-dependencies.mjs
resource: npm/scripts/ensure-nitra-cursor-dev-dependencies.mjs
docgen:
  crc: c3df2c0e
  model: omlx/gemma-4-e4b-it-OptiQ-4bit
  score: 100
  issues: judge:inaccurate:0.98
  retried: true
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Файл гарантує присутність інструменту `\@nitra/cursor` у кореневому `package.json` проєкту лише якщо проєкт ідентифікується як workspace-root за наявністю поля `workspaces` у `package.json` поруч із точкою запуску. Це робиться для забезпечення відтворюваності команд `npx \@nitra/cursor` та скриптів з `node_modules/\@nitra/cursor/scripts/` після виконання `bun install` / `npm install`.

readBundledPackageVersion надає версію пакета `\@nitra/cursor` з його власного `package.json`, або повертає `null`, якщо файл не знайдено або неможливо його розпарсити.

ensureNitraCursorInRootDevDependencies визначає кореневий `package.json` проєкту, якщо він є workspace-root, та, якщо `\@nitra/cursor` відсутній у `devDependencies` або `dependencies`, додає його до `devDependencies`, використовуючи версію, взяту з пакета `\@nitra/cursor`.

## Поведінка

readBundledPackageVersion повертає версію пакета `\@nitra/cursor` з його власного `package.json` або `null`, якщо файл не знайдено чи неможливо його розпарсити.
ensureNitraCursorInRootDevDependencies знаходить кореневий `package.json` проєкту, якщо він є workspace-root, і якщо `\@nitra/cursor` відсутній у `devDependencies` або `dependencies`, він дописує цей пакет у `devDependencies` із версією, взятою з пакета `\@nitra/cursor`.

## Публічний API

readBundledPackageVersion — Витягує версію пакета `@nitra/cursor` з `package.json` у корені репозиторію.
ensureNitraCursorInRootDevDependencies — Гарантує наявність пакета `@nitra/cursor` у залежностях (devDependencies або dependencies) кореневого `package.json`, додаючи його, якщо його немає. При цьому використовується версія, отримана з `package.json` пакета `@nitra/cursor` та опція `silent` при успішному внесенні змін.

## Гарантії поведінки

- Перехоплює помилки і не пропускає винятків назовні (fail-safe).
- За певних помилок повертає порожнє значення (напр. `null`) замість винятку.
