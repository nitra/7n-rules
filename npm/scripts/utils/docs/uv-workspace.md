---
type: JS Module
title: uv-workspace.mjs
resource: npm/scripts/utils/uv-workspace.mjs
docgen:
  crc: b7602da3
  model: openai-codex/gpt-5.4-mini
  tier: cloud-min
  score: 100
  issues: judge:inaccurate:0.98
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

`readPyprojectManifest` читає `pyproject.toml` і повертає маніфест uv workspace, а `resolveUvWorkspaceMemberDirs` резолвить каталоги з `[tool.uv.workspace].members` та `.exclude` за тією самою glob-семантикою, що й у Cargo workspaces. Це read-only, fail-safe набір спільних T0-утиліт: він не пише у ФС чи БД, не кидає винятків назовні та для частини помилок повертає порожнє значення замість помилки.

## Поведінка

- `readPyprojectManifest` — читає `pyproject.toml` для uv workspace і повертає розпарсений manifest або `null`, якщо файл відсутній чи TOML невалідний.
- `resolveUvWorkspaceMemberDirs` — перетворює `members` і `exclude` uv workspace на список абсолютних каталогів із власним `pyproject.toml`, враховуючи літеральні шляхи та прості glob-патерни.

## Публічний API

- readPyprojectManifest — Розпарсений pyproject.toml або null (файл відсутній чи невалідний TOML).
- resolveUvWorkspaceMemberDirs — Резолвить `[tool.uv.workspace].members`/`.exclude`-патерни (літеральні шляхи й прості
glob з `*`) відносно `rootDir` у список абсолютних каталогів, що мають власний
pyproject.toml. Без повної glob-семантики uv — лише `*`-сегменти й літерали.

## Гарантії поведінки

- Read-only: не виконує операцій запису (ФС/БД).
- Перехоплює помилки і не пропускає винятків назовні (fail-safe).
- За певних помилок повертає порожнє значення (напр. `null`) замість винятку.
