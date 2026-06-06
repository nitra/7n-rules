---
session: 38aa0305-a12b-4078-9085-ce03884efdd6
captured: 2026-06-06T08:04:13+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/38aa0305-a12b-4078-9085-ce03884efdd6.jsonl
---

Hybrid orchestrator (ты прав) wins.

---
END OF TRANSCRIPT

[thinking]
Let me analyze this transcript to identify the key design decisions that should be documented as ADRs.

1. **scripts.mdc rule update - "Deterministic parsing → CLI, not LLM" principle** - A new high-priority section was added to scripts.mdc v1.13 formalizing the principle that deterministic work should be in CLI scripts, not LLM.

2. **`n-cursor taze diff` - Semver diff CLI extractor for taze skill** - Refactored the taze skill to use a CLI extractor for semver comparison instead of LLM.

3. **`n-cursor start-check scan|run` - Deterministic workspace discovery and startup testing** - Refactored start-check skill to delegate workspace scanning and process spawning to CLI.

4. **`n-cursor fix --json` - Structured JSON output for fix command** - Added `--json` flag to `fix` command; also suppresses `ensureHkInstall` in JSON mode.

5. **`coverage --fix` permissionMode bug fix** - Added `permissionMode: 'bypassPermissions'` so headless SDK agents can actually edit files.

6. **n-fix architecture experiment: A (single agent) vs B (per-rule orchestrator) vs C (hybrid)** - This is the biggest design decision in the transcript. The experiment compared three approaches:
- A: Single LLM agent with full SKILL.md
- B: Naïve per-rule orchestrator (8 workers)
- C: Hybrid orchestrator (mechanical autofix for deterministic fixes + single holistic LLM worker for judgement)

Result: C (hybrid) was best - same speed as A, fewer tokens, clean diff like B.

Let me draft ADRs for these decisions. The most significant ones are:

1. The general principle in scripts.mdc (already partially documented in memory, but deserves an ADR)
2. The n-fix architecture experiment result (hybrid orchestrator pattern)
3. The permissionMode fix for coverage --fix

I'll focus on the most durable design decisions:

**ADR 1**: Правило «детермінований парсинг → у CLI» в scripts.mdc (загальний принцип, v1.13-v1.14)

**ADR 2**: `n-cursor taze diff` — CLI-екстрактор semver-diff для скілу n-taze

**ADR 3**: `n-cursor start-check scan|run` — CLI для виявлення воркспейсів та запуску

**ADR 4**: `n-cursor fix --json` — структурований вивід для `fix`

**ADR 5**: `permissionMode: 'bypassPermissions'` у `coverage --fix`

**ADR 6**: Hybrid orchestrator для n-fix (найбільший — результат експерименту)

Actually, let me be selective. The transcript covers:
1. A multi-skill refactor series following a principle
2. The actual experiment with results

The main design decisions worth ADRs:
1. The principle encoded in scripts.mdc (architectural decision)
2. Each CLI extractor (taze diff, start-check scan|run, fix --json)
3. permissionMode bug fix
4. The hybrid orchestrator experiment result (most interesting/novel)

Let me write focused ADRs.
</thinking>

## ADR Правило «детермінований парсинг — у CLI» в scripts.mdc (v1.13)

## Context and Problem Statement
Аудит 9 скілів виявив, що LLM-агент виконує ручний парсинг виводу, розгортання glob-патернів, порівняння файлів і semver-класифікацію — детермінований «планктон», що марнує контекст і токени. Для конвергенції зі вже існуючим прецедентом (`coverage-fix`, `worktree`, `adr-normalize`) потрібне формальне правило.

## Considered Options
* Закріпити принцип у `scripts.mdc` з високим пріоритетом і переліком Red flags / еталонів
* Описати лише в `MEMORY.md` (без примусового правила в репо)
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Закріпити принцип у `scripts.mdc` з високим пріоритетом", because він застосовується до всіх майбутніх скілів і є enforceable при code review — тоді як MEMORY.md — лише нотатка.

### Consequences
* Good, because transcript фіксує очікувану користь: єдиний конвенційний патерн `n-cursor <skill> index|slice|<verb>` для всіх нових скілів, red flags у формулюваннях SKILL.md як чек-пункт перед фіналізацією.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Файл: `.cursor/rules/scripts.mdc`, версія `1.13` → `1.14`. Нова секція «🔴 ВИСОКИЙ ПРІОРИТЕТ — детермінований парсинг у скіла: у CLI, не в LLM». Еталони в самому правилі: `coverage-fix` (`index`/`slice`), `worktree`, `adr-normalize`.

---

