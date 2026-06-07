---
session: d943f92b-e895-4110-8ae0-338380a03c95
captured: 2026-06-06T22:00:29+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/d943f92b-e895-4110-8ae0-338380a03c95.jsonl
---

Ось ADR, що відображає ключові архітектурні рішення з цієї сесії:

## ADR Видалення Haiku-рефері та спрощення tier-routing у docgen

## Context and Problem Statement
У `npm/skills/docgen/js/docgen-gen.mjs` існував трирівневий routing: sym < 2 → Tier 1 без рефері, sym ∈ [2, 4) → Tier 1 + Haiku-рефері, sym ≥ 4 → Tier 2. Haiku-виклик додавав API-витрати й затримку, але не усував ризик що Tier 1 повертає плausible-but-wrong текст.

## Considered Options
* Залишити Haiku як рефері між Tier 1 і Tier 2
* Прибрати Haiku, використовувати лише det-scorer + timeout як gate перед Tier 2

## Decision Outcome
Chosen option: "Прибрати Haiku, використовувати лише det-scorer + timeout", because det-scorer (0 токенів) достатній як структурний gate — Haiku додавав вартість без суттєвого покращення якості routing.

### Consequences
* Good, because transcript фіксує очікувану користь: нульова вартість gate-у, спрощена логіка (усунуто `cloudScoreDoc`, `BORDERLINE_SYM_LOW`, `scoreModel` параметр).
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Файл: `npm/skills/docgen/js/docgen-gen.mjs`. Commit `668d1877`. Gate-логіка: `scoreDoc()` < 70 або `withTimeout(localPromise, 5 * 60 * 1000)` → ескалація до Tier 2.

---

## ADR Додавання поля `model` до результату `generateDoc`

## Context and Problem Statement
Batch-скрипт `/tmp/run_docgen_batch.mjs` не міг показати якою моделлю реально оброблено кожен файл — поле відсутнє у return value `generateDoc`, а файли з Tier 1 що ескалювались у Tier 2 некоректно рахувались у `stats.localOk`.

## Considered Options
* Додати `model` до всіх return objects у `generateDoc`
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Додати `model` до всіх return objects у `generateDoc`", because дозволяє batch-скрипту та іншим caller-ам бачити яка модель реально згенерувала документ без доступу до внутрішньої логіки routing.

### Consequences
* Good, because transcript фіксує очікувану користь: batch-скрипт показує модель у кожному рядку прогресу і в підсумковій статистиці; `stats.escalated` коректно відстежує Tier1→Tier2 ескалації.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Commit `2184724a`. Три return-точки у `generateDoc`: pre-routing (`model: cloudModel`), local-timeout (`model: cloudModel`), det-score fallback (`model: cloudModel`), Tier 1 success (`model`). Batch stats: `{ ok, err, localOk, cloudOk, escalated }`.

---

## ADR Спрощення tier-routing у docgen — видалення Haiku-рефері, додавання 5-хв timeout

## Context and Problem Statement
Після видалення Haiku routing містив sym-threshold (4) і det-scorer, але не мав верхнього ліміту часу на локальну генерацію — файл міг зависнути без ескалації.

## Considered Options
* `withTimeout(promise, LOCAL_TIMEOUT_MS)` → ескалація на Tier 2
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "`withTimeout` з `LOCAL_TIMEOUT_MS = 5 * 60 * 1000`", because timeout є єдиним надійним захистом від зависання локальної моделі; після timeout ескалація на Tier 2 зберігає документацію.

### Consequences
* Good, because transcript фіксує очікувану користь: гарантований upper-bound на час обробки одного файлу.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
`withTimeout` реалізований через `Promise.race`. `LOCAL_TIMEOUT_MS = 5 * 60 * 1000`. При timeout: `issues: ['local-timeout: ...']`, `tier: 2`.

---

## ADR Повна міграція docgen, coverage-classify, coverage-fix та subagent-runner на pi з глобальними тирами моделей

