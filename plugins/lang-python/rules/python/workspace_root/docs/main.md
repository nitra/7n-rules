---
type: JS Module
title: main.mjs
resource: plugins/lang-python/rules/python/workspace_root/main.mjs
docgen:
  crc: 1ae8fae4
  model: manual
  score: 100
---

## Огляд

Read-only detector для структури Python/uv (T0, без spawn `uv`): перевіряє, що в репозиторії є рівно один кореневий uv workspace (`pyproject.toml` з `[tool.uv.workspace]`), без вкладених workspace-маніфестів і без вкладених `uv.lock` поза кореневим workspace (окрім member-ів, явно виключених через `workspace.exclude`). Репортить лише структурні відхилення без авто-фіксу (fixability: structural).

Експортовані константи-рядки:
- `NESTED_WORKSPACE="nested-workspace"` — вкладений `[tool.uv.workspace]` поза кореневим `pyproject.toml`
- `NESTED_LOCKFILE="nested-lockfile"` — вкладений `uv.lock` поза кореневим workspace
- `MISSING_ROOT_WORKSPACE="missing-root-workspace"` — відсутній чи неправильний кореневий workspace
- `PACKAGE_NOT_WORKSPACE_MEMBER="package-not-workspace-member"` — package-маніфест не покритий `members` кореневого workspace

## Поведінка

- `NESTED_WORKSPACE` — позначає вкладений `[tool.uv.workspace]` поза кореневим `pyproject.toml`.
- `NESTED_LOCKFILE` — позначає вкладений `uv.lock` поза кореневим workspace (крім member-ів у `workspace.exclude`).
- `MISSING_ROOT_WORKSPACE` — позначає відсутній кореневий `pyproject.toml`, або кореневий `pyproject.toml` без `[tool.uv.workspace]` там, де в репозиторії є більше одного Python package-маніфесту (`[project]`).
- `PACKAGE_NOT_WORKSPACE_MEMBER` — позначає package-маніфест, який не покритий `members` кореневого workspace і не винесений у `workspace.exclude`.
- `lint(ctx)` — обходить дерево репозиторію (пропускаючи `node_modules`, `.git`, `target`, `.next`, `.turbo`, `.venv`, `venv`, `.claude`, `vendor`, `__pycache__`), шукає всі `pyproject.toml`/`uv.lock`; якщо в дереві немає жодного `pyproject.toml` з `[project]` — концерн не застосовний (чистий результат). Інакше перевіряє кореневий workspace, покриття `members`/`exclude` і відсутність вкладених workspace/lockfile.

## Публічний API

- `NESTED_WORKSPACE`, `NESTED_LOCKFILE`, `MISSING_ROOT_WORKSPACE`, `PACKAGE_NOT_WORKSPACE_MEMBER` — стабільні машиночитні reasons для чотирьох типів порушення (використовуються тестами й читачами `violations[].reason`).
- `lint(ctx)` — detector-функція концерну `python/workspace_root`; повертає `Promise<LintResult>` з масивом `violations`.

## Гарантії поведінки

- Read-only: не виконує операцій запису (ФС/БД), не спавнить `uv`.
- Fail-safe: помилки читання каталогу (`readdirSync`) чи парсингу TOML не пропускають виняток назовні.
- Кешує розпарсені маніфести в межах одного прогону (`parsedByPath`).
- Свідомо пропускає каталоги: `node_modules`, `.git`, `target`, `.next`, `.turbo`, `.venv`, `venv`, `.claude`, `vendor`, `__pycache__`.
