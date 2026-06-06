# ADR: Скіл як script-orchestrator проти LLM-driven (бенч n-fix) + local-first ladder

## Status

Proposed (експериментальні дані; рішення про реалізацію — далі).

## Context

Ціль — покращити якість роботи скілів через **детермінізм** (оркестратор створює підзадачі, а закриття підтверджує перевіркою, а не довірою моделі) і **зменшити вартість** хмарних LLM за рахунок **локальних моделей** (`pi` + Ollama), де це не знижує ефективність більше ніж на ~10%. Натхнення — Anthropic «building effective agents» (orchestrator-workers + routing + model-tiering) і «dynamic workflows».

Перевіряли на реальному навантаженні `n-fix`: baseline-стан репо природно мав 6 ❌ правил (`bun, ga, js-lint, rego, text, vue`); 5 із них фіксяться **спільним** файлом `.vscode/extensions.json`. Усі прогони — в ізольованому git-worktree через `@anthropic-ai/claude-agent-sdk` (`permissionMode: 'bypassPermissions'` — без нього headless-агент НЕ редагує файли).

## Експерименти

Підходи: **A** — як є (1 SDK-агент зі SKILL.md); **B** — per-rule orchestrator (воркер на кожне правило); **C** — hybrid (детермінований T0 `rm` + один holistic scoped воркер + convergence cap 2); **D** — escalation ladder `local(gemma4:4b)→haiku→sonnet` з per-rule check-gate.

3×(A/B/C) усереднено + 1× D:

| | повнота | wall сер. | хмарна вартість¹ | LLM-викликів | diff |
| --- | --- | --- | --- | --- | --- |
| A | **3/3** | 117 с | 90.8K | 1 | 4 чисто |
| B | 2/3 | 219 с | 264.9K | 8 | 4 |
| C | 2/3 | **94 с** | 93.6K | **2** | 4 чисто |
| D (local-first, перший прогін) | крах на ~45 хв² | **~45 хв** | — | — | частково |
| D (hardened, повний) | **complete ✅** | **~53 хв** | див. нижче³ | — | повний |

### D (hardened, local-first ladder) — фінал

`complete: true`, before=6→after=0, wall **3192 с (~53 хв)**, з них **localSec 2847 с (~47 хв, 89%)**. Ledger (хто закрив правило): `bun`→T0(rm), `js-lint`→**local**, `rego`→**local**, `ga`→haiku, `text`→haiku, `vue`→haiku, `ci4`→**sonnet** (повна ескалація: local×2→haiku×2 не змогли→sonnet), `style-lint`→haiku. **resolvedByLocal=2/7, resolvedByCloud=5/7, unresolved=0.** Convergence-loop спіймав каскад `[ci4, style-lint]` в iter1 (саме він дав повноту, на відміну від capped B/C).

³ Точну хмарну вартість НЕ зафіксовано — `usage` із SDK повернувся 0 (баг вимірювання в harness; працю воркери виконали, але токени не злічились).

¹ зведено в input-еквіваленти: `input + output×5 + cacheCreate×1.25 + cacheRead×0.1`.
² хмарний воркер уперся в `maxTurns(15)` на каскадному правилі; SDK на цьому **кидає** помилку (не повертає result), а harness її не обгорнув → крах. Robustness-баг, не фундаментальна вада.

## Decision / Висновки

1. **Наївний per-rule fan-out (B) — антипатерн**: 2× повільніше, ~3× дорожче, недетермінований. Причина — 5 воркерів правлять один `.vscode/extensions.json` + каскадні поломки.
2. **Детермінізм/повнота досягається НЕ архітектурою воркерів, а convergence-loop із check-gate**: оркестратор передиспетчеризує підзадачу, поки `fix --json` для неї не зелений. B/C падали 2/3 саме через фіксований cap (2 ітерації), а A давав 3/3, бо single-agent сам крутиться. Це модель-агностичний механізм і головний важіль якості.
3. **Hybrid (C)** (детермінований T0 + holistic scoped воркер) — найефективніший по швидкості/вартості; з convergence-loop дав би 3/3.
4. **Локальні моделі (M2 8GB):** `gemma3:4b` — генерує текст/JSON, але **без tools** (~35 с); `gemma4:4b` — **з tools**, редагує файли сам, але **~97 с/крок**. Хмара робить крок за ~5–15 с. Тобто локаль ~**10–20× повільніша**, але безкоштовна й офлайн. За **швидкісним** критерієм провалює поріг «≤10%»; за **вартісним/приватністю** — виграє.
5. **Архітектурний наслідок:** воркеру **не потрібні tools**, якщо оркестратор володіє I/O (читає контекст, модель видає вміст фіксу, оркестратор пише й перевіряє) — детермінованіше й дозволяє моделі без tool-use.
6. **Вибір команди:** перевага **local-first** (вартість+конфіденційність > час). Наслідок — велика latency (~45 хв/прогін) прийнятна.