## ADR `n-cursor taze diff` — CLI-екстрактор semver-diff для скілу n-taze

## Context and Problem Statement
Крок 3 SKILL.md скілу `n-taze` казав LLM вручну порівнювати `package.json.taze-bak` з оновленим `package.json` і класифікувати «змінилась перша значуща цифра semver → major». Це чистий JSON-diff + semver-алгоритм — детерміновано, без суджень.

## Considered Options
* `n-cursor taze diff` — read-only CLI-екстрактор, що несе весь diff і класифікацію
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "`n-cursor taze diff`", because алгоритм повністю детермінований (caret-семантика: `1.x→2.x`, `0.4.x→0.5.x`, `0.0.3→0.0.4`); LLM лишається лише когнітивна робота (CHANGELOG breaking-changes і рефакторинг коду).

### Consequences
* Good, because transcript фіксує очікувану користь: 16 тестів зелені; smoke `comparedWorkspaces:1` ок; oxlint чисто; LLM отримує `{major:[{workspace,pkg,from,to}], minorPatch, totalChanged}` замість ручного порівняння бекапів.
* Bad, because реалізована підкоманда `taze diff`; підкоманди `check-usage` (grep-обгортка) і `taze bak` (копіювання бекапів) — не реалізовані в цій сесії (низький пріоритет на момент транскрипту).

## More Information
Файли: `npm/skills/taze/js/diff.mjs`, `npm/skills/taze/js/tests/diff.test.mjs`. Додано до `npm/bin/n-cursor.js` (`case 'taze'`). SKILL.md (джерело `npm/skills/taze/SKILL.md` + `.cursor/skills/n-taze/SKILL.md`) крок 3 оновлено. Анкоровий regex `SEMVER_RE = /^[^*/~>=<\s]*[~^>=<]*\s*v?(\d+)\.(\d+)\.(\d+)/` — щоб не ловити `1.0.0` всередині `workspace:1.0.0`. Change-файл `npm/.changes/260605-0716.md`.

---

## ADR `n-cursor start-check scan|run` — CLI для виявлення воркспейсів і smoke-запуску

## Context and Problem Statement
Скіл `n-start-check` казав LLM-агенту вручну розгортати glob-воркспейси, читати `scripts.start`, запускати процеси через крос-платформний `perl alarm`, інтерпретувати exit-коди (142/0), grep-ати лог на `ready`/`Error` і відкочувати побічні файли. ~80% воркфлоу — детерміновані shell/git/log-операції.

## Considered Options
* `n-cursor start-check scan|run` — CLI-підкоманди, що несуть весь детермінований шар
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "`n-cursor start-check scan|run`", because весь детермінований шар переходить у скрипт (0 LLM-токенів), а агент лишається лише з діагностикою «чому FAIL».

### Consequences
* Good, because transcript фіксує очікувану користь: 15 тестів зелені (включно з injectable `spawnImpl`); smoke реального репо → `root→cli, demo→server, npm→cli`; крос-платформний `spawnSync({timeout})` замість `perl alarm`; `sideEffects:{newFiles, changedTracked}` робить відкат керованим (без ручного зіставлення знімків `/tmp`).
* Bad, because відкат (`git checkout`/`rm`) лишається явним у скілі (деструктивна операція — не в CLI); це свідоме рішення transcript (безпека).

## More Information
Файли: `npm/skills/start-check/js/check.mjs`, `npm/skills/start-check/js/tests/check.test.mjs`. Regex готовності: `READY_RE = /(ready(?![\w-])|listening|local:|started|server running|compiled successfully|listening on)/i` (виправлено `\b` що не спрацьовував після `:` через non-word-char). Change-файл `npm/.changes/260605-0731.md`. `meta.requireRoot:true` узгоджується з in-place CLI без worktree.

---

## ADR `n-cursor fix --json` — структурований JSON-вивід для команди `fix`

## Context and Problem Statement
Крок 2 SKILL.md скілу `n-fix` казав агенту «зчитай вивід, знайди всі `❌`» — агент парсив термінальний текст із кольоровими символами. `runFixCommand` вже мав per-rule результати всередині — достатньо додати presentation-флаг без повторного прогону.

## Considered Options
* `--json` прапорець на наявному `runFixCommand` — per-rule capture замість `stdio:'inherit'`
* Окремий extractor-модуль (аналогічно `taze diff` і `start-check`)
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "`--json` прапорець на наявному `runFixCommand`", because це in-house presentation-флаг (не потребує окремого парсера зовнішніх тулів і повторного прогону), а результати вже зібрані всередині функції.