## Context and Problem Statement
Проєкт мав прямі залежності на `@anthropic-ai/sdk` (в `docgen-gen.mjs` і `coverage-classify`) та `@anthropic-ai/claude-agent-sdk` (в `coverage-fix.mjs` і `subagent-runner.mjs`). Це прив'язувало вибір моделей до конкретного провайдера і не відповідало ADR `260606-2124`, яке вимагає використовувати глобальні тири `N_LOCAL_*`/`N_CLOUD_*` через `pi`.

## Considered Options
* Замінити Anthropic SDK на `pi` transport з `LOCAL_MIN`/`CLOUD_AVG` з `npm/lib/models.mjs`
* Залишити SDK, але стрипувати provider-префікс при передачі моделі (provider-locked)
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Замінити Anthropic SDK на `pi` transport", because лише pi-підхід є провайдер-нейтральним — `N_LOCAL_MIN_MODEL=ollama/gemma3:4b` і `N_CLOUD_MIN_MODEL=openai/gpt-5.4-mini` дають однакову поведінку без змін коду.

### Consequences
* Good, because transcript фіксує очікувану користь: нульова залежність від Anthropic SDK; модель обирається через env vars; per-skill override через `N_CURSOR_DOCGEN_MODEL` / `N_CURSOR_DOCGEN_CLOUD_MODEL`.
* Bad, because `spawnSync('pi', ...)` є синхронним — `Promise.all` в `review.mjs` не дає реального паралелізму. Neutral, because transcript не містить підтвердження наслідку для продуктивності review.

## More Information
Файли змінені: `npm/skills/docgen/js/docgen-gen.mjs`, `npm/scripts/coverage-classify/index.mjs`, `npm/scripts/coverage-fix.mjs`, `npm/scripts/dispatcher/lib/subagent-runner.mjs`. Видалено з `npm/package.json`: `@anthropic-ai/sdk`, `@anthropic-ai/claude-agent-sdk`. Commits: `abaeaa08` (docgen), `1279b3f7` (coverage-fix/subagent-runner), `b90ad6b9` (package.json cleanup). Runner-контракт збережено: `{ backend: 'pi', runStep(prompt, { cwd }) → Promise<{ ok, output }> }`.

---

## ADR Двотирове routing у coverage-classify: LOCAL_MIN → CLOUD_MIN

## Context and Problem Statement
Класифікатор мутантів `coverage-classify` викликав `claude-sonnet-4-6` для кожного мутанта. Більшість мутантів (`glue`, `wrapper`) не вимагають складного семантичного аналізу і можуть бути класифіковані локальною моделлю.

## Considered Options
* Тільки `LOCAL_MIN` (gemma3:4b) — ризик для `equivalent`/`defensive` категорій
* `LOCAL_MIN` → при помилці парсингу → `CLOUD_MIN` (двотирове routing)
* `CLOUD_MIN` напряму (без локального тиру)
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "`LOCAL_MIN` → при помилці парсингу → `CLOUD_MIN`", because більшість мутантів прості й виграють від локального (безкоштовного) тиру; складні `equivalent`/`defensive` які провалюють JSON/Zod валідацію ескалюються на cloud.

### Consequences
* Good, because transcript фіксує очікувану користь: нульова вартість для простих мутантів; `CLOUD_MIN` дешевший за попередній `CLOUD_AVG` (Sonnet) для складних.
* Bad, because локальна модель може повернути семантично неправильний але структурно валідний verdict — ескалація не спрацює. Neutral, because transcript не містить підтвердження частоти таких хибних verdicts.

## More Information
Gate: `parseVerdict()` (JSON parse + Zod validation). Cache key: `${LOCAL_MIN}+${CLOUD_MIN}` — інвалідується при зміні будь-якого тиру. `FALLBACK_VERDICT = { category: 'worth-testing', confidence: 0 }`. Injection: `opts.callPi` для тестів. Commit `1279b3f7`.
