---
session: d943f92b-e895-4110-8ae0-338380a03c95
captured: 2026-06-06T20:35:18+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/d943f92b-e895-4110-8ae0-338380a03c95.jsonl
---

/n-adr-normalize

---

## ADR Спрощення tier-routing у docgen: прибрати Haiku-рефері, додати таймаут

## Context and Problem Statement
Конвеєр `generateDoc` мав три рівні routing: `sym < BORDERLINE_SYM_LOW` (Tier 1 без рефері), `sym ∈ [BORDERLINE_SYM_LOW, 4)` (Tier 1 + Haiku як рефері), `sym ≥ 4` (Tier 2 pre-routing). Haiku-рефері додавав ~109s і API-вартість на кожен borderline-файл, але в реальних прогонах (52 local-файли) жодного разу не тригерував ескалацію — мінімальний score был 80 при порозі 70. Водночас локальна генерація не мала таймауту, що могло б спричинити зависання.

## Considered Options
* Зберегти Haiku-рефері для sym ∈ [BORDERLINE_SYM_LOW, 4)
* Прибрати Haiku, залишити тільки det-scorer + таймаут → Tier 2

## Decision Outcome
Chosen option: "Прибрати Haiku, залишити тільки det-scorer + таймаут → Tier 2", because benchmark показав, що Haiku-рефері ні разу не тригерував ескалацію на реальних даних проєкту, а det-scorer (0 токенів) покриває структурні помилки без API-витрат.

### Consequences
* Good, because transcript фіксує очікувану користь: Haiku-виклики прибрані повністю → менша вартість і менша латентність на local-файлах; таймаут 5 хв запобігає зависанню.
* Bad, because якщо локальна модель поверне структурно коректний але семантично хибний текст (score ≥ 70 у det-scorer) — він пройде в продакшн без додаткової перевірки. Transcript не містить підтверджених негативних наслідків на реальних даних.

## More Information
Змінені файли: `npm/skills/docgen/js/docgen-gen.mjs`.
Видалені константи: `BORDERLINE_SYM_LOW`, параметри `scoreModel`, `scoreCloud`.
Додані константи: `LOCAL_TIMEOUT_MS = 5 * 60 * 1000`.
Нова функція `withTimeout(promise, ms)`.
Фінальна схема: `sym < 4` → Tier 1 + det-scorer → score < 70 або timeout → Tier 2; `sym ≥ 4` → Tier 2 одразу.
Commits: `668d1877`, `2184724a`.

---

## ADR sym ≥ 4 як threshold для cloud tier у docgen

## Context and Problem Statement
Локальна модель `gemma3:4b` виробляє документацію неприйнятної якості для файлів із великою кількістю внутрішніх символів: плутає internal vs public API, видає тавтологічні або хибні гарантії. Потрібен детермінований сигнал для маршрутизації між local і cloud без LLM-суддів.

## Considered Options
* `sym ≥ 5` → cloud (threshold вищий, менше cloud-файлів)
* `sym ≥ 4` → cloud (обраний поріг)
* Підхід B — LLM-суддя (Haiku оцінює готову доку проти коду)
* Підхід A — детермінований scorer

## Decision Outcome
Chosen option: "`sym ≥ 4` → cloud", because `sym` (кількість внутрішніх символів) має Pearson r = −0.651 з якістю документації — найсильніший одиночний предиктор; поріг 4 підтверджений на реальних файлах: sym=4 ще проходить local (90%), sym=5–7 показують критичні семантичні помилки.

### Consequences
* Good, because transcript фіксує очікувану користь: 78% файлів проєкту (189/241) залишаються local; критичні помилки (хибні гарантії, перевернута логіка, Internal → Public плутанина) відсікаються на cloud-tier.
* Bad, because sym=4 є граничним рівнем — 12 файлів потрапляють у cloud, тоді як local дає ~90% якості для них. Transcript не містить підтверджених негативних наслідків цього рішення.

## More Information
Дослідницькі файли: `~/docgen-bench3/complexity.mjs`, `~/docgen-bench3/tier_audit.mjs`.
Кореляції: `sym` r=−0.651, `exp` r=+0.384, `imp` r=−0.585.
Аудит проєкту: 241 файл, sym≥4 → 52 cloud (22%), sym<4 → 189 local (78%).
Реальне підтвердження: `commands.mjs` (sym=15) і `safety.mjs` (sym=17) через git diff показали хибні гарантії і перевернуту семантику в local-версії.
Константа `DEFAULT_SYM_THRESHOLD = 4` у `npm/skills/docgen/js/docgen-gen.mjs:231`.

---

## ADR npm/bin/** та npm/reports/** у DOCGEN_IGNORE_GLOBS

## Context and Problem Statement
`docgen-scan.mjs` обходив `npm/reports/stryker/.tmp/sandbox-*/` — 4 копії кожного файлу проєкту для Stryker-мутаційного тестування — і `npm/bin/` (скомпільовані артефакти). Це призводило до інфляції аудиту (938 файлів замість 241) і генерації доків для дублікатів.

## Considered Options
* Додати `npm/reports/**` і `npm/bin/**` до `DOCGEN_IGNORE_GLOBS`
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Додати `npm/reports/**` і `npm/bin/**` до `DOCGEN_IGNORE_GLOBS`", because stryker-сендбокси не є вихідним кодом і документувати їх безглуздо; `npm/bin/**` містить згенеровані файли, а не джерело.

### Consequences
* Good, because transcript фіксує очікувану користь: аудит коректно показує 241 файл замість 938; docgen не витрачає ресурси на дублікати.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Змінений файл: `npm/skills/docgen/js/docgen-ignore.mjs` — додано `'npm/reports/**'` і `'npm/bin/**'` до масиву `DOCGEN_IGNORE_GLOBS`.
Commit: `6436a901`.

---

## ADR Поле `model` у результаті generateDoc

## Context and Problem Statement
Batch-скрипт і зовнішні споживачі `generateDoc` не могли визначити, яка модель реально згенерувала документ — Tier 1 (gemma3:4b) чи Tier 2 (claude-sonnet-4-6). Це ускладнювало підсумкову статистику і відлагодження.

## Considered Options
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Додати поле `model` до return value `generateDoc`", because споживачу (batch-runner, CLI) потрібно знати реальну модель без інспекції внутрішнього стану.

### Consequences
* Good, because transcript фіксує очікувану користь: batch-summary показує `[gemma3:4b]` або `[claude-sonnet-4-6]` для кожного файлу; поле доступне для будь-якого downstream споживача.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Змінений файл: `npm/skills/docgen/js/docgen-gen.mjs` — кожен `return` тепер містить `model: string`.
Commit: `2184724a`.
