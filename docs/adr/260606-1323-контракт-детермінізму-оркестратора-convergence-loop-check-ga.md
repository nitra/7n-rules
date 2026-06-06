---
session: 38aa0305-a12b-4078-9085-ce03884efdd6
captured: 2026-06-06T13:23:35+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/38aa0305-a12b-4078-9085-ce03884efdd6.jsonl
---

На основі транскрипту пишу ADR:

---

## ADR Контракт детермінізму оркестратора — convergence-loop + check-gate

## Context and Problem Statement
Після завершення бенчу D (hardened local-first ladder), який підтвердив 100% повноту через convergence-loop, архітектурний принцип існував лише в ADR-документі. Не було формального контракту, який зобов'язував би кожен новий скіл-оркестратор дотримуватись цього підходу.

## Considered Options
* Залишити принцип у ADR (неформально)
* Додати обов'язковий розділ до `scripts.mdc`

## Decision Outcome
Chosen option: "Додати обов'язковий розділ до `scripts.mdc`", because transcript фіксує явне рішення: "архітектурі оркестратора (детермінізм) фіксуємо в контракті" — користувач прямо назвав це контрактом, а не рекомендацією.

### Consequences
* Good, because transcript фіксує очікувану користь: правило `## 🔴 КОНТРАКТ ОРКЕСТРАТОРА` в `scripts.mdc` v1.15 стало `alwaysApply: true` — порушення стандарту будуть видимі при наступному `fix` запуску.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Файл: `.cursor/rules/scripts.mdc` (version bumped `1.14` → `1.15`). Контракт включає: convergence-loop, per-rule check-gate (`fix <rule> --json → ok`), escalation ladder (local → haiku → sonnet), обов'язковий `try/catch` на кожен tier-worker (SDK кидає при `maxTurns`, не повертає). Антипатерни: `cap` без справжньої конвергенції, модель самозвітує "готово".

---

## ADR Tool-free gemma3:4b для config-фіксів — відхилено

## Context and Problem Statement
Бенч D показав, що `gemma4:4b` з tool-use loop витрачає ~97s на крок і закрила лише 2/7 правил, решта пішли в хмару. Гіпотеза: якщо прибрати tool-call overhead (`--mode text`, без ітерацій), `gemma3:4b` (~3.3GB) може фіксити прості config-правила за ~35s і без хмарних токенів.

## Considered Options
* `gemma3:4b --mode text --no-tools` (tool-free, одна генерація)
* `gemma4:4b --mode text` (tool-free, одна генерація)
* Детермінований T0-auto (парсинг violation output)

## Decision Outcome
Chosen option: "Детермінований T0-auto (парсинг violation output)", because transcript фіксує: tool-free LLM не підходить через галюцинацію ("stoutler.dotenv" замість "stylelint.vscode-stylelint") і latency 78–90s навіть після prewarm — тобто жодна з двох цілей (correctness, швидкість) не досягнута.

### Consequences
* Good, because transcript фіксує очікувану користь: `benchmarks/tool-free/run.mjs` задокументовано конкретні числа замість здогадок; подальші рішення ґрунтуються на вимірюваних даних.
* Bad, because transcript фіксує: `gemma3:4b` потребує `--no-tools` (без прапора ollama API повертає `400 does not support tools`); cold-start 30–60s; warm inference для ~500-char prompt — 78–90s (не ~35s як очікувалось); 4B модель галюцинує на точних рядкових задачах.

## More Information
Скрипт: `benchmarks/tool-free/run.mjs`, worktree `main-tool-free-exp`. Таблиця вимірів в `docs/adr/260606-1124-orchestrator-vs-llm-skil-n-fix-bench-ta-local-first-ladder.md` (Appendix: Tool-free experiment). Ключова деталь: `gemma4:4b` у `--mode text` відповів на простий prompt за ~8s, але той самий підхід з реальними violation-промптами (~500 chars) таймаутить >90s — bottleneck у prefill computation на M2 8GB, а не у generation.

---

## ADR Паттерн T0-auto: парсинг violation output замість LLM

## Context and Problem Statement
Під час tool-free експерименту виявлено, що violation output від `fix --json` вже містить точне значення, яке треба додати: `recommendations має містити "tsandall.opa"`. LLM (навіть cloud haiku) залучався для задачі, яку можна вирішити regex'ом за ~1ms.

## Considered Options
* LLM (tool-free text mode або tool-enabled agent) читає файл і додає запис
* Детермінований regex-парсинг violation output → програмний insert у JSON

## Decision Outcome
Chosen option: "Детермінований regex-парсинг violation output → програмний insert у JSON", because transcript фіксує: violation-рядок вже містить конкретний target — `extractExtensionFromViolation()` витягує значення regex `/recommendations має містити "([^"]+)"/` і `t0ExtensionsJsonFix()` вставляє його у `extensions.json` без будь-яких LLM токенів.

### Consequences
* Good, because transcript фіксує очікувану користь: 3/3 правил (bun + rego + style-lint) resolved за 4.2s wall-time, 100% correctness, 0 галюцинацій. Порівняно з tool-enabled haiku (~30–60s/правило) і tool-free LLM (78–90s + галюцинація).
* Bad, because паттерн застосовний лише коли violation output є "самоописовим" — містить конкретне цільове значення. Для правил де violation описує симптом без target-значення (напр. "відступи неправильні") T0-auto не працює і потрібен T1 (LLM).

## More Information
Реалізація: `benchmarks/tool-free/run.mjs`, функції `extractExtensionFromViolation(violationText)` (рядки ~56–64) і `t0ExtensionsJsonFix(root, violationOutput)` (рядки ~65–80). Нова ієрархія tier: **T0** (детермінований rm/create) → **T0-auto** (парсинг violation → програмний фікс) → **T1** (LLM). T0-auto має йти першим у check-gate циклі — до будь-якого LLM-tier. Умова застосування: violation message містить шаблон з конкретним значенням (quoted string, field name, тощо).
