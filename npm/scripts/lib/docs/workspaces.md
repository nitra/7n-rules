---
type: JS Module
title: workspaces.mjs
resource: npm/scripts/lib/workspaces.mjs
docgen:
  crc: 8382904f
---

Цей файл визначає список кореневих каталогів пакетів у монорепо, використовуючи конфігурацію `workspaces` з `package.json`. Він використовується скриптами перевірки монорепо для ідентифікації всіх проектів, які потрібно перевірити. Результат повертається для подальшого використання в процесах перевірки та аналізу.

## Поведінка

`isIgnoredWorkspaceRoot`: Перевіряє, чи слід ігнорувати каталог як корінь воркспейсу.
`normalizeWorkspacePattern`: Нормалізує воркспейс-патерн до POSIX-формату, видаляючи хвостові `/`.
`normalizeWorkspacePatterns`: Перетворює значення `workspaces` в масив воркспейс-патернів.
`getMonorepoPackageRootDirs`: Збирає список коренів пакетів воркспейсу з `package.json`.
`WORKSPACE_IGNORED_DIRS`: Ігноровані каталоги `node_modules`, `.git`, `.venv` та `venv`.

## Публічний API

- WORKSPACE_IGNORED_DIRS — Теки, ігноровані при розгортанні workspace-патернів із `*` (узгоджено з `rules/changelog/lib/package-manifest.mjs`).
- isIgnoredWorkspaceRoot — Визначає, чи слід виключити каталог з списку коренів workspace (не враховує `.`).
- normalizeWorkspacePatterns — Перетворює поле `workspaces` з `package.json` на масив шляхів або glob-шаблонів.
- getMonorepoPackageRootDirs — Повертає список кореневих каталогів пакетів, включаючи корінь репозиторію та всі пакети, визначені в `workspaces`.

## Гарантії поведінки

- Повертає порожній список каталогів, якщо не знайдено жодного `package.json` у кореневому каталозі або в каталогах, що входять до `WORKSPACE_IGNORED_DIRS`.
- Повертає `false` якщо не вдалося прочитати `package.json` у будь-якому з каталогів.
- Не включає в список каталог `node_modules`.
- Не включає в список каталог `.git`.
- Повертає лише кореневі каталоги пакетів монорепо, визначені в `package.json` файлах.
- Повертає відносну шляху до кореневого каталогу пакету.
- Не використовує кешування.
