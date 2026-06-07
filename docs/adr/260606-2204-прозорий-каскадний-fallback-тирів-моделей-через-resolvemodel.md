---
session: 8e669f3c-28f9-4b13-9f55-6a6ec894debe
captured: 2026-06-06T22:04:56+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/8e669f3c-28f9-4b13-9f55-6a6ec894debe.jsonl
---

Готово. Ось що зроблено:

## Зміни

### `npm/lib/models.mjs` — новий контракт + хелпер
Додано `resolveModel(tier)` з задокументованим каскадом:
- `'min'` → LOCAL_MIN → LOCAL_AVG → LOCAL_MAX → CLOUD_MIN
- `'avg'` → LOCAL_AVG → LOCAL_MAX → CLOUD_AVG
- `'max'` → LOCAL_MAX → CLOUD_MAX

### Оновлені споживачі
| Файл | Що змінено |
|---|---|
| `npm/scripts/coverage-classify/index.mjs` | Tier 1: `LOCAL_MIN` → `resolveModel('min')` |
| `npm/skills/fix/js/llm-worker.mjs` | `CLOUD_MIN`/`CLOUD_AVG` → `resolveModel('min'/'avg')` |
| `npm/scripts/coverage-fix.mjs` | `CLOUD_MAX` → `resolveModel('max')` |
| `npm/scripts/dispatcher/lib/subagent-runner.mjs` | `CLOUD_AVG` → `resolveModel('avg')` |
| `npm/skills/docgen/js/docgen-gen.mjs` | `CLOUD_AVG` → `resolveModel('avg')` (LOCAL_MIN залишено — іде в ollama HTTP) |

Change-файл: `npm/.changes/260606-2204.md`

---
[end of transcript]

## ADR Прозорий каскадний fallback тирів моделей через `resolveModel(tier)`

## Context and Problem Statement

Система мала 6 глобальних змінних тирів (`N_LOCAL_MIN_MODEL`, `N_LOCAL_AVG_MODEL`, `N_LOCAL_MAX_MODEL`, `N_CLOUD_MIN_MODEL`, `N_CLOUD_AVG_MODEL`, `N_CLOUD_MAX_MODEL`), проте споживачі звертались до сирих констант безпосередньо. Якщо локальна модель не налаштована (змінна порожня), виклики провалювались без fallback-у — система не могла прозоро деградувати до cloud-тиру.

## Considered Options

* Додати хелпер `resolveModel(tier)` у `npm/lib/models.mjs` із задокументованим каскадом fallback-ів та замінити прямі константи у всіх споживачах
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome

Chosen option: "Додати `resolveModel(tier)` у `npm/lib/models.mjs` із каскадом fallback-ів", because користувач сформулював точний каскад і вимагав зафіксувати його як контракт проєкту та реалізувати єдину точку вирішення моделі замість розкиданих прямих звернень до констант.

Каскад зафіксований у коді:
- `'min'` → `LOCAL_MIN` → `LOCAL_AVG` → `LOCAL_MAX` → `CLOUD_MIN`
- `'avg'` → `LOCAL_AVG` → `LOCAL_MAX` → `CLOUD_AVG`
- `'max'` → `LOCAL_MAX` → `CLOUD_MAX`

### Consequences

* Good, because система штатно відпрацьовує навіть без локальних моделей — `resolveModel('min')` прозоро поверне перший доступний тир аж до `CLOUD_MIN`.
* Good, because transcript фіксує очікувану користь: усі 5 споживачів (`coverage-classify`, `llm-worker`, `coverage-fix`, `subagent-runner`, `docgen-gen`) отримали єдиний механізм вирішення моделі.
* Bad, because у `docgen-gen.mjs` `LOCAL_MIN` для ollama HTTP-виклику залишено незмінним — `resolveModel('min')` там не застосовується, щоб уникнути передачі cloud-ідентифікатора в ollama API. Це виняток із загального правила, якого треба дотримуватись при майбутніх змінах.

## More Information

Змінені файли:
- `npm/lib/models.mjs` — додано `resolveModel(tier)` та документацію каскаду
- `npm/scripts/coverage-classify/index.mjs` — Tier 1: `LOCAL_MIN` → `resolveModel('min')`; кеш-ключ оновлено
- `npm/skills/fix/js/llm-worker.mjs` — `CLOUD_MIN`/`CLOUD_AVG` → `resolveModel('min')`/`resolveModel('avg')`
- `npm/scripts/coverage-fix.mjs` — `CLOUD_MAX` → `resolveModel('max')`
- `npm/scripts/dispatcher/lib/subagent-runner.mjs` — `CLOUD_AVG` → `resolveModel('avg')`
- `npm/skills/docgen/js/docgen-gen.mjs` — `CLOUD_AVG` → `resolveModel('avg')` (виняток: `LOCAL_MIN` збережено для ollama HTTP)

Change-файл: `npm/.changes/260606-2204.md` (bump: minor, section: Added).