## Consequences

* Good: емпірично доведено, що детермінований check-gate + convergence — ключ до повноти; hybrid-розклад T0/T1/T2 + ladder дає мінімум хмарної вартості.
* Bad/Costs: local-first латентність ~20× (≈45 хв на прогін n-fix); потрібні robustness-обгортки (maxTurns/errors → tier-fail→escalate); якість локальних 4B-моделей на coding-фіксах низька (часта ескалація).

## Verdict (після hardened D)

* **Архітектуру ПІДТВЕРДЖЕНО:** convergence-loop + per-rule check-gate + escalation ladder = **100% повнота** (0 unresolved, каскад спіймано, ескалація до sonnet рівно де треба). Це і є шуканий детермінізм — модель не «закриває» правило, поки `fix` не зелений.
* **Local-first премісу на цьому залізі — НЕ виправдано** для coding-підзадач n-fix: `gemma4:4b` закрила лише **2/7** (js-lint, rego), решта **5/7** усе одно пішли в хмару; локаль з'їла **~47 хв (89%)** переважно на 220с-таймаути. Тобто й хмарну вартість майже не зрізали (5/7 хмара), і latency катастрофічна (~26× проти A). Local-first виправданий лише для офлайн/приватних батчів, де час неважливий, АБО з сильнішою/швидшою локальною моделлю.

## Next

* `npm/skills/<id>` як **md-спека оркестратора → генерований JS-оркестратор** з **convergence-loop + check-gate** (підтверджено) і **configurable ladder**. Дефолт ladder — за вибором команди (local-first), але з **fail-fast локаллю** (1 спроба + короткий timeout), бо 4B-модель рідко тягне coding-фікс.
* T0 розширити: генерувати конфіги (`.vscode/extensions.json`) детерміновано з template/rego — тоді й хмарні воркери для них зникнуть.
* Полагодити збір `usage` у harness (SDK result.usage повертав 0).

## Appendix: Tool-free experiment (260606)

**Гіпотеза:** gemma3:4b у text-режимі (без tool-call loop) може фіксити прості правила швидше і дешевше, ніж gemma4:4b з tools.

**Середовище:** `benchmarks/tool-free/run.mjs`, worktree `main-tool-free-exp`, природні порушення: `bun` (package-lock.json/yarn.lock), `rego` + `style-lint` (`.vscode/extensions.json` missing extensions).

**Знахідки:**

| Тест | Контекст | Час | Результат |
| --- | --- | --- | --- |
| gemma3:4b `--mode text` (без `--no-tools`) | будь-який | миттєво | ❌ `400 does not support tools` — pi шле tools навіть у text-mode |
| gemma3:4b `--no-tools --mode text`, simple prompt | "Reply: ok" | ~230s total (cold) | ✅ відповів |
| gemma4:4b `--mode text` | simple prompt | ~8s | ✅ відповів |
| prewarm gemma3:4b | "ok" | **32–41s** | ✅ завантажено |
| rego, warm, short prompt (~500 chars) | 9 entries | **>90s** (timeout) | ❌ |
| style-lint, warm, short prompt | 9 entries | **78s** | ❌ галюцинація ("stoutler.dotenv" замість "stylelint.vscode-stylelint") |
| T0-auto: parse violation → add to JSON | — | **~1ms** | ✅ 3/3 |

**Висновки:**

1. **gemma3:4b tool-free — не підходить для config-фіксів:**
   - Потребує `--no-tools` (без нього 400 error від ollama API)
   - Cold-start: 30–60s; warm inference для ~500-char prompt: 78–90s — повільніше, ніж очікувалося
   - **Галюцинація**: додав `"stoutler.dotenv"` замість `"stylelint.vscode-stylelint"` — 4B-модель ненадійна на точних рядкових задачах
   - Висновок підтверджує аналіз з бенчу D: 4B недостатньо для coding/config-задач

2. **Правильна відповідь: T0-auto (новий паттерн):**
   - Violation output містить конкретний рядок: `recommendations має містити "tsandall.opa"`
   - Regex-парсинг → детермінований insert у JSON → 0 LLM токенів
   - 3/3 resolved за **4.2s** (rules wall), **~45s** total з prewarm
   - 100% надійність, 0 галюцинацій
   - Це **нова категорія між T0 (rm/create) і T1 (LLM)**: T0-auto — парсинг violation → програмний фікс

3. **Tool-free підходить тільки для:** text-generation задач (документи, prose), де correctness визначається структурно, а не точними рядковими значеннями.

**Новий патерн T0-auto:** оркестратор парсить violation-output через regex (детерміновано) і застосовує фікс без LLM. Умова: violation-message містить конкретний цільовий значення. Приклади: `recommendations має містити "X"`, `missing field "Y" in Z.json`. Цей патерн має бути першим у check-gate циклі — до будь-якого LLM-tier.
