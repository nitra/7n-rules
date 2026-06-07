---
session: 8e669f3c-28f9-4b13-9f55-6a6ec894debe
captured: 2026-06-07T05:55:17+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/8e669f3c-28f9-4b13-9f55-6a6ec894debe.jsonl
---

Рекомендую відкотити і залишити ollama HTTP для Tier 1. Підтверди і відкочу.
---
[END OF TRANSCRIPT]

## ADR Каскадний fallback для tier-моделей через `resolveModel(tier)`

## Context and Problem Statement
У проєкті зафіксовано 6 глобальних тирів (`N_LOCAL_MIN_MODEL`, `N_LOCAL_AVG_MODEL`, `N_LOCAL_MAX_MODEL`, `N_CLOUD_MIN_MODEL`, `N_CLOUD_AVG_MODEL`, `N_CLOUD_MAX_MODEL`), але система не мала механізму прозорого fallback, коли локальні змінні не встановлені. Виклики у `coverage-classify`, `llm-worker`, `coverage-fix`, `subagent-runner` та `docgen-gen` напряму посилалися на конкретні константи (наприклад, `CLOUD_MIN`, `LOCAL_MIN`) і не деградували штатно за відсутності локальних моделей.

## Considered Options
* Додати `resolveModel(tier)` — helper у `npm/lib/models.mjs`, що реалізує каскад; замінити сирі константи у всіх споживачах
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Додати `resolveModel(tier)` у `npm/lib/models.mjs`", because користувач прямо сформулював вимогу каскадного fallback і попросив зафіксувати це у контракті проєкту та створити helper для заміни всіх прямих викликів.

Каскад:
```
resolveModel('min') → N_LOCAL_MIN_MODEL → N_LOCAL_AVG_MODEL → N_LOCAL_MAX_MODEL → N_CLOUD_MIN_MODEL
resolveModel('avg') → N_LOCAL_AVG_MODEL → N_LOCAL_MAX_MODEL → N_CLOUD_AVG_MODEL
resolveModel('max') → N_LOCAL_MAX_MODEL → N_CLOUD_MAX_MODEL
```

### Consequences
* Good, because transcript фіксує очікувану користь: система штатно відпрацьовує навіть коли жодна `N_LOCAL_*_MODEL` не встановлена — `resolveModel` прозоро переходить на хмарний тир.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Змінені файли:
- `npm/lib/models.mjs` — додано `resolveModel(tier)` та оновлено JSDoc-контракт
- `npm/scripts/coverage-classify/index.mjs` — `LOCAL_MIN` замінено на `resolveModel('min')` у Tier 1 та кеш-ключі
- `npm/skills/fix/js/llm-worker.mjs` — `CLOUD_MIN`, `CLOUD_AVG` замінено на `resolveModel('min')`, `resolveModel('avg')`
- `npm/scripts/coverage-fix.mjs` — `CLOUD_MAX` замінено на `resolveModel('max')`
- `npm/scripts/dispatcher/lib/subagent-runner.mjs` — `CLOUD_AVG` замінено на `resolveModel('avg')`
- `npm/skills/docgen/js/docgen-gen.mjs` — `CLOUD_AVG` (Tier 2 pi) замінено на `resolveModel('avg')`; `LOCAL_MIN` для ollama HTTP залишено без змін (локальний HTTP-шлях, cloud-модель там не застосовна)

Виняток: у `docgen-gen.mjs` Tier 1 `LOCAL_MIN` передається напряму в ollama HTTP (`localhost:11434/api/chat`) і не може мати cloud-значення — тому цей виклик виведено з-під каскаду.

Change-файл: `npm/.changes/260606-2204.md` (bump: minor, section: Added).

---

## ADR Бамп major-версії через change-файл, а не пряме редагування

## Context and Problem Statement
Інші варіанти в transcript не обговорювалися.

## Considered Options
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "`n-cursor change --bump minor --section Added --message ...`", because у transcript фіксується явна послідовність: кожна зміна завершується командою `n-cursor change`, а не ручним редагуванням `CHANGELOG` або `package.json`.

