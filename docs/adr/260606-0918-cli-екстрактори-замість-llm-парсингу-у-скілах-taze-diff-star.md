---
session: 38aa0305-a12b-4078-9085-ce03884efdd6
captured: 2026-06-06T09:18:32+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/38aa0305-a12b-4078-9085-ce03884efdd6.jsonl
---

...(truncated at 20000 chars)...
---

## ADR CLI-екстрактори замість LLM-парсингу у скілах (`taze diff`, `start-check scan|run`, `fix --json`)

## Context and Problem Statement

Репо накопичило скіли (`n-taze`, `n-start-check`, `n-fix`), чиї SKILL.md інструктували LLM-агента вручну порівнювати бекапи `package.json`, розгортати glob-паттерни воркспейсів та розбирати текстовий вивід перевірки. Це — детермінований парсинг у токенах замість у коді, а також джерело нестабільності (агент «забуває» чи пропускає позиції).

## Considered Options

* Залишити парсинг у промпті SKILL.md (LLM вручну порівнює файли і лог)
* Перенести детермінований парсинг у CLI-команди (`n-cursor taze diff`, `n-cursor start-check scan|run`, `n-cursor fix --json`), SKILL.md отримує вже класифікований зріз

## Decision Outcome

Chosen option: "CLI-екстрактори у `npm/skills/*/js/`", because принцип «скрипт парсить — агент отримує зріз» вже зафіксований у `scripts.mdc` v1.13/v1.14 і підтверджений прецедентом `coverage-fix` (`index`/`slice`).

### Consequences

* Good, because детермінований парсинг коштує 0 токенів; агент отримує структурований JSON і може зосередитись на когнітивній роботі (CHANGELOG, рефакторинг, діагностика).
* Bad, because широкий `lint-extract` визнаний шкідливим (подвійний прогон, крихкий парсинг ~10 різнотипних тулів) і не реалізований; решта скілів (`llm-patch`, `docgen filter`, `publish-telegram`) — on-demand.

## More Information

* `npm/skills/taze/js/diff.mjs` — `runTazeCli`, класифікація major за caret-семантикою, тести 16 кейсів.
* `npm/skills/start-check/js/check.mjs` — `scanStartWorkspaces` + `runWorkspaceStart`, `spawnImpl`-ін'єкція, тести 15 кейсів.
* `npm/bin/n-cursor.js` — `runFixCommand(opts.json)`, у json-режимі `ensureHkInstall` пропускається.
* Smoke: `n-cursor fix bun --json` → чистий JSON; `n-cursor start-check scan` → `[{workspace,name,type}]`; регресія 60/60.
* Черга рефакторингу збережена в пам'яті `project_skill_extractor_refactor_backlog`.

---

## ADR `permissionMode:'bypassPermissions'` обов'язковий для headless SDK-агента

## Context and Problem Statement

`coverage --fix` запускає headless SDK-агента (`@anthropic-ai/claude-agent-sdk` `query()`) для ітеративного виправлення тестів. Виявлено, що без явного `permissionMode` воркер обробляв повідомлення і повертав відповідь, але **жодного файлу не редагував** — `Edit`/`Write`/`Bash` ігнорувались без помилки.

## Considered Options

* Залишити без `permissionMode` (SDK-дефолт)
* Додати `permissionMode: 'bypassPermissions'`
* Додати `permissionMode: 'acceptEdits'`

## Decision Outcome

Chosen option: "`permissionMode: 'bypassPermissions'`", because функціональні проби підтвердили: без режиму — файл не створюється (`(missing)`); з `'bypassPermissions'` або `'acceptEdits'` — `WORKER_OK`. `bypassPermissions` обрано тому, що `coverage --fix` також виконує `Bash` (запуск тестів), а `acceptEdits` може блокувати shell-команди в деяких конфігураціях.

### Consequences

* Good, because `coverage --fix` тепер реально редагує тести headless (до фіксу команда була функціонально неробочою).
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information

* `npm/scripts/coverage-fix.mjs` — додано `permissionMode: 'bypassPermissions'` у `query({ options: { … } })`.
* `npm/scripts/tests/coverage-fix.test.mjs` — assertion оновлено, тест `'передає cwd, maxTurns=20, allowedTools=[Read,Edit,Bash], permissionMode=bypassPermissions'` — 11/11.
* Change-файл `npm/.changes/260606-0721.md`.

---

## ADR Архітектурний вибір між A (single-agent), B (per-rule fan-out) та C (hybrid orchestrator) для `n-fix`

## Context and Problem Statement

Скіл `n-fix` інструктує одного LLM-агента виправити всі порушення правил репо. Питання: чи дає script-orchestrator (скрипт діагностує → спавнить воркерів → збирає результат) кращу повноту, вартість і швидкість порівняно з monolithic single-agent підходом?

## Considered Options

* A — як є: один SDK-агент отримує SKILL.md і виконує весь workflow
* B — per-rule fan-out: скрипт (`fix --json`) спавнить окремого воркера на кожне впале правило
* C — hybrid: скрипт механічно фіксує детерміновані порушення (видаляє заборонені файли), потім один holistic-воркер на залишок суджень

## Decision Outcome

Chosen option: "C — hybrid orchestrator", because він дав найшвидший wall-clock (94 с проти 117 с A і 219 с B), найменші output-токени (3.98K проти 4.73K A та 10K B) і чистий мінімальний diff (без scope-creep, характерного для A). Механічні фікси (`rm` lockfiles) виконуються без LLM (0 токенів).

### Consequences

* Good, because transcript фіксує очікувану користь: детерміновані T0-фікси поза LLM знижують вартість; holistic-воркер бачить весь контекст і не конфліктує сам з собою (на відміну від B, де 5 воркерів правили один `.vscode/extensions.json`).
* Bad, because B і C дали 2/3 повноти у 3× бенчі (один прогін після 2 ітерацій лишив `failed:1`) — через відсутність convergence-loop «поки `fix --json ≠ 0`». A дав 3/3 завдяки внутрішньому self-loop агента. Вирішення — додати bounded convergence-loop у C.

## More Information

* Бенч: ізольований worktree від HEAD, природне навантаження `failed 6/19` (`bun, ga, js-lint, rego, text, vue`), `n=3` для кожного підходу.
* Cost-метрика: `input + output×5 + cacheCreate×1.25 + cacheRead×0.1`; A ≈ 90.8K, B ≈ 264.9K, C ≈ 93.6K.
* SDK-воркер потребує `permissionMode:'bypassPermissions'` або `'acceptEdits'` для реального редагування (окремий ADR).
* Локальні моделі (`gemma3:4b` без tools ~35 с, `gemma4:4b` з tools ~97 с на M2 8GB) суттєво повільніші за хмарний Haiku/Sonnet (~5–15 с) — тому local-first доцільний лише для вартісної оптимізації (приватність/офлайн), а не для швидкості.
