---
session: 38aa0305-a12b-4078-9085-ce03884efdd6
captured: 2026-06-06T07:55:03+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/38aa0305-a12b-4078-9085-ce03884efdd6.jsonl
---

The AI coding session transcript describes an experiment comparing two approaches to running the n-fix skill in the project:

- **Run A ("as-is")**: a single SDK agent with the full SKILL.md context runs the entire fix workflow
- **Run B (script-orchestrator)**: a script calls `fix --json` to diagnose failing rules, then spawns a minimal SDK worker *per failing rule* with only that rule's context

The key decision captured in this session is whether to convert skills like `n-fix` from LLM-driven to script-orchestrator pattern (where a script handles deterministic work and spawns minimal-context LLM workers per task). The experiment was designed and run to validate this architectural question.

---

## ADR Порівняльний експеримент n-fix: holistic-агент vs per-rule script-orchestrator

## Context and Problem Statement
У рамках масштабного рефакторингу скілів репо на принцип «детермінований парсинг — у CLI, агент отримує мінімальний зріз» постало питання: чи варто перетворити `n-fix` (і подібні скіли) на script-orchestrator, де скрипт робить діагностику (`fix --json`) і спавнить окремого LLM-воркера на кожне впале правило з мінімальним контекстом? Перед ухваленням рішення вирішено провести контрольований вимірюваний експеримент.

## Considered Options
* **A — holistic-агент («як є»):** один SDK-агент отримує повний текст `n-fix/SKILL.md` і виконує весь workflow на проєкті (`Read`, `Edit`, `Bash`, `acceptEdits`).
* **B — per-rule script-orchestrator:** скрипт запускає `fix --json`, на кожне `ok:false` правило спавнить окремий мінімальний SDK-воркер (контекст: лише `.mdc` правила + його `❌`-вивід), послідовно, з convergence-циклом.

## Decision Outcome
Chosen option: "A — holistic-агент («як є»)", because для задач `n-fix` цілі **не є диз'юнктними**: 5 із 6 правил правляться одним файлом `.vscode/extensions.json`, тому per-rule фан-аут (B) спавнив 5 окремих воркерів на той самий файл — кожен з повним cache-create/read + re-diagnose між ітераціями. A вирішив це за один хід.

### Consequences
* Good, because transcript фіксує очікувану користь: A — 105 с, 5.0K output-токенів, 4.8K input; B — 210 с (+2×), 9.6K output (+2×), 38K input (+8×). A також завершив за 1 ітерацію без транзитних поломок; B потребував iter1 для self-heal (2 нові ❌ `ci4`/`style-lint` від взаємодії воркерів).
* Bad, because A спричинив scope-creep: зачепив 3 несуміжні файли (`COVERAGE.md`, spec-документ, `stryker_config.mjs`) поза очікуваним diff-ом; B дав мінімально чистий diff (4 файли). Додатково: `n=1`, числа індикативні.

## More Information
- Worktree для ізоляції: `.worktrees/main-fixexp` (створено від HEAD `c16d801d`, видалено після).
- Baseline навантаження: `failed 6/19 (bun, ga, js-lint, rego, text, vue)` — природній стан після merge `origin/main`.
- Harness: `_exp/lib.mjs` (restore + fixState), `_exp/run-a.mjs`, `_exp/run-b.mjs` — всі видалено разом із worktree.
- SDK: `@anthropic-ai/claude-agent-sdk@^0.3.0`; `permissionMode:'bypassPermissions'` (run-a) / `'acceptEdits'` (run-b); обидва прогони — однакова модель/auth.
- Висновок про де B виграє: задачі зі **справді незалежними** цілями (docgen — 427 окремих файлів), не задачі зі спільними конфіг-файлами.
- Попередній баг-фікс цієї ж сесії: `coverage --fix` (`coverage-fix.mjs`) не виставляв `permissionMode` → headless-агент не редагував файли; виправлено, change-файл `npm/.changes/260606-0721.md`.
- Правило закріплено у `scripts.mdc` v1.13 (секція «🔴 ВИСОКИЙ ПРІОРИТЕТ — детермінований парсинг у скіла: у CLI, не в LLM»).
