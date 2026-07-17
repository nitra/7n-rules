---
type: JS Module
title: uv-diff.mjs
resource: npm/skills/taze/js/uv-diff.mjs
docgen:
  crc: a23e68cc
  model: openai-codex/gpt-5.4-mini
  score: 100
  issues: judge:inaccurate:0.99
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Працює з залежностями `pyproject.toml` у форматах PEP 508 і PEP 440: `parsePep508` і `parsePep440Version` розбирають записи, `extractLowerBoundVersion` дістає нижню межу версії, `diffPyprojectDeps` і `collectUvDiff` порівнюють прямі залежності та формують diff відносно backup-версії, а `listDirectDependencies` повертає список прямих залежностей. Код read-only (лише читає файли з диска), fail-safe перехоплює помилки без винятків назовні та для частини збоїв повертає порожнє значення замість помилки.

## Поведінка

- `parsePep508` — розбирає рядок залежності у форматі PEP 508 на назву пакета, extras і version specifier; для невалідного рядка повертає порожній результат.
- `parsePep440Version` — витягує ядро версії PEP 440 і зводить відсутні компоненти до нулів; для не-версійного рядка повертає порожній результат.
- `extractLowerBoundVersion` — дістає нижню межу версійного specifier-а, тобто версію, яку відповідає нижньому bound у залежності; якщо межі немає, повертає порожній результат.
- `diffPyprojectDeps` — порівнює прямі залежності двох `pyproject.toml` за іменем пакета і класифікує зміну як major або minor/patch.
- `collectUvDiff` — збирає diff для `pyproject.toml` між поточним файлом і його backup-версією, а за відсутності потрібних файлів повертає порожній diff.
- `listDirectDependencies` — повертає список прямих залежностей із `pyproject.toml` у вигляді назв пакетів та extras.

## Публічний API

- parsePep508 — Розбирає один PEP 508-запис залежності на назву пакета, extras і version specifier.
- parsePep440Version — Виділяє основні компоненти PEP 440-версії; відсутні частини вважає нулями.
- extractLowerBoundVersion — Витягає найнижчу допустиму версію з набору `>=` / `==` / `~=`-обмежень.
- diffPyprojectDeps — Порівнює списки `[project].dependencies` у двох `pyproject.toml` за назвою пакета.
- collectUvDiff — Збирає різницю між поточним `pyproject.toml` і його backup-копією в `cwd`.
- listDirectDependencies — Повертає прямі залежності з `[project].dependencies` поточного `pyproject.toml` разом з extras.

Конфіги, на які спирається код: package.json

## Гарантії поведінки

- Read-only: не виконує операцій запису (ФС/БД).
- Перехоплює помилки і не пропускає винятків назовні (fail-safe).
- За певних помилок повертає порожнє значення (напр. `null`) замість винятку.
