---
type: JS Module
title: fix-gitignore_target.mjs
resource: npm/rules/tauri/gitignore_target/fix-gitignore_target.mjs
docgen:
  crc: 0ceef709
  model: openai-codex/gpt-5.4-mini
  score: 100
  issues: judge:inaccurate:0.98
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

T0-autofix для `tauri/gitignore_target`: дописує в корінний `.gitignore` відсутні ignore-записи `<ws>/src-tauri/target/` у секцію з міткою `# Tauri — Rust build artifacts (tauri.mdc)` (константа `GITIGNORE_TARGET_HEADER`). `insertMissingTargetEntries` виконує сам текстовий splice; `patterns` — масив T0-визначень (`id`/`test`/`apply`) центрального fix-pipeline, що зчитує відсутні записи з `violation.data.missing` і застосовує `insertMissingTargetEntries` до файлів через `applyToFiles`.

## Поведінка

- `GITIGNORE_TARGET_HEADER` — мітка секції в корінному `.gitignore`, куди групуються записи для Tauri build artifacts.
- `insertMissingTargetEntries` — дописує відсутні ignore-записи для `<ws>/src-tauri/target/` у `.gitignore`: або в наявну секцію з `GITIGNORE_TARGET_HEADER` (поруч з іншими entries), або в новий блок у кінець файла; якщо нічого додавати не треба (`missingEntries` порожній), повертає `null` і вміст не змінюється.
- `patterns` — один T0-патерн (`tauri-gitignore-target-insert`): спрацьовує на violations з `data.kind === MISSING_GITIGNORE_TARGET_ENTRIES` і застосовує `insertMissingTargetEntries` до кожного цільового `.gitignore`.

## Публічний API

- GITIGNORE_TARGET_HEADER — заголовок секції в корінному `.gitignore` для Tauri build-артефактів.
- insertMissingTargetEntries — додає відсутні `"<ws>/src-tauri/target/"` у відповідну секцію `.gitignore` або створює новий блок наприкінці файла.
- patterns — T0-визначення autofix-у для detector-а `tauri/gitignore_target`, що підключається до центрального fix-pipeline.

## Гарантії поведінки

- (специфічних машинно-виведених гарантій немає)