### Consequences
* Good, because дефолтна поведінка без прапорця незмінна; smoke `fix bun --json` → `{"total":1,"failed":0,"rules":[{"ruleId":"bun","ok":true,"output":"…"}]}` чистий JSON; `fix --json` на повному наборі → чистий stdout ✓; 60/60 регресія зелена.
* Bad, because `ensureHkInstall` довелося пропускати в `--json`-режимі (вона друкувала `Installed hk hook…` у stdout, забруднюючи JSON) — ця асиметрія нова, але підтверджена тестами.

## More Information
Файл: `npm/bin/n-cursor.js` (`runFixCommand` + `case 'fix'`). Щоб stdout був чистим JSON, `--json`-режим пропускає `ensureHkInstall` (встановлення git-хука) через умову `if (!json) ensureHkInstall(hkBin)`. Change-файл `npm/.changes/260606-0636.md`. `runFixCommand` як bin-glue не юніт-тестується — прецедент: тести імпортують лише чисті хелпери.

---

## ADR `permissionMode: 'bypassPermissions'` у `coverage --fix` (claude-agent-sdk)

## Context and Problem Statement
Headless SDK-агент `coverage --fix` (`npm/scripts/coverage-fix.mjs`) запускав `query()` без `permissionMode`, через що агент не отримував дозволу на `Edit`/`Bash` і не редагував файли — функціонально фіча була неробочою headless. Виявлено при feasibility-пробах функціонального exp: без режиму → файл `(missing)`, з `bypassPermissions` → `WORKER_OK`.

## Considered Options
* `permissionMode: 'bypassPermissions'`
* `permissionMode: 'acceptEdits'`
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "`permissionMode: 'bypassPermissions'`", because `coverage --fix` — автономний pipeline (CI), покликає Bash для `bun test`, тому `acceptEdits` (який блокує Bash) не підходить.

### Consequences
* Good, because transcript фіксує: 11/11 тестів зелені після оновлення assertion; headless-агент реально пише файли.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Файли: `npm/scripts/coverage-fix.mjs` (додано `permissionMode: 'bypassPermissions'` до `options` у `query()`), `npm/scripts/tests/coverage-fix.test.mjs` (assertion оновлено). Change-файл `npm/.changes/260606-0721.md`. Аналогічну опцію має застосовувати будь-який headless SDK-агент у цьому репо, що потребує Edit/Bash.

---

## ADR Hybrid orchestrator як архітектурний патерн для `n-fix` (висновок порівняльного експерименту)

## Context and Problem Statement
Потрібно оцінити, чи варто переробити скіл `n-fix` зі «SKILL.md → один LLM-агент» на «script-orchestrator → кілька LLM-воркерів», і якщо так — яку гранулярність оркестрування обрати.

## Considered Options
* **A — «як є»**: один SDK-агент із повним SKILL.md, довільний scope
* **B — per-rule fan-out**: скрипт запускає окремого SDK-воркера на кожне `ok:false` правило (8 воркерів для 6 ❌)
* **C — hybrid**: скрипт детерміновано застосовує механічні фікси (видалити заборонені файли) → один holistic LLM-воркер лише на залишок-судження

## Decision Outcome
Chosen option: "C — hybrid orchestrator", because він поєднує переваги A (швидкість, мінімальний cache overhead) і B (чистий мінімальний diff, без scope-creep), усуваючи головний недолік B — 5 окремих воркерів на один спільний файл `.vscode/extensions.json`.

### Consequences
* Good, because transcript фіксує: C — 105 с / 2 воркери / 3.1K output tokens / 37K cache create (проти A — 5.0K / 38K, B — 9.6K / 111K); фінал failed 0 всі три; C — єдиний без scope-creep (4 файли чисто) і без транзитних поломок (B мав iter1 з 2 новими ❌).
* Bad, because `n=1` — числа індикативні (LLM недетермінований); для рішення transcript рекомендує 3× усереднення; наявна реалізація `run-c.mjs` — throwaway-скрипт у worktree `main-fixexp2` (прибрано після exp), не перенесена в production `n-fix`.

## More Information
Harness: `.worktrees/main-fixexp2/_exp/run-a.mjs`, `run-b.mjs`, `run-c.mjs` (прибрані після exp). Baseline: `failed 6/19` (`bun, ga, js-lint, rego, text, vue`) — реальне навантаження після merge `origin/main`. SDK auth: macOS Keychain (без `ANTHROPIC_API_KEY` в env). Transcript фіксує додатковий потенціал: якщо `fix` генерував би канонічні конфіги з template/rego, LLM-воркер у C теж зник би → `fix --apply` майже повністю детермінований. Ключовий урок: гранулярність fan-out — «на цільовий файл/об'єкт», не «на правило».
