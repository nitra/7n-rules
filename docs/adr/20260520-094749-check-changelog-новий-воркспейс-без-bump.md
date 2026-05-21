# `check changelog`: новий воркспейс без merge-base не вимагає version bump

**Status:** Accepted
**Date:** 2026-05-20

## Context and Problem Statement

`demo/` з'явився як новий воркспейс на гілці `main` після точки розгалуження з `dev`. Оскільки `demo/package.json` на merge-base відсутній, функція `readBaseVersion` повертала `null`. Функція `checkLocalOnlyChangedWorkspace` у `check.mjs` трактувала `Vbase === null` ідентично до «version не змінено» і вимагала bump `0.0.0 → 0.0.1`, хоча воркспейс щойно створено і початкова `0.0.0` є коректною.

## Considered Options

* Вимагати bump навіть для нових воркспейсів — `Vbase === null` рівнозначний «version не змінено» (попередня поведінка)
* Для нових воркспейсів (`Vbase === null`) перевіряти лише наявність запису в `CHANGELOG.md` для поточної `version` без вимоги bump

## Decision Outcome

Chosen option: "Для нових воркспейсів перевіряти лише наявність CHANGELOG-запису без bump", because якщо маніфест відсутній на merge-base, воркспейс є новим і не має попередньої версії для порівняння; вимога bump `0.0.0 → 0.0.1` не має сенсу.

### Consequences

* Good, because `check changelog` проходить для `demo/` на `main` без хибно-позитивного fail: `✅ demo: новий воркспейс — перевіряємо CHANGELOG для 0.0.0`.
* Good, because існуючі записи в `CHANGELOG.md` не зачіпаються, штучний bump не потрібен.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information

* Змінені файли: `npm/rules/changelog/fix/consistency/check.mjs`, `npm/rules/changelog/fix/consistency/check.test.mjs`.
* Функція `checkLocalOnlyChangedWorkspace` у `check.mjs` — гілка `Vbase === null` тепер означає новий воркспейс: перевіряється лише наявність CHANGELOG-запису для `Vcurrent`.
* Новий тест: `'feature-гілка: новий воркспейс з CHANGELOG для початкової version → pass без bump'`.
* Команди верифікації: `bun test rules/changelog/fix/consistency/check.test.mjs` та `bun ./npm/bin/n-cursor.js check changelog`.
* Bump `npm` до `1.13.63`; запис у `npm/CHANGELOG.md` у версії `1.13.63`.

## Update 2026-05-20

Деталізація логіки `check.mjs`: якщо `Vbase === null` → перевіряємо лише наявність CHANGELOG для `Vcurrent`; якщо `Vbase !== null && Vbase === Vcurrent` → fail (bump відсутній), як раніше. Поведінка для вже наявних воркспейсів із незміненою version не змінена.
