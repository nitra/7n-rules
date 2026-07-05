---
type: ADR
title: ""
---

## ADR Сигнал складності sym ≥ 4 як детермінований tier-routing у docgen

## Context and Problem Statement
Двотировий docgen-конвеєр (gemma3:4b локально + Claude хмарно) потребував чіткого сигналу для автоматичного вибору tier без LLM-суддів і без ручної розмітки. Попередні підходи — LLM-суддя (Підхід B, зсув +25 пп) і детермінований скорер (Підхід A, зсув +35 пп після фіксів) — виявились ненадійними як якісний гейт для файлів з різною складністю.

## Considered Options
* `sym` (кількість внутрішніх символів із `extractFacts`) як єдиний пороговий сигнал
* `combo` (sym + exp*2 + imp) — зважена комбінація метрик
* Підхід B — LLM-суддя (Claude Haiku) як якісний рефері
* Підхід A — детермінований скорер на основі `facts` із Stage 0

## Decision Outcome
Chosen option: "`sym ≥ 4` → cloud, інакше local", because Pearson r = −0.651 між `sym` і якістю документації — найсильніша кореляція серед усіх метрик; `exp` (кількість публічних функцій) має позитивну кореляцію (+0.384) і розбавляла б `combo`; тест на 7 файлах показав чіткий розрив: local-група (sym < 4) avg 89%, cloud-група (sym ≥ 4) avg 65%. На 241 реальному файлі проєкту поріг дає 78% local (безкоштовно) / 22% cloud (~$1.5).

### Consequences
* Good, because transcript фіксує очікувану користь: 0 токенів на routing-рішення, детерміноване та відтворюване; на повному проєкті (58 нових файлів) cloud-tier отримав лише 6 файлів (sym=4–10), local — 52; min score серед local-файлів = 80, avg ≈ 94%.
* Bad, because `sym = 3` — найбільша сіра зона (51 файл у проєкті): `fix.mjs` із sym=3 показав якість 50% на бенчі, але залишається у local-тирі; фіксується як borderline для ручного рев'ю.

## More Information
* Реалізація: `const DEFAULT_SYM_THRESHOLD = 4` у `npm/skills/docgen/js/docgen-gen.mjs` (рядок 231); routing: `facts.internalSymbols.length >= symThreshold ? 'cloud' : 'local'`
* `extractFacts` — `npm/skills/docgen/js/docgen-extract.mjs`
* Виявлений і зафіксований побічний дефект: `npm/reports/**` (Stryker-сендбокси) і `npm/bin/**` додані до `DOCGEN_IGNORE_GLOBS` у `npm/skills/docgen/js/docgen-ignore.mjs`
* Бенч-скрипти: `~/docgen-bench3/tier_audit.mjs`, `score_a.mjs`, `complexity.mjs`
* Cloud vs local порівняння (git diff): `~/docgen-bench3/comparison/` — база cloud (Claude), diff local (gemma3:4b) на `commands.mjs` (sym=15) і `safety.mjs` (sym=17)
* Commit: `6436a901` — 58 нових docs-файлів у репозиторії

## Update 2026-06-06

- Для docgen зафіксовано routing за складністю: якщо `facts.internalSymbols.length >= 3`, файл краще спрямовувати в cloud tier.
- Локальний LLM-суддя відхилено: `gemma3:4b` завищував власний score приблизно на 25 п.п. і не ловив очевидні витоки implementation details.
- Чистий детермінований scoring теж недостатній для semantic defects: після виправлення false positives він завищував результат приблизно на 35 п.п.
- `sym >= 3` обрано як дешевий routing-сигнал: 0 токенів, <1 ms, Pearson −0.651 з якістю на bench-наборі.
- Відомий компроміс: threshold консервативний і може відправити в cloud файли з прийнятною локальною якістю, наприклад `k8s-tree`.

## Update 2026-06-06

Уточнено hybrid routing у `generateDoc`:

- `sym < 2` → Tier 1 local без рефері.
- `sym ∈ [2, 4)` → Tier 1 + `cloudScoreDoc` як judge.
- `sym ≥ 4` → Tier 2 cloud pre-routing через Sonnet.

`cloudScoreDoc` за замовчуванням використовує `claude-haiku-4-5-20251001` як дешевий хмарний варіант для ролі рефері.

