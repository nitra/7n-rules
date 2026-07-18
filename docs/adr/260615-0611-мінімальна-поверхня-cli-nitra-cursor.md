---
type: ADR
title: "Мінімальна поверхня CLI @nitra/cursor"
description: CLI видаляє надлишкові alias-команди lint-ci і doc-files <sub>, лишаючи canonical entrypoints.
---

**Status:** Accepted
**Date:** 2026-06-15

## Context and Problem Statement

CLI `n-cursor` накопичив надлишкові точки входу. `lint-ci` був чистим аліасом для `lint --read-only --full`, а deprecated `doc-files <sub>` дублював `lint-doc-files` і `fix-doc-files`. Transcript фіксує, що grep по workflow, root `package.json`, скілах і коду не знайшов живих caller-ів цих alias-команд.

## Considered Options

- Залишити `lint-ci` і `doc-files <sub>` для зворотної сумісності.
- Видалити `lint-ci` і `doc-files <sub>`, а CI направити на `lint --read-only --full`.
- Злити doc-files-виклики у флаг `--doc-files` до `lint`.

## Decision Outcome

Chosen option: "Видалити `lint-ci` і `doc-files <sub>`", because обидві команди були alias-шаром без власної поведінки й без живих caller-ів, а ціль transcript — мінімальна поверхня CLI.

### Consequences

- Good, because CLI має менше публічних entrypoints і менше підтримуваних синонімів.
- Good, because `lint --read-only --full` покриває CI-сценарій без окремої підкоманди.
- Good, because `lint-doc-files` і `fix-doc-files` лишаються явними canonical командами для doc-files.
- Bad, because видалення публічних команд є breaking change для зовнішніх скриптів, якщо вони зверталися до alias напряму.
- Neutral, because transcript не містить підтвердження живих інтеграцій, які ламаються.

## More Information

- `npm/bin/n-cursor.js`: видалено `case 'lint-ci'` і `case 'doc-files'`, оновлено шапку, default-перелік і root-guard коментарі.
- `npm/schemas/rule-meta.json`: enum поля `lint` виправлено з `quick`/`ci` на `per-file`/`full`.
- `npm/rules/js-lint-ci/js-lint-ci.mdc`: згадки `lint-ci` замінено на `lint --full` або `lint --read-only --full`.
- `npm/.changes/260615-0638.md`: changeset `bump: major`, `section: Removed`.
- Перевірки з transcript: `node --check npm/bin/n-cursor.js` OK; `vitest run` orchestrate-тестів — 6/6 passed.

## Update 2026-06-15

Окремо підтверджено, що `lint-ci` був чистим аліасом для `runLint({ full: true, readOnly: true })`, тобто для сценарію `lint --read-only --full`. Живих caller-ів у workflow, CI-конфігах чи root `package.json` не зафіксовано; лишалися документаційні згадки та рядки CLI help/default-помилки.

Також виправлено `npm/schemas/rule-meta.json`: enum поля `lint` змінено з `quick`/`ci` на фактичний runtime-контракт `per-file`/`full`, який читає `parseRuleLintSpec`.

## Update 2026-06-15

- Конкретизовано видалення двох надлишкових CLI aliases: `lint-ci` як чистого alias `lint --read-only --full` і deprecated `doc-files <sub>` (`scan|check|gen|stamp`) після переходу hook/skills на `lint-doc-files` та `fix-doc-files`.
- `LEGACY_DOC_FILES_HOOK_COMMAND_MARKER` у `sync-claude-config.mjs` залишено не як CLI entrypoint, а як marker для cleanup старих інсталяцій.
- Breaking change зафіксовано changeset `npm/.changes/260615-0638.md` (`bump: major`, `section: Removed`).
