---
type: JS Module
title: provider.mjs
resource: plugins/lang-python/coverage-provider/provider.mjs
docgen:
  crc: f9364204
  model: openai-codex/gpt-5.4-mini
  tier: cloud-min
  score: 100
  issues: judge-refine:kept-original,judge:inaccurate:0.98
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

`defaultRunner` для Python-екосистеми збирає line coverage через `uv run pytest --cov` з `lcov`-звітом і окремо запускає мутаційне тестування через `mutmut 4.x`. Це потрібно, щоб дати узгоджене покриття коду за правилами `test` ядра `coverage` та незалежно оцінити стійкість тестів до survived-мутантів. Якщо `uv` недоступний, line coverage чесно пропускається з одноразовою підказкою; якщо в `pyproject.toml` немає `[tool.mutmut].source_paths`, мутаційний вимір пропускається з попередженням, а line coverage все одно збирається.

## Поведінка

1. `defaultRunner` виконує Python-перевірки для всього проєкту, обходячи всі знайдені Python-корені: корінь проєкту та перший рівень тек із `pyproject.toml` або `setup.py`.
2. Для кожного кореня збирається line coverage через `pytest-cov` у форматі lcov, а шляхи у звіті приводяться до відносних щодо `cwd`, щоб дані можна було об’єднувати на рівні всього репозиторію.
3. Якщо в середовищі немає `uv`, line coverage для такого кореня чесно пропускається з одноразовою підказкою; інші корені далі обробляються без зупинки всього процесу.
4. Паралельно перевіряється, чи доступне мутаційне тестування через `mutmut` 4.x. Якщо в корені немає секції `source_paths` у `[tool.mutmut]`, мутаційний вимір для цього кореня пропускається з попередженням, але line coverage все одно збирається.
5. Для коренів, де мутаційне тестування доступне, `defaultRunner` отримує зведення по survived-мутантах і групує їх за файлами, щоб показати, де тести не ловлять зміни.
6. Після обробки всіх коренів `defaultRunner` повертає узгоджене зведення по line coverage і mutation coverage без керування CLI й без прихованого кешування.

## Публічний API

- defaultRunner — Дефолтний spawn-runner провайдера (uv-виклики; інжектовний у тестах).

## Гарантії поведінки

- (специфічних машинно-виведених гарантій немає)