Додано параметри `scoreModel` для рефері, `cloudModel` для Tier 2 генерації, CLI `--score-model <m>`; `--tier-only` показує три routing-зони. Реалізація зафіксована у `npm/skills/docgen/js/docgen-gen.mjs`, commit `470182fa`.

## Update 2026-06-06

Зафіксовано роль `cloudScoreDoc` як хмарного рефері якості:

- локальна `gemma3:4b` для складних файлів галюцинує інваріанти, плутає internal/public API та може інвертувати логіку;
- LLM-суддя і детермінований post-hoc скорер показали систематичний bias (`+25 пп` і `+35 пп`) і не виявляли частину семантичних помилок;
- `sym = facts.internalSymbols.length` має Pearson `r = -0.651` з ручною оцінкою якості та лишається основним routing-сигналом;
- при `sym ≥ 4` cloud-група становить приблизно 52 файли з 241 (~22%), орієнтовно `$1.5` за повний проєкт.

Додаткові transcript facts:

- `DEFAULT_SYM_THRESHOLD` у `npm/skills/docgen/js/docgen-gen.mjs` має бути `4`.
- Відомий дефект аудиту: `npm/reports/stryker/.tmp/sandbox-*` і `npm/bin/**` роздували вибірку з 241 до 938 файлів.
- Бенч-скрипти: `~/docgen-bench3/complexity.mjs`, `~/docgen-bench3/tier_audit.mjs`, `~/docgen-bench3/judge_b.mjs`, `~/docgen-bench3/score_a.mjs`.

## Update 2026-06-06

Порівняльна перевірка граничних `sym`-рівнів уточнила ризики routing-порогу:

- `sym=4`, `k8s-tree.mjs`: локальна документація загалом прийнятна, але містила неправду про ігнорування `.git` і не описувала ключ кешу за сортованим списком аргументів.
- `sym=5`, `lint.mjs`: локальна версія вже дала хибну гарантію про return value і неправильний крок про `uv`.
- `sym=6`, `workflows.mjs`: детермінований скорер дав `100/100`, хоча документ містив масовий витік internal names, неправильний public API та хибну гарантію кешування.
- `sym=7`, `consistency.mjs`: локальна версія неповно описала умови помилки для version comparison і не згадала `registry-published`, `local-only`, `REGISTRY_DISABLED`.

Висновок transcript: `sym ≥ 5` виглядає більш консервативним щодо якості, але наявний поріг `sym ≥ 4` лишається безпечним conservative routing; `sym=4` є граничною зоною.

## Update 2026-06-06

Додано audit facts для docgen routing:

- `DEFAULT_SYM_THRESHOLD = 4` у `npm/skills/docgen/js/docgen-gen.mjs`.
- `extractFacts()` повертає `facts.internalSymbols[]` на Stage 0 без LLM-токенів.
- Routing формула: `facts.internalSymbols.length >= symThreshold ? 'cloud' : 'local'`.
- Аудит реального проєкту після виключення `npm/reports/**` і `npm/bin/**`: 241 файл.
- Розподіл `sym`: `0→81`, `1→40`, `2→17`, `3→51`, `4→44`.

Також зафіксовано, що `DOCGEN_IGNORE_GLOBS` має виключати `npm/bin/**`, бо `npm/bin/n-cursor.js` є зібраним бандлом, а не вихідним кодом для поведінкової документації.

## Update 2026-06-06

Фіналізовано двотировий routing у `docgen`:

- `sym ≥ 4` → cloud через Claude Sonnet.
- `sym < 4` → local через `gemma3:4b orchestrated`.
- `sym ∈ [2, 4)` → local + `cloudScoreDoc` Haiku judge і fallback при `score < QUALITY_THRESHOLD`.

Відхилені альтернативи з transcript:

- combo score `sym + exp*2 + imp`, бо `exp` має позитивну кореляцію з якістю (`+0.384`) і послаблює сигнал;
- deterministic scorer, бо після виправлення false positives мав bias `+35 пп` і пропустив критично зламаний `workflows.mjs`;
- LLM judge, бо мав bias `+25 пп` і займав `109s/файл`.

Implementation facts:

- `DEFAULT_SYM_THRESHOLD = 4` у `npm/skills/docgen/js/docgen-gen.mjs`.
- Pre-routing у `docgen-gen.mjs`: при complexity >= threshold і наявному cloud env викликається cloud path.
- `npm/bin/**` додано до `DOCGEN_IGNORE_GLOBS` у `npm/skills/docgen/js/docgen-ignore.mjs`, commit `6436a901`.
- Tier audit після виключення stryker/bin/tests: local `189` (78%), cloud `52` (22%).

## Update 2026-06-06

- Підтверджено поріг `sym ≥ 4` як pre-routing сигнал для docgen: transcript фіксує Pearson r = −0.651 між `sym` і якістю документації та split 78% local / 22% cloud на 241 файлі.
- Відхилено LLM-суддю як основний quality gate: transcript фіксує систематичний зсув оцінок і повільність (`109 с/файл`).
- Відхилено regex-based deterministic scorer як основний gate: після виправлення false-positive він все одно не ловив семантичні помилки.
- `npm/reports/**` і `npm/bin/**` мають бути виключені з docgen-аудиту: `npm/reports/stryker/.tmp/` дублює source-файли, а `npm/bin/n-cursor.js` є bundle, не джерельним кодом.

## Update 2026-06-06

- Для docgen зафіксовано routing: `sym ≥ 4` → cloud tier, `sym < 4` → local tier; transcript також згадує Haiku-referee/timeout для local-гілки.
- `combo = sym + exp*2 + imp` і `sym + imp` відхилено, бо `exp` має позитивну кореляцію з якістю (+0.384) і погіршує routing-сигнал.
- `sym=4` визнано граничною зоною: transcript містить приклад `k8s-tree.mjs` з якістю 90%, який все одно потрапляє у cloud за обраним порогом.
- Timeout local-generation 5 хв має ескалювати до Tier 2; transcript фіксує це як захист від зависань.
- `BORDERLINE_SYM_LOW` прибрано; Haiku-referee застосовується до `sym < 4` за описом драфта.

## Update 2026-06-06

- Для docgen підтверджено threshold `sym ≥ 4 → cloud`: `sym` має Pearson `r = −0.651` з якістю документації, сильніший сигнал за `exp` (`+0.384`) і `imp` (`−0.585`).
- Аудит проєкту після фільтрації показав 241 файл: `sym ≥ 4` дає 52 cloud-файли (22%), `sym < 4` — 189 local-файлів (78%).
- `commands.mjs` (`sym=15`) і `safety.mjs` (`sym=17`) у local-версії показали хибні гарантії й перевернуту семантику; `sym=5–7` також мав критичні семантичні помилки.
- Haiku-рефері для borderline local-файлів прибрано: у прогоні 52 local-файлів він жодного разу не тригерив ескалацію, мінімальний score був 80 при порозі 70.
- Нова схема: `sym < 4` → Tier 1 + deterministic `scoreDoc()` → `score < 70` або timeout `LOCAL_TIMEOUT_MS = 5 * 60 * 1000` → Tier 2; `sym ≥ 4` → Tier 2 одразу.
- Видалено `BORDERLINE_SYM_LOW`, `scoreModel`, `scoreCloud`, `cloudScoreDoc`; додано `withTimeout(promise, ms)`.
- `DOCGEN_IGNORE_GLOBS` доповнено `npm/reports/**` і `npm/bin/**`, щоб не документувати Stryker sandbox-дублікати та згенеровані bundle-артефакти.
- `generateDoc` повертає поле `model`, щоб batch-runner і CLI бачили фактичну модель генерації (`gemma3:4b` або `claude-sonnet-4-6`) без інспекції внутрішнього стану.

## Update 2026-06-06

Уточнення до docgen routing:

- Порогове правило: `sym >= 4` маршрутизується у Tier 2 cloud, `sym < 4` — у Tier 1 local.
- Для Tier 1 використовується `LOCAL_TIMEOUT_MS = 5 * 60 * 1000`; timeout ескалує файл у Tier 2.
- Haiku-рефері прибрано: після Tier 1 лишається deterministic `scoreDoc()` gate з ескалацією при score < 70.
- Transcript фіксує аналіз: `sym` мав найсильнішу кореляцію з якістю (Pearson r = −0.651), а Haiku-judge мав bias і високу latency.
