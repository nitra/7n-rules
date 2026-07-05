---
type: JS Module
title: collateral-veto.mjs
resource: npm/scripts/lib/lint-surface/collateral-veto.mjs
docgen:
  crc: 16d3ef02
---

## Огляд

Semantic-collateral veto для verdict-фази fix-pipeline (spec pi-fix-engine-migration §12, addendum 2026-07-05). Закриває клас collateral слабких локальних моделей: «виправляючи» правило, модель робить семантичну правку у сторонньому файлі, яка не порушує жодного правила й тому проходить canonical re-detect (кейс App.vue: хардкод версії з коментарем «we simulate it being available» замість виклику `getVersion`).

## Поведінка

1. `findCollateralEdits` порівнює список змінених наявних файлів rung-а (`snapshot.modifiedExisting()`) із target-set порушення (`violations[].file ∪ item.files`) і повертає правки поза target-set.
2. Нові файли до veto не входять — легітимний клас (scaffold, доки поряд із кодом); їх покриває re-check зачеплених файлів і rollback.
3. Порожній target-set (whole-repo концерни без `file` у violations) → veto незастосовний: свідомий fail-open, повертається порожній масив.
4. Усі шляхи realpath-нормалізуються (`realpathBestEffort`, той самий патерн, що у write-guard llm-lib) — знімає symlink-розбіжності macOS (`/tmp` → `/private/tmp`); caller relativize-ить результати від так само нормалізованого cwd.

## Публічний API

- `findCollateralEdits({ modifiedExisting, targetFiles, cwd })` — нормалізовані абсолютні шляхи відхилених правок; порожньо — collateral немає або target-set невідомий.
- `realpathBestEffort(p)` — realpath з найкращих зусиль (наявний файл → повний realpath; неіснуючий → realpath батьківської теки + basename; інакше — як є).

## Гарантії поведінки

- Read-only: не виконує операцій запису (ФС/БД).
- Ніколи не кидає: помилки realpath ігноруються з поверненням шляху як є.