### Consequences
* Good, because transcript фіксує очікувану користь: зміни версій і CHANGELOG не редагуються вручну — CI/CD виконує bump.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Команди, виконані у transcript:
```sh
n-cursor change --bump minor --section Added --message "resolveModel(tier) — прозорий каскадний fallback local→cloud для всіх 3 тирів (min/avg/max)" --ws npm
n-cursor change --bump minor --section Changed --message "docgen Tier 1: пряму ollama HTTP замінено на pi+resolveModel('min') — universally через каскад" --ws npm
```
Детальніше: `.cursor/rules/n-changelog.mdc`.

---

## ADR Експеримент: заміна ollama HTTP на pi у docgen Tier 1

## Context and Problem Statement
Після впровадження `resolveModel('min')` Tier 1 у `docgen-gen.mjs` залишав прямий HTTP-виклик до ollama (`localhost:11434/api/chat`) з ollama-специфічними параметрами (`num_ctx`, `temperature`, `keep_alive`, `num_predict`) і orchestrated-режимом (генерація по секціях). Постало питання: чи можна спростити код, перевівши Tier 1 на `pi` (як Tier 2), що дало б використання `resolveModel('min')` і universal provider-routing.

## Considered Options
* Замінити прямий ollama HTTP + orchestrated на `piOneShot(resolveModel('min'), timeout)` — видалити `ollamaChat`, `localModelId`, `withTimeout`, `sectionMessages`, `generateOrchestrated`, `generateOneShot`, `assemble`, `import { request } from 'node:http'`
* Зберегти поточну ollama HTTP + orchestrated архітектуру (статус-кво)
* Реалізувати orchestrated-режим через pi (N окремих `spawnSync` по секціях)

## Decision Outcome
Chosen option: "Провести вимірювання до ухвалення рішення", because transcript завершується після отримання benchmark-даних без підтвердженого вибору фінального варіанта.

Результати бенчмарку (два Tier 1 файли, `sym < 4`):

| Версія | Файл | Час | Score | Проблеми |
|---|---|---|---|---|
| OLD ollama HTTP + orchestrated | discover-check-rules-from-cursor.mjs | 44s | **100** | — |
| OLD ollama HTTP + orchestrated | trufflehog.mjs | 47s | **100** | — |
| NEW pi + `ollama/gemma3:4b` | discover-check-rules-from-cursor.mjs | 51s | 75 | no-overview |
| NEW pi + `ollama/gemma3:4b` | trufflehog.mjs | 35s | 65 | no-overview, internal-name |
| NEW pi + cloud-дефолт | discover-check-rules-from-cursor.mjs | **12s** | 75 | no-overview |
| NEW pi + cloud-дефолт | trufflehog.mjs | **12s** | 75 | no-overview |

Регресія якості (`100 → 65–75`) зумовлена не транспортним шаром, а втратою orchestrated-підходу (секційні промпти з `num_predict` + `temperature=0.2` гарантували присутність `## Огляд`).

### Consequences
* Good, because transcript фіксує очікувану користь: pi + cloud-дефолт у 3-4× швидший (12s vs 44-47s) і код скорочується на 142 рядки.
* Bad, because transcript фіксує підтверджений негативний наслідок: score Tier 1 падає з 100 до 65-75, секція `## Огляд` стабільно відсутня у one-shot режимі через pi.

## More Information
Файл експерименту: `npm/skills/docgen/js/docgen-gen.mjs`.
Збережена копія нової версії: `/tmp/docgen-gen-new.mjs` (тимчасово).
Тестові файли: `npm/scripts/lib/discover-check-rules-from-cursor.mjs` (sym=0), `npm/rules/security/js/trufflehog.mjs` (sym=2).
Ollama запущена локально: моделі `gemma3:4b`, `gemma4:4b`.
Рішення про відкат або прийняття у transcript не підтверджено.
