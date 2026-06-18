---
type: ADR
title: "CLI-екстрактори: taze diff, start-check scan|run, fix --json + permissionMode"
description: Впровадження детермінованих CLI-підкоманд для скілів n-taze, n-start-check, n-fix та фікс permissionMode у coverage-fix за правилом scripts.mdc v1.13.
---

**Status:** Accepted
**Date:** 2026-06-06

## Context and Problem Statement

Три скіли (n-taze, n-start-check, n-fix) змушували LLM-агента виконувати детерміновану механічну роботу: semver-порівняння `package.json.taze-bak` з оновленим `package.json`, glob-розгортання воркспейсів, управління процесами і парсинг terminal-виводу з `❌`-маркерами. Паралельно headless SDK-агент `coverage --fix` не редагував файли через відсутній `permissionMode`. Щойно закріплений розділ `scripts.mdc v1.13` («🔴 ВИСОКИЙ ПРІОРИТЕТ — детермінований парсинг у скіла: у CLI, не в LLM») вимагає переносу всіх таких операцій у CLI.

## Considered Options

- n-taze: `n-cursor taze diff` (CLI-екстрактор semver) vs ручне LLM-порівняння backup-файлів
- n-start-check: `n-cursor start-check scan|run` vs ручне glob + shell + process management у LLM
- n-fix: `--json` прапорець на `runFixCommand` vs окремий extractor-модуль
- coverage-fix: `permissionMode: 'bypassPermissions'` vs `permissionMode: 'acceptEdits'`
- Інші варіанти в transcript не обговорювалися.

## Decision Outcome

Chosen option: "CLI-підкоманда на кожен скіл + bypassPermissions для coverage-fix", because детермінований парсинг у CLI дає 0 LLM-токенів на механічну роботу; агент отримує компактний JSON-зріз і лишається лише з когнітивними задачами; `bypassPermissions` підходить автономному CI-pipeline, тоді як `acceptEdits` блокував би Bash-виклики.

### Consequences

- Good, because `taze diff` — 16 тестів зелені; semver caret-семантика (`1.x→2.x`, `0.4.x→0.5.x`) закодована в скрипті, а не покладається на LLM-інтерпретацію.
- Good, because `start-check scan|run` — 15 тестів зелені; injectable `spawnImpl` дозволяє юніт-тести без реальних процесів; `sideEffects:{newFiles,changedTracked}` робить відкат керованим без ручного зіставлення знімків `/tmp`.
- Good, because `fix --json` — 60/60 регресія зелена; дефолтна поведінка (без прапорця) незмінна.
- Good, because headless `coverage --fix` — підтверджено функціональним пробом: без `permissionMode` файл `(missing)`, з `bypassPermissions` файл `WORKER_OK`; 11/11 тестів зелені після оновлення assertion.
- Bad, because `fix --json` пропускає `ensureHkInstall` (встановлення git-hook), щоб не забруднювати stdout — нова асиметрія відносно стандартного режиму; підтверджена тестами.
- Neutral, because підкоманди `taze check-usage` і `taze bak` заплановані, але не реалізовані в цій сесії (низький пріоритет на момент transcript).

## More Information

Файли:
- `npm/skills/taze/js/diff.mjs`, `tests/diff.test.mjs` — `SEMVER_RE` не ловить `workspace:` prefix; caret-алгоритм: перша значуща ненульова цифра змінилась → major.
- `npm/skills/start-check/js/check.mjs`, `tests/check.test.mjs` — regex готовності `/(ready(?![\w-])|listening|local:|started|server running|compiled successfully|listening on)/i`; виправлено `\b` (не спрацьовував після `:`).
- `npm/bin/n-cursor.js` — `case 'taze'` (dispatch до `diff.mjs`) та `case 'fix'` з `options.json = true`.
- `npm/scripts/coverage-fix.mjs` — `options: { permissionMode: 'bypassPermissions' }` у виклику `query()`.
- `npm/scripts/tests/coverage-fix.test.mjs` — assertion `toEqual` перевіряє поле `permissionMode`.

Change-файли: `npm/.changes/260605-0716.md` (taze diff), `npm/.changes/260605-0731.md` (start-check), `npm/.changes/260606-0636.md` (fix --json), `npm/.changes/260606-0721.md` (permissionMode).

Правило `scripts.mdc v1.13`: red flags у SKILL.md — «зчитай вивід», «порівняй файли», «знайди воркспейси», «розгорни glob». Еталони без рефакторингу: `worktree`, `adr-normalize`.
