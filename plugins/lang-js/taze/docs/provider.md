---
type: JS Module
title: provider.mjs
resource: plugins/lang-js/taze/provider.mjs
docgen:
  crc: 821a4e37
---

## Огляд

EcosystemProvider npm/bun для taze-оркестратора ядра (фаза 5a spec lang-plugins-extraction: ядро — двигун без мовної специфіки, JS-екосистема — такий самий плагін, як Rust/Python). Контракт `@7n/rules/plugin-api`, реєструється маніфестом `n-rules.contributes.handlers.taze`. Реекспортує `runTazeCli` для CLI `n-rules taze diff` ядра.

## Поведінка

- **buildDependencyPrompt** — промпт ОДНОГО ізольованого виклику раннера для одного major-запису (кроки 4-6 SKILL.md; без кроків 1-3/7/8 — їх виконує оркестратор).
- **backupWorkspacePackageFiles** / **cleanupWorkspaceBackups** — бекап і прибирання package.json кожного воркспейсу монорепо (`.taze-bak`).
- **jsProvider** — detect за кореневим package.json; available перевіряє bun; bump — `bunx taze -w -r latest` + `bun install` (провал кидає з exit-кодом і stderr); diff — `collectTazeDiff` з мапінгом workspace → manifest (контракт порту); cleanup — прибирання бекапів воркспейсів.

## Гарантії поведінки

- Виконує файлові операції (бекапи) і запускає зовнішні команди (`bunx`, `bun`) — НЕ read-only.
- Без кореневого package.json detect повертає порожньо — тиша у звіті.
