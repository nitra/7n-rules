---
session: d943f92b-e895-4110-8ae0-338380a03c95
captured: 2026-06-06T21:00:12+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/d943f92b-e895-4110-8ae0-338380a03c95.jsonl
---

Based on this transcript, I'll produce decision records for the durable design decisions made during this session.

---

## ADR Двотировий routing docgen: sym ≥ 4 → cloud, sym < 4 → local з 5-хв timeout і det-scorer gate

## Context and Problem Statement
У проєкті `@nitra/cursor` реалізовано docgen-пайплайн із двома тирами генерації документації: локальна модель `gemma3:4b` (Tier 1) і хмарна `claude-sonnet-4-6` (Tier 2). Потрібно визначити порогове значення складності файлу, за яким відбувається маршрутизація, і механізм контролю якості для Tier 1 — щоб уникнути надлишкових cloud-викликів і водночас не допустити семантично хибної документації.

## Considered Options
* `sym ≥ 4 → cloud` (обраний варіант)
* `sym ≥ 5 → cloud` (обговорювалось як альтернатива)
* Haiku як рефері після Tier 1 (розглядалось і відхилено)
* Детермінований скорер `scoreDoc()` як єдиний gate після Tier 1

## Decision Outcome
Chosen option: "`sym ≥ 4 → Tier 2; sym < 4 → Tier 1 + det-scorer + 5-хв timeout → ескалація при score < 70 або timeout`", because виміряний Pearson r = −0.651 між `sym` і якістю документації підтверджує, що внутрішні символи є найкращим одиночним предиктором. На реальних файлах: sym=4 (90% quality), sym=5 (80%, семантичні помилки), sym=6+ (критичні помилки — хибні інваріанти, витік внутрішніх імен у публічний API). Haiku-рефері прибраний — детермінований скорер (`scoreDoc`, 0 токенів) достатній як gate, оскільки за даними прогону жоден файл sym < 4 не мав score < 70.

### Consequences
* Good, because transcript фіксує очікувану користь: 241 файл проєкту розподіляється 189 (78%) local / 52 (22%) cloud — cost-ефективне покриття.
* Good, because детермінований скорер коштує 0 токенів і ловить структурні помилки (відсутній `## Огляд`, хибне кешування, короткий `## Поведінка`).
* Good, because 5-хвилинний `LOCAL_TIMEOUT_MS` запобігає зависанню — при перевищенні файл ескалується у Tier 2 без втрати покриття.
* Bad, because детермінований скорер не виявляє семантичних помилок (інвертована логіка версій, хибні гарантії) — це ризик для файлів у зоні sym=2–3.
* Bad, because Neutral, because transcript не містить підтвердження наслідку: чи буде ескалація Tier1→Tier2 регулярно спрацьовувати в реальному прогоні.

## More Information
- Реалізовано у `npm/skills/docgen/js/docgen-gen.mjs`: константи `DEFAULT_SYM_THRESHOLD = 4`, `LOCAL_TIMEOUT_MS = 5 * 60 * 1000`, функція `withTimeout`.
- Commit `668d1877`: видалення Haiku-рефері, додавання timeout та спрощення routing.
- Commit `2184724a`: поле `model` у return value `generateDoc` — показує реальну модель (Tier 1 або Tier 2).
- `npm/skills/docgen/js/docgen-ignore.mjs`: додано `npm/bin/**` поряд із вже наявним `npm/reports/**`.
- Batch-скрипт `/tmp/run_docgen_batch.mjs`: підсумок показує local / cloud (pre-routed) / ескаловано — з назвою моделі.
- Корельований аналіз: `sym` (r=−0.651), `exp` (r=+0.384), `imp` (r=−0.585) — sym є найсильнішим сигналом.

---

## ADR Прибрати Haiku як рефері якості docgen — залишити лише детермінований скорер

## Context and Problem Statement
Попередня версія docgen використовувала `cloudScoreDoc` (Claude Haiku) як рефері для borderline-файлів (`sym ∈ [2, 4)`): після Tier 1 локальної генерації відправляла код + документ у Haiku для оцінки 0–10 і при score < 70 ескалювала у Tier 2. Тривав пошук оптимального balance між вартістю (API-виклики), часом (Haiku ~109s avg) і якістю gate.

## Considered Options
* Haiku як рефері після Tier 1 для sym ∈ [2, 4)
* Детермінований `scoreDoc()` як єдиний gate (обраний варіант)
* Haiku як рефері для ВСІХ sym < 4 (розглядалось як проміжний крок)

## Decision Outcome
Chosen option: "Детермінований `scoreDoc()` як єдиний gate, Haiku прибраний", because Approach B (LLM-judge) показав систематичний bias +25pp, `no_leaks` завжди 9, середній час 109s — надто повільний і ненадійний. Детермінований скорер покриває структурні помилки (0 токенів, миттєво), а в реальному прогоні 52 local-файлів жоден не отримав score < 70 → ескалація Haiku не була б потрібна жодного разу.

### Consequences
* Good, because усуває залежність від Anthropic API для Tier 1 gate — локальний прогін не потребує мережі.
* Good, because transcript фіксує очікувану користь: зменшення latency і вартості без реального погіршення якості на поточному датасеті.
* Bad, because transcript не містить підтверджених негативних наслідків. Теоретичний ризик: семантично хибний документ (правдоподібний, але неправильний) пройде det-scorer і не буде ескальований.

## More Information
- Видалені з `docgen-gen.mjs`: параметри `scoreModel`, `scoreCloud`, константа `BORDERLINE_SYM_LOW`, функція `cloudScoreDoc`.
- Commit `668d1877` у репозиторії `cursor`.
- Approach B experiment: `~/docgen-bench3/judge_b.mjs` — bias +25pp задокументований у сесії.
