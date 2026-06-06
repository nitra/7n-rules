---
session: d943f92b-e895-4110-8ae0-338380a03c95
captured: 2026-06-06T16:20:30+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/d943f92b-e895-4110-8ae0-338380a03c95.jsonl
---

<STOP>

---

The transcript you've summarized describes a multi-session R&D investigation into quality routing for AI-generated documentation. Based solely on the sessions covered, here are the durable design decisions.

## ADR cloudScoreDoc — Claude Haiku як хмарний рефері якості

## Context and Problem Statement
Локальна модель `gemma3:4b` генерує документацію в режимі `orchestrated`, але для складних файлів (з великою кількістю внутрішніх символів) якість падає нижче прийнятного рівня: галюцинуються інваріанти, плутаються внутрішні та публічні API, перекидається логіка порівняння версій. Потрібен механізм, що визначає, які файли потребують хмарного проходу.

## Considered Options
* **Підхід B (LLM-суддя)** — локальна модель оцінює власну документацію за 4 критеріями (0–10 балів)
* **Підхід A (детермінований скоринг)** — перевірка вихідного markdown проти `facts` із Stage 0: наявність `## Огляд`, позитивні згадки кешу без факту, внутрішні імена у Гарантіях, довжина секції Поведінка
* **Складність файлу як сигнал (обраний)** — `sym = facts.internalSymbols.length` як порогова умова маршрутизації до cloud

## Decision Outcome
Chosen option: "Складність файлу як сигнал (`sym ≥ 4` → cloud)", because детермінований скоринг (Підхід A) і LLM-суддя (Підхід B) мають систематичний зсув +35 пп і +25 пп відповідно, і обидва не виявляють семантичних помилок (галюцинованих Rego-інваріантів, інвертованої логіки версій). Метрика `sym` (кількість внутрішніх символів) дає Pearson r=−0.651 із ручними оцінками якості — найсильніший єдиний предиктор із перевірених.

### Consequences
* Good, because при порозі `sym ≥ 4` на реальному проєкті (241 файл після виключення stryker-сендбоксів та bin-bundle) 78% файлів залишаються локальними (безкоштовно), 22% (52 файли) — cloud (~$1.5 на весь проєкт).
* Good, because transcript фіксує очікувану користь: файли з sym≥5 показали критичні семантичні дефекти при локальній генерації (workflows.mjs — неправдиві Rego-гарантії, score=100 від детермінованого скорера при зламаній семантиці; consistency.mjs — інвертований напрям порівняння версій).
* Good, because `sym` є детермінованим, обчислюється в Stage 0 (`extractFacts`) за 0 токенів, без додаткових LLM-викликів і без затримки.
* Bad, because `exp` (кількість публічних exports) має позитивну кореляцію (+0.384) — файли з великою кількістю публічних функцій обробляються локально добре, тому `sym` alone дещо завищує cloud-групу (k8s-tree.mjs sym=4 scored 83% locally).
* Bad, because transcript не містить підтверджених негативних наслідків стосовно файлів із sym=3 (51 файл, найбільша "сіра зона") — `fix.mjs` з sym=3 дав лише 50% якості локально, але вибірка з одного файлу.

## More Information
- Реалізація: один рядок у `npm/skills/docgen/js/docgen-gen.mjs` функція `generateDoc`: `const tier = facts.internalSymbols.length >= 4 ? 'cloud' : 'local'`
- Константа `DEFAULT_SYM_THRESHOLD` вже присутня у `generateDoc` (рядок 255) — поріг потрібно виставити в 4
- Відомий дефект: `npm/skills/docgen/js/docgen-ignore.mjs` не містить `npm/reports/**` та `npm/bin/**` у `DOCGEN_IGNORE_GLOBS` — stryker-сендбокси (`npm/reports/stryker/.tmp/sandbox-*/`) дублюють вихідні файли та роздувають підрахунок sym зі 241 до 938 файлів
- Бенч-скрипти: `~/docgen-bench3/complexity.mjs` (кореляційний аналіз), `~/docgen-bench3/tier_audit.mjs` (аудит проєкту з виключенням stryker), `~/docgen-bench3/comparison/` (git-репо з cloud-базою для diff)
- Відхилені підходи: `~/docgen-bench3/judge_b.mjs` (Підхід B, bias+25пп, 109s/файл), `~/docgen-bench3/score_a.mjs` (Підхід A, bias+35пп після виправлення false positives для кирилиці через `(?:^|[\s,;.()\[\]*])` замість `\b`)
