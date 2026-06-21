---
type: JS Module
title: lint.mjs
resource: npm/rules/ga/lint/lint.mjs
docgen:
  crc: 3e67aa7b
  model: omlx/gemma-4-e4b-it-OptiQ-4bit
  score: 90
---

Виконує `runLintGaCli` CLI-обгортку над канонічним `lint-ga` (ga.mdc). Автоматично встановлює `shellcheck` та `conftest` через `ensureTool` (використовуючи `brew`/`scoop`/GitHub Release per-platform). Перевіряє наявність `uv` (для `uvx`), надаючи підказку для встановлення за https://astral.sh/uv/install.sh, якщо він відсутній. Послідовно виконує `bunx github-actionlint`, збирає робочі процеси за допомогою `uvx zizmor --offline --collect=workflows .` та делегує перевірку до `rules/ga/check.mjs::check`. Це забезпечує єдине джерело істини для перевірок, оскільки в режимі `rego-authoritative` Rego-полісі (`npm/policy/ga/`) запускає `rules/ga/check.mjs::check` як перший крок.

## Поведінка

1. `runLintGaCli` виконує послідовну перевірку правил якості коду.
2. Система автоматично встановлює `shellcheck` та `conftest` для забезпечення коректної роботи.
3. Система перевіряє наявність `uv` для запуску `uvx zizmor`. Якщо `uv` відсутній, виводиться повідомлення з інструкціями для встановлення (наприклад, `curl -LsSf https://astral.sh/uv/install.sh | sh` для Universal).
4. Виконується перевірка правил `github-actionlint` за допомогою `bunx`.
5. Виконується збір робочих процесів для аудиту за допомогою `uvx zizmor --offline --collect=workflows .`.
6. Виконується централізована перевірка правил, яка включає виконання Rego-полісів з `npm/policy/ga/` та перевірки між файлами на основі правил `ga.mdc`.
7. У разі виявлення помилки на будь-якому етапі, процес зупиняється та повертається код помилки відповідного кроку.

## Гарантії поведінки

- Read-only: не виконує операцій запису (ФС/БД).
