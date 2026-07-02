---
type: JS Module
title: fix-check.mjs
resource: npm/rules/python/check/fix-check.mjs
docgen:
  crc: 47e4101a
---

## Огляд

T0-autofix для `python/check`: детерміновані `ruff check --fix` + `ruff format` (через
`uv run --frozen`, як детектор). Виправляє авто-fixable ruff-правила й форматування Python перед
LLM-ладдером. Запис незворотний. Відсутній `uv` → no-op.

## Поведінка

- Перелічує tracked \*.py через git, застосовує `ruff check --fix .` і `ruff format .`.
- До списку змінених — лише файли з фактичною зміною.

## Публічний API

- `patterns` — `python-ruff-fix` спрацьовує на reason `ruff-check-violation`/`ruff-format-violation`.

## Гарантії поведінки

- Записуються лише фактично змінені файли; кожен реєструється через `recordWrite`.
