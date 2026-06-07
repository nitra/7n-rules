---
session: d943f92b-e895-4110-8ae0-338380a03c95
captured: 2026-06-06T21:42:41+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/d943f92b-e895-4110-8ae0-338380a03c95.jsonl
---

---

## ADR Видалення Haiku-рефері і спрощення tier-routing у docgen

## Context and Problem Statement

У docgen-конвеєрі існував трирівневий routing: sym < 2 йшов у Tier 1 без перевірки; sym ∈ [2, 4) йшов у Tier 1 з cloudScoreDoc (Haiku) як рефері; sym ≥ 4 — одразу Tier 2. Після додавання 5-хвилинного timeout і аналізу результатів виникло питання: чи потрібен Haiku як проміжна ланка, якщо det-scorer (0 токенів) і timeout вже вкривають основні сценарії відмови.

## Considered Options

* Зберегти Haiku-рефері для sym ∈ [2, 4) — поточна схема
* Прибрати Haiku, залишити лише det-scorer gate (score < 70 → Tier 2) + timeout → Tier 2
* Замінити Haiku на просту перевірку "не порожня" (відхилено раніше в transcript)

## Decision Outcome

Chosen option: "Прибрати Haiku, залишити det-scorer + timeout", because з 52 local-файлів у реальному прогоні мінімальний score = 80 і жодної ескалації не сталось; Haiku коштував додаткові API-виклики без зафіксованого впливу на якість, тоді як det-scorer є детермінованим і безкоштовним.

### Consequences

* Good, because transcript фіксує очікувану користь: менша вартість (виключено Haiku-виклики), простіша логіка routing без `BORDERLINE_SYM_LOW`, `scoreModel`, `scoreCloud`.
* Bad, because transcript не містить підтверджених негативних наслідків: зникає захист для файлів sym ∈ [2, 4), де local модель теоретично може повернути структурно коректний але семантично хибний документ, який det-scorer не відловить.

## More Information

Файли: `npm/skills/docgen/js/docgen-gen.mjs`. Коміт: `668d1877`. Видалено: `BORDERLINE_SYM_LOW`, `cloudScoreDoc`, `scoreModel`/`scoreCloud` параметри. Додано: `LOCAL_TIMEOUT_MS = 5 * 60 * 1000`, `withTimeout(promise, ms)`. Gate: `scoreDoc() < 70 || timeout → piOneShot(Tier 2)`.

---

## ADR Додавання поля `model` до результату `generateDoc`

## Context and Problem Statement

Batch-скрипт `/tmp/run_docgen_batch.mjs` виводив зведений рядок з кількістю local/cloud файлів, але не показував якою саме моделлю оброблено конкретний файл. При ескалації Tier 1 → Tier 2 файл рахувався в `localOk` незалежно від того, яка модель реально згенерувала документ.

## Considered Options

* Додати поле `model` до кожного return-об'єкту `generateDoc`
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome

Chosen option: "Додати поле `model` до кожного return-об'єкту `generateDoc`", because це єдиний спосіб зробити інформацію про модель доступною для caller без додаткового контексту.

### Consequences

* Good, because transcript фіксує очікувану користь: batch-скрипт показує модель у кожному рядку прогресу та у підсумку розрізняє ескальовані Tier1→Tier2 файли від pre-routed.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information

Файли: `npm/skills/docgen/js/docgen-gen.mjs`. Коміт: `2184724a`. Усі три return-шляхи (pre-routing, timeout, det-score gate) містять `model: cloudModel`; Tier 1 return містить `model` (local model string). Batch-скрипт: `stats.escalated` counter, `result.model` у рядку прогресу.

---

## ADR Міграція Tier 2 у docgen з Anthropic SDK на `pi` і глобальні тири моделей

## Context and Problem Statement

`docgen-gen.mjs` хардкодив `'gemma3:4b'` і `'claude-sonnet-4-6'` безпосередньо в коді та використовував `new Anthropic()` з `@anthropic-ai/sdk` для Tier 2-генерації. ADR `260606-2124` вимагає щоб усі скіли посилались на глобальні тири з `npm/lib/models.mjs` і використовували `pi` як провайдер-нейтральний transport — так само як `llm-worker.mjs`.

## Considered Options

* Залишити Anthropic SDK, просто підставити константи з models.mjs
* Замінити Anthropic SDK на `pi` transport (`spawnSync`) з провайдер-нейтральним форматом `provider/model-id`

## Decision Outcome

Chosen option: "Замінити Anthropic SDK на `pi` transport", because ADR явно вказує `llm-worker.mjs` як еталонний патерн, а формат `provider/model-id` у `models.mjs` призначений для `pi --model`, а не для Anthropic SDK напряму.

### Consequences

* Good, because transcript фіксує очікувану користь: можна перемикати cloud-провайдера через `N_CURSOR_DOCGEN_CLOUD_MODEL` без зміни коду; видалено `import Anthropic` і мертвий код `cloudScoreDoc`/`SCORE_RUBRIC` (−74 рядки).
* Bad, because transcript не містить підтверджених негативних наслідків: `spawnSync('pi', ...)` є blocking, тоді як попередній Anthropic SDK-виклик був async/streaming — для batch-сценарію різниця несуттєва, але для інтерактивного використання може додати latency.

## More Information

Файли: `npm/skills/docgen/js/docgen-gen.mjs`, `npm/lib/models.mjs`. Коміт: `abaeaa08`. Нові константи: `DEFAULT_LOCAL_MODEL = env.N_CURSOR_DOCGEN_MODEL ?? LOCAL_MIN`, `DEFAULT_CLOUD_MODEL = env.N_CURSOR_DOCGEN_CLOUD_MODEL ?? CLOUD_AVG`. Нова функція `piOneShot(facts, src, model)` використовує `spawnSync('pi', ['-p', fullPrompt, '--model', model, '--no-session', '--mode', 'text'])`. Перевірка доступності cloud: `cloudModel` (непорожній рядок) замість `env.ANTHROPIC_API_KEY`.
