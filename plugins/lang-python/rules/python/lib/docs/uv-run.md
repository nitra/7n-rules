---
type: JS Module
title: uv-run.mjs
resource: plugins/lang-python/rules/python/lib/uv-run.mjs
docgen:
  crc: 1b91d292
  model: openai-codex/gpt-5.4-mini
  score: 100
  issues: judge:inaccurate:0.97
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Спільний preflight для Python-детекторів `mypy` і `ruff`, виділений зі спільного дубльованого коду з `main.mjs`. Використовує `PY_EXT_RE`, щоб залишати лише Python-цілі; для `ctx.files` запускає перевірку по вибраних файлах, а без них — по всьому проєкту через `.`. За наявності `uvToolAvailable` готує запуск обох детекторів через `uv run --frozen`; `preparePythonRun` формує однаковий контракт підготовки для обох інструментів.

## Поведінка

- `PY_EXT_RE` — визначає, чи файл належить до Python-цілей для delta-лінту.
- `uvToolAvailable` — перевіряє, чи доступний Python-інструмент у середовищі `uv`.
- `preparePythonRun` — готує спільний preflight для Python-лінтерів: пропускає без `pyproject.toml`, відсікає нерелевантні файли, перевіряє наявність `uv` і доступність інструменту, після чого повертає готові цілі для запуску через `uv run --frozen`.

## Публічний API

- PY_EXT_RE — Відібрає лише Python-файли з delta-списку для `lint`.
- uvToolAvailable — Підтверджує, що `uv` доступний у середовищі.
- preparePythonRun — Готує запуск Python-цілі: звіряє `pyproject.toml`, визначає delta або full-обсяг, знаходить `uv` і перевіряє, чи є потрібний `tool`; якщо підготовка не вдалася, викликач завершує `reporter.result` раніше.

## Гарантії поведінки

- Read-only: не виконує операцій запису (ФС/БД).
