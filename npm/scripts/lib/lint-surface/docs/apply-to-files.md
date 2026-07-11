---
type: JS Module
title: apply-to-files.mjs
resource: npm/scripts/lib/lint-surface/apply-to-files.mjs
---

## Огляд

Спільний хелпер T0-фіксерів: застосовує текстовий трансформер до унікальних файлів із порушень і записує зміни. Винесений із дубльованих копій у `fix-toolchain_cache.mjs` (rust) та `fix-linux_deps.mjs` (tauri).

## Поведінка

- `applyToFiles(violations, ctx, transformer)` — збирає унікальні `violation.file` (falsy відкидає), для кожного читає файл відносно `ctx.cwd`; нечитабельний файл мовчки пропускає.
- Трансформер отримує вміст файлу й повертає новий текст або `null`; запис відбувається лише коли результат truthy і відрізняється від оригіналу.
- Перед записом викликає `ctx.recordWrite?.(abs)` — інтеграція з rollback-механізмом лінт-пайплайна.
- Повертає масив абсолютних шляхів реально змінених файлів.

## Публічний API

- `applyToFiles(violations, ctx, transformer)` — єдиний експорт.
