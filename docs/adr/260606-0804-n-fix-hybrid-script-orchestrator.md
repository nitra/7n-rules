# n-fix Hybrid Script-Orchestrator та CLI-екстрактори для скілів

**Status:** Accepted
**Date:** 2026-06-06

## Context and Problem Statement

Аудит скілів репо виявив два суміжні патерни: (1) LLM-агенти виконували детермінований парсинг (semver-diff, glob-воркспейси, JSON-виводи fix-перевірок) замість CLI-скрипту, витрачаючи тисячі токенів на механічну роботу; (2) при оркестрації `n-fix` постало питання оптимальної гранулярності агентів. Для (2) проведено контрольований трьохваріантний експеримент на реальному навантаженні (6 ❌ правил після merge `origin/main`).

## Considered Options

**Для оркестрації n-fix:**
- A — holistic-агент: один SDK-агент із повним SKILL.md, довільний scope
- B — per-rule fan-out: скрипт запускає окремого SDK-воркера на кожне `ok:false` правило (8 воркерів на 6 ❌)
- C — hybrid orchestrator: скрипт детерміновано застосовує механічні фікси → один holistic LLM-воркер лише на залишок-судження

**Для CLI-екстракторів:**
- Read-only CLI-підкоманди `n-cursor <skill> <verb>` (скрипт несе парсинг, агент отримує компактний JSON-зріз)
- Широкий lint-extract (розглянуто і відхилено: `&&`-ланцюг показує один інструмент за раз, подвійний прогін = drift, половина без JSON)

## Decision Outcome

Chosen option: "C — hybrid orchestrator для n-fix + read-only CLI-екстрактори для скілів", because вимірний трьохваріантний експеримент підтвердив: C дає рівну швидкість A із чистим diff B, без scope-creep і без транзитних поломок від воркер-конфліктів; CLI-екстрактори дають 0 LLM-токенів на детермінований шар, залишаючи агенту лише когнітивну роботу.

### Consequences

Good, because transcript фіксує виміри другого прогону (A/B/C): C — 105 с / 2 воркери / 3.1K output / 37K cache-create; A — 5.0K output / 38K cache; B — 9.6K output / 111K cache; C єдиний без scope-creep і без транзитних ❌. При `n=1` числа індикативні.

Good, because CLI-екстрактори: `coverage-fix index|slice` → 7.4 KB замість 2.76 MB (~350× менше); аналогічний ефект для `taze diff`, `start-check scan|run`, `fix --json`.

Bad, because C вимагає реалізації механічного autofix-шару для детермінованих порушень; для `n=1` рекомендовано 3× усереднення перед продакшн-впровадженням.

Bad, because `n-lint` лишився без CLI-екстрактора: lint-extract відхилено (подвійний прогін = drift, `&&`-ланцюг = один інструмент за раз, половина без JSON).

Neutral, because ключовий інсайт з B: гранулярність fan-out визначається **цільовим файлом/об'єктом**, не правилом — 5 правил на один файл → 1 воркер, не 5.

## More Information

**Реалізовані CLI-підкоманди:**
- `n-cursor taze diff` — `npm/skills/taze/js/diff.mjs`; semver-класифікація (major/minor/patch за caret-семантикою); 16 тестів; change-файл `npm/.changes/260605-0716.md`.
- `n-cursor start-check scan|run` — `npm/skills/start-check/js/check.mjs`; cross-platform `spawnSync({timeout})` замість `perl alarm`; `sideEffects.{newFiles,changedTracked}` для керованого відкату; 15 тестів; change-файл `npm/.changes/260605-0731.md`.
- `n-cursor fix --json` — in-process presentation-flag у `runFixCommand`; `ensureHkInstall` пропускається в JSON-режимі (stdout чистий); smoke `fix bun --json` → `{"total":1,"failed":0,...}`; 60/60 регресія зелена; change-файл `npm/.changes/260606-0636.md`.

**permissionMode у headless SDK-агентів:** headless `npm/scripts/coverage-fix.mjs` запускав `query()` без `permissionMode` → агент не редагував файли. Додано `permissionMode: 'bypassPermissions'`; `acceptEdits` відхилено (блокує Bash, потрібний для `bun test`). Change-файл `npm/.changes/260606-0721.md`. Прецедент для всіх headless SDK-агентів репо, що потребують Edit/Bash.

**Принцип закріплено:** `.cursor/rules/scripts.mdc` v1.13–1.14, секція «🔴 ВИСОКИЙ ПРІОРИТЕТ — детермінований парсинг у скіла: у CLI, не в LLM». Еталони в правилі: `coverage-fix`, `worktree`, `adr-normalize`. Деталі першого прогону A vs B — у Update нижче (DRAFT-009).

## Update 2026-06-06 (Перший прогін: A vs B)

Перший прогін порівняв A і B без варіанта C:

- **A — holistic (105 с, 5.0K output, 4.8K input):** 1 ітерація, 0 failed; але scope-creep — зачепив 3 несуміжні файли (`COVERAGE.md`, spec-документ, `stryker_config.mjs`) поза очікуваним diff-ом.
- **B — per-rule fan-out (210 с, 9.6K output, 38K input):** мінімальний diff (4 файли), але 8 воркерів на 6 ❌ правил (5 правили один файл `.vscode/extensions.json`) → транзитна поломка в iter1: нові ❌ `ci4`/`style-lint` від взаємодії воркерів.

Висновок першого прогону: A перемагає B для задач зі спільними файлами-цілями. B виправданий лише коли цілі справді диз'юнктні (наприклад, docgen — 1042 незалежних файлів). Цей висновок уточнено після другого прогону з C (hybrid), описаного вище.

Harness: `.worktrees/main-fixexp` від HEAD `c16d801d`; baseline `failed 6/19 (bun, ga, js-lint, rego, text, vue)`; `_exp/{lib,run-a,run-b}.mjs`; SDK `@anthropic-ai/claude-agent-sdk@^0.3.0`; `permissionMode:'bypassPermissions'` (A) / `'acceptEdits'` (B).
