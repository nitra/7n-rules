---
type: JS Module
title: lint.mjs
resource: npm/rules/python/lint/lint.mjs
docgen:
  crc: 61a1e3c3
  model: omlx/gemma-4-e4b-it-OptiQ-4bit
  score: 90
  issues: internal-name:runStandardLint,judge:inaccurate:0.99
---

Забезпечує виконання обов'язкових кроків для валідації Python-коду відповідно до правил, визначених у `python.mdc`, використовуючи інструменти з [uv](https://docs.astral.sh/uv/). Якщо `pyproject.toml` відсутній у корені, процес завершується з кодом 0. Якщо файл присутній, але `uv` не знайдено в PATH, це розглядається як помилка. Обов'язкові кроки включають перевірку актуальності lock-файлу (`uv lock --check`) та збірку середовища (`uv sync --frozen`). Опціональні лінтери (`ruff`, `mypy`) запускаються лише за умови їх доступності через `uv run`. Цей процес реалізує канон патерну `lint-*` (серіалізація через `runStandardLint`).

## Поведінка

runLintPythonSteps виконує обов'язкові кроки для Python-лінтування за правилом python.mdc на базі [uv](https://docs.astral.sh/uv/). Якщо `pyproject.toml` відсутній, кроки пропускаються. Якщо `uv` не знайдено, виникає помилка. Виконує перевірку актуальності lock-файлу (`uv lock --check`) та збірку середовища (`uv sync --frozen`). Опціонально запускає лінтери (`ruff`, `mypy`) через `uv run`, якщо вони доступні.
runLintPython серіалізує запуск кроків лінтування Python через механізм `runStandardLint` та повертає код виходу.

## Публічний API

runLintPythonSteps — Виконує внутрішні етапи перевірки коду Python без блокування.
runLintPython — Виконує публічну команду перевірки коду Python, забезпечуючи унікальність виконання на основі стану Git-дерева та використовуючи механізм блокування.

## Гарантії поведінки

- Read-only: не виконує операцій запису (ФС/БД).
