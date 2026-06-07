---
session: d943f92b-e895-4110-8ae0-338380a03c95
captured: 2026-06-06T21:39:48+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/d943f92b-e895-4110-8ae0-338380a03c95.jsonl
---

---
---

## ADR Спрощення tier-routing у docgen: видалення Haiku-рефері, додавання timeout і `model` у результаті

## Context and Problem Statement

Конвеєр `docgen-gen.mjs` мав три рівні quality gate для Tier 1 (local, gemma3:4b): det-scorer, `cloudScoreDoc` (Haiku як рефері), і pre-routing за `sym`. Haiku-рефері додавав вартість ($0.01–0.05/батч) і затримку без підтвердженої корисності: жодного ескалації не відбулось у прогоні з 52 файлів. Крім того, результат `generateDoc` не містив поля `model`, тому batch-summary не показував якою моделлю фактично опрацьовано кожен файл.

## Considered Options

* Залишити Haiku-рефері для sym ∈ [2, 4), прибрати тільки для sym < 2
* Замінити Haiku на "не порожня / timeout" перевірку
* Прибрати Haiku повністю, залишити det-scorer + timeout → Tier 2

## Decision Outcome

Chosen option: "Прибрати Haiku повністю, залишити det-scorer + timeout → Tier 2", because з 52 local-файлів мінімальний det-score = 80, поріг 70 не перетинав ніхто — Haiku не впливав на якість, але коштував токени.

### Consequences

* Good, because transcript фіксує очікувану користь: простіша схема, нульова вартість API при прогоні (Haiku-виклики прибрано).
* Bad, because якщо local модель поверне структурно зламаний результат зі score ∈ [70, 75), він пройде без хмарного перегляду — det-scorer може не вловити семантику.

## More Information

- `npm/skills/docgen/js/docgen-gen.mjs` — основний файл; коміти `668d1877` (routing), `2184724a` (model field)
- Видалено: `BORDERLINE_SYM_LOW`, `cloudScoreDoc`, `scoreModel`/`scoreCloud` параметри
- Додано: `LOCAL_TIMEOUT_MS = 5 * 60 * 1000`, `withTimeout()`, поле `model` у всіх return-об'єктах
- Схема: sym < 4 → Tier 1 local + det-scorer (≥70) + timeout → Tier 2; sym ≥ 4 → Tier 2 одразу

---

## ADR Міграція docgen на глобальні тири моделей (`npm/lib/models.mjs`) і `pi`-транспорт

## Context and Problem Statement

`docgen-gen.mjs` хардкодив назви моделей (`'gemma3:4b'`, `'claude-sonnet-4-6'`) і використовував Anthropic SDK напряму (`new Anthropic()`), тоді як ADR `260606-2124` зафіксував єдиний стандарт: глобальні тири `LOCAL_MIN`/`CLOUD_AVG` з `npm/lib/models.mjs` у форматі `provider/model-id` для `pi`-CLI. Розбіжність унеможливлювала централізовану заміну моделей через env-змінні.

## Considered Options

* Залишити Anthropic SDK, але стрипати `anthropic/`-префікс перед передачею в SDK
* Перейти на `pi`-транспорт (spawnSync) як у `llm-worker.mjs`

## Decision Outcome

Chosen option: "Перейти на `pi`-транспорт (spawnSync)", because `llm-worker.mjs` вже є reference implementation цього патерну; `pi` провайдер-нейтральний і підтримує `provider/model-id` формат без додаткового парсингу.

### Consequences

* Good, because transcript фіксує очікувану користь: централізований контроль моделей через `N_CURSOR_DOCGEN_MODEL` / `N_CURSOR_DOCGEN_CLOUD_MODEL` / `N_LOCAL_MIN_MODEL` / `N_CLOUD_AVG_MODEL`; Anthropic SDK прибрано з коду docgen.
* Bad, because `npm/scripts/coverage-classify/index.mjs` ще використовує Anthropic SDK напряму — залежність `@anthropic-ai/sdk` в `package.json` залишається до його міграції.

## More Information

- `npm/skills/docgen/js/docgen-gen.mjs` — коміт `abaeaa08`
- `npm/lib/models.mjs` — джерело тирів; `npm/skills/fix/js/llm-worker.mjs` — reference implementation `piOneShot`
- `localModelId()` helper — знімає `ollama/`-префікс для прямого HTTP-виклику ollama
- Per-skill overrides: `env.N_CURSOR_DOCGEN_MODEL ?? LOCAL_MIN`, `env.N_CURSOR_DOCGEN_CLOUD_MODEL ?? CLOUD_AVG`
- Перевірка доступності cloud: `cloudModel` (непорожній рядок) замість `env.ANTHROPIC_API_KEY`
