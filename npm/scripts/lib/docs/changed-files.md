---
type: JS Module
title: changed-files.mjs
resource: npm/scripts/lib/changed-files.mjs
docgen:
  crc: dcedcdca
  model: omlx/gemma-4-e4b-it-OptiQ-4bit
  tier: local-min
  score: 80
---

## Огляд

Збір змінених файлів для quick-режиму lint-оркестратора.

Quick лінтить лише те, що змінено в робочому дереві: tracked-modified + staged
(`git diff HEAD`) і нові untracked (`git ls-files --others --exclude-standard`).
Видалені файли не повертаються. Поза git-репо або при помилці git — порожній список.

Повністю native (C2 фази 3, `docs/specs/2026-07-30-rules-v2-rust-core-migration.md`):
порцелян-виклики git, унікалізація й фільтр worktree-чекаутів тепер усередині
`rules-core::changed_files` (через `rules-napi`). Цей фасад — лише передача
виклику з JS-сигнатурою, без власної git/regex-логіки.

## Публічний API

- collectChangedFiles — Relative-posix список змінених + untracked файлів робочого дерева.
- resolveChangedBase — Визначає git base для scoped-перевірок без зовнішнього runtime-стану.
Кандидати — effective Git policy: `baseBranch` + `releaseBranches`, кожна у
`origin/` та локальній формах; розгортання policy лишається тут (Р5 спеки
`docs/specs/2026-07-30-rules-v2-rust-core-migration.md`). Саме обчислення
«найновішого» сумісного merge-base — у native (`rules-core::changed_base`
через `rules-napi`, T4 фази 1): захист від stale-ref і вже інтегрованих
змін між довгоживучими середовищами перенесено туди без зміни контракту.
Якщо жодного ref немає — null, і caller порівнює лише робоче дерево з HEAD.
Повернений sha завжди досяжний (це merge-base існуючого ref), тож
fail-closed перевірка в `collectChangedFilesSince` не спрацює хибно. Явний
`baseRef` (CI: `--base origin/dev` після fetch) вимикає вибір — merge-base
рахується лише проти нього.
- collectChangedFilesSince — Список змінених + untracked файлів **відносно базового комміту**.

`git diff <base>` (без `..`/`...`, без `HEAD`) порівнює base-комміт із поточним
**робочим деревом** — тобто однаково ловить і закомічене від base, і staged, і
незакомічені модифікації. Це гарантує однакову поведінку незалежно від того, чи
зміни вже закомічені у worktree. Без `base` — fallback на `collectChangedFiles`
(робоче дерево vs HEAD).

Fail-closed: недосяжний `base` (rebase/force-update/shallow prune) кидає Error
замість мовчазного порожнього scope — перевірку й повідомлення робить native.
JS-сигнатура `(base, cwd)` — незмінна plugin-поверхня; native очікує
`(cwd, base)`, тож порядок розгортається тут.

## Сценарії використання

- `npm/scripts/lib/tests/changed-files.test.mjs` (collectChangedFiles; resolveChangedBase) — modified tracked + untracked; untracked у worktree-чекаутах (.worktrees, .claude/worktrees) не потрапляють у список; чисте дерево → порожньо; поза git → порожньо; stale локальна main у worktree: origin/main новіша → база від origin/main; ще 14

## Гарантії поведінки

- Власних операцій запису (ФС/БД) у файлі немає; виклики імпортованих модулів можуть писати.
