---
session: 9df5af85-ba57-41e3-9b88-4e31c33fdc38
captured: 2026-05-20T09:47:50+03:00
transcript: /Users/vitalii/.cursor/projects/Users-vitalii-www-nitra-cursor/agent-transcripts/9df5af85-ba57-41e3-9b88-4e31c33fdc38/9df5af85-ba57-41e3-9b88-4e31c33fdc38.jsonl
---

## ADR Обробка нових воркспейсів у перевірці changelog consistency

## Context and Problem Statement
`bun ./npm/bin/n-cursor.js check changelog` падала на `demo/`, бо `demo/package.json` відсутній на merge-base з `dev` (`Vbase === null`). Перевірка в `check.mjs` трактувала `Vbase === null` так само, як «version не змінено», і вимагала bump — попри те, що `demo/` є **новим** воркспейсом, для якого початкова `0.0.0` є єдиною допустимою version.

## Considered Options
* Вимагати bump для будь-якого воркспейсу зі змінами, незалежно від наявності на merge-base (попередня поведінка).
* Для нових воркспейсів (маніфест відсутній на merge-base) перевіряти лише наявність запису в CHANGELOG для поточної version без вимоги bump.

## Decision Outcome
Chosen option: "Для нових воркспейсів перевіряти тільки наявність CHANGELOG-запису без bump", because новий воркспейс не може мати попередньої version на merge-base, тому порівняння `Vbase === Vcurrent` для нього беззмістовне; достатньо підтвердити, що `CHANGELOG.md` містить запис для поточної version.

### Consequences
* Good, because `check changelog` проходить для `demo/` (`0.0.0`) без хибно-позитивного fail і не вимагає штучного bump нового воркспейсу.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- Змінені файли: `npm/rules/changelog/fix/consistency/check.mjs`, `npm/rules/changelog/fix/consistency/check.test.mjs`.
- Логіка у `check.mjs`: якщо `Vbase === null` → перевіряємо лише наявність CHANGELOG для `Vcurrent`; якщо `Vbase !== null && Vbase === Vcurrent` → fail (bump відсутній), як раніше.
- Додано тест `'feature-гілка: новий воркспейс з CHANGELOG для початкової version → pass без bump'` у `check.test.mjs`.
- Bump `npm` до `1.13.63` і запис у `npm/CHANGELOG.md` виконано в тій самій сесії.
- Команда верифікації: `bun ./npm/bin/n-cursor.js check changelog`.
