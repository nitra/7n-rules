---
type: JS Module
title: fix-cargo_mutants_config.mjs
resource: npm/rules/tauri/cargo_mutants_config/fix-cargo_mutants_config.mjs
docgen:
  crc: b97bd617
  model: omlx/gemma-4-e4b-it-OptiQ-4bit
  tier: local-min
  score: 70
---

## Поведінка

Виявлення необхідності модифікації файлу відбувається через `patterns`, що перевіряє наявність `MUTANTS_CONFIG_MISSING` або `MUTANTS_KEYS_MISSING`. При спрацюванні `patterns`, `findSrcTauriDirs` сканує каталог від `ctx.cwd` для пошуку всіх кореневих каталогів з `src-tauri/`. Для кожного знайденого каталогу `findSrcTauriDirs` викликається `detectMissingKeys` для визначення відсутніх канонічних ключів, порівнюючи вміст з `TAURI_CANONICAL_KEYS`. Якщо файл присутній, але відсутні ключі, `detectMissingKeys` надає список, який передається в `buildAppended` разом з існуючим вмістом файлу, щоб додати потрібні фрагменти з `TAURI_KEY_SNIPPETS`. Результати модифікації записуються у файл.

## Гарантії поведінки

- (специфічних машинно-виведених гарантій немає)
