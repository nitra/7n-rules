---
session: 8e669f3c-28f9-4b13-9f55-6a6ec894debe
captured: 2026-06-07T05:38:38+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/8e669f3c-28f9-4b13-9f55-6a6ec894debe.jsonl
---

## ADR Каскадний fallback для tier-моделей

## Context and Problem Statement
Проект використовує 6 глобальних змінних середовища для вибору моделей: `N_LOCAL_MIN_MODEL`, `N_LOCAL_AVG_MODEL`, `N_LOCAL_MAX_MODEL`, `N_CLOUD_MIN_MODEL`, `N_CLOUD_AVG_MODEL`, `N_CLOUD_MAX_MODEL`. Якщо локальні змінні не задані, системи, що жорстко покладаються на `LOCAL_MIN` чи інші константи, отримують порожній рядок і аварійно завершуються. Потрібно, щоб система прозоро деградувала до наступного доступного тиру.

## Considered Options
* Жорстке використання конкретних констант (поточний стан)
* Каскадний `resolveModel(tier)` з автоматичним fallback по ланцюжку

## Decision Outcome
Chosen option: "Каскадний `resolveModel(tier)` з автоматичним fallback по ланцюжку", because без локальних моделей система повинна прозоро працювати; fallback-ланцюжок закріплений у контракті: `min` → LOCAL\_MIN → LOCAL\_AVG → LOCAL\_MAX → CLOUD\_MIN, `avg` → LOCAL\_AVG → LOCAL\_MAX → CLOUD\_AVG, `max` → LOCAL\_MAX → CLOUD\_MAX.

### Consequences
* Good, because система працює навіть коли жодна `N_LOCAL_*_MODEL` не задана — автоматично відпадає до cloud.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Функція `resolveModel(tier)` додана в `npm/lib/models.mjs`. Оновлені споживачі: `npm/scripts/coverage-classify/index.mjs` (Tier 1 `LOCAL_MIN` → `resolveModel('min')`), `npm/skills/fix/js/llm-worker.mjs` (`CLOUD_MIN`/`CLOUD_AVG` → `resolveModel('min')`/`resolveModel('avg')`), `npm/scripts/coverage-fix.mjs` (`CLOUD_MAX` → `resolveModel('max')`), `npm/scripts/dispatcher/lib/subagent-runner.mjs` (`CLOUD_AVG` → `resolveModel('avg')`), `npm/skills/docgen/js/docgen-gen.mjs` (`CLOUD_AVG` → `resolveModel('avg')`). Change-файли: `npm/.changes/260606-2204.md`.

---

## ADR Заміна прямого ollama HTTP на `pi` у docgen Tier 1

## Context and Problem Statement
У `docgen-gen.mjs` Tier 1 (локальна генерація) використовував прямий HTTP до ollama (`localhost:11434/api/chat`) зі стрімінгом і специфічними параметрами (`num_ctx`, `keep_alive`, `num_predict`). Це робило Tier 1 несумісним з `resolveModel('min')` — якщо `resolveModel('min')` повертав cloud-модель, вона передавалась в ollama HTTP і аварійно завершувалась. Для уніфікації запропоновано перевести Tier 1 на `pi` — так само, як Tier 2.

## Considered Options
* Зберегти прямий ollama HTTP для Tier 1 (стрімінг, тонкий контроль параметрів)
* Перейти на `pi` для Tier 1: `resolveModel('min')` → `spawnSync('pi', ...)` з фіксованим таймаутом

## Decision Outcome
Chosen option: "Перейти на `pi` для Tier 1", because це дозволяє прибрати 142 рядки коду (функції `ollamaChat`, `withTimeout`, `generateOrchestrated`, `generateOneShot`, `assemble`, `localModelId`, імпорт `node:http`) і уніфікувати обидва тири під `resolveModel()`.

### Consequences
* Good, because transcript фіксує очікувану користь: -142 рядки, уніфікація обох тирів під `resolveModel()`, усунення несумісності з cloud-fallback.
* Bad, because втрачається стрімінг та ollama-специфічні параметри (`num_ctx: 8192`, `keep_alive: '15m'`, `num_predict: 600`); таймаут стає жорстким (через `spawnSync timeout`), а не сокет-подією; секційно-оркестрований режим (`generateOrchestrated`) виключений повністю.

## More Information
Змінений файл: `npm/skills/docgen/js/docgen-gen.mjs`. Diff-статистика: 167 рядків змінено (25 додано, 142 видалено). Change-файл: `npm/.changes/260607-0537.md`.
