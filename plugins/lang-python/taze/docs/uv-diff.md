---
type: JS Module
title: uv-diff.mjs
resource: plugins/lang-python/taze/uv-diff.mjs
docgen:
  crc: a2a76486
  model: openai-codex/gpt-5.4-mini
  tier: cloud-min
  score: 100
  issues: judge:inaccurate:0.99
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Порівнює прямі залежності `pyproject.toml` між станами репозиторію (поточний файл vs `.taze-bak`-бекап) через `diffPyprojectDeps`, `collectUvDiff` і `listDirectDependencies`; формати — PEP 508 (рядки залежностей) і PEP 440 (версії). Це потрібно, щоб виявляти зміни назв і версій пакетів у форматі, придатному для споживання, навіть коли частина даних недоступна або невалідна. Код працює fail-safe: перехоплює помилки, не кидає винятків назовні й у деяких випадках повертає порожнє значення замість помилки.

## Поведінка

Поведінка

- parsePep508 — розбирає PEP 508-запис залежності на імʼя, extras і версійний specifier; для невалідного рядка повертає null.
- parsePep440Version — витягає ядро версії PEP 440 як major, minor і patch; для не-версійного значення повертає null.
- extractLowerBoundVersion — дістає нижню межу версійного specifier-а; якщо нижню межу не знайдено, повертає null.
- diffPyprojectDeps — порівнює залежності двох pyproject.toml за іменами пакетів і класифікує зміни на major та minor/patch.
- collectUvDiff — збирає diff для pyproject.toml у корені репозиторію, порівнюючи його з backup-файлом з тим самим суфіксом; якщо один із файлів недоступний або невалідний, повертає порожній результат.
- listDirectDependencies — повертає список прямих залежностей із поточного pyproject.toml у зручному для подальшої обробки вигляді.

## Публічний API

- parsePep508 — Розбирає один PEP 508-рядок залежності на назву пакета, extras і version specifier.
- parsePep440Version — Витягує складники PEP 440-версії; відсутні частини доповнює нулями.
- extractLowerBoundVersion — Бере першу нижню межу з version specifier-а (`>=`, `==`, `~=`), яку використовує `uv add --bounds lower`.
- diffPyprojectDeps — Порівнює `dependencies` у двох `pyproject.toml` за іменем пакета, як `diffPackageJson`/`diffCargoToml`.
- collectUvDiff — Збирає різницю між `pyproject.toml` і його backup-файлом у тому ж робочому каталозі, як `collectTazeDiff`/`collectCargoDiff`.
- listDirectDependencies — Повертає прямі залежності з `dependencies` поточного `pyproject.toml` як список `{name, extras, raw}` для поетапного bump-циклу.

## Гарантії поведінки

- Read-only: не виконує операцій запису (ФС/БД).
- Перехоплює помилки і не пропускає винятків назовні (fail-safe).
- За певних помилок повертає порожнє значення (напр. `null`) замість винятку.
