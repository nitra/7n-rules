---
session: 8e669f3c-28f9-4b13-9f55-6a6ec894debe
captured: 2026-06-07T05:55:28+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/8e669f3c-28f9-4b13-9f55-6a6ec894debe.jsonl
---

## ADR Каскадний fallback для tier-моделей через `resolveModel(tier)`

## Context and Problem Statement
У проєкті зафіксовано 6 глобальних env-змінних для тирів моделей (`N_LOCAL_MIN_MODEL`, `N_LOCAL_AVG_MODEL`, `N_LOCAL_MAX_MODEL`, `N_CLOUD_MIN_MODEL`, `N_CLOUD_AVG_MODEL`, `N_CLOUD_MAX_MODEL`). Якщо локальні змінні не встановлені, споживачі (`coverage-classify`, `fix/llm-worker`, `coverage-fix`, `subagent-runner`, `docgen-gen`) зверталися напряму до raw-констант і могли отримати порожній рядок, що призводило до непередбачуваної поведінки при відсутності локальних моделей.

## Considered Options
* Додати `resolveModel(tier)` — хелпер-функцію з прозорим каскадом `local→cloud` в `npm/lib/models.mjs`
* Залишити raw-константи і покласти відповідальність на кожного споживача
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Додати `resolveModel(tier)` — хелпер-функцію з прозорим каскадом", because система повинна штатно відпрацьовувати навіть без локальних моделей — `resolveModel` інкапсулює всю логіку fallback і усуває дублювання в кожному споживачі.

Каскад, зафіксований у контракті:
```
resolveModel('min') → LOCAL_MIN → LOCAL_AVG → LOCAL_MAX → CLOUD_MIN
resolveModel('avg') → LOCAL_AVG → LOCAL_MAX → CLOUD_AVG
resolveModel('max') → LOCAL_MAX → CLOUD_MAX
```

### Consequences
* Good, because transcript фіксує очікувану користь: система працює прозоро без `N_LOCAL_*_MODEL` у середовищі — усі 5 споживачів замінили raw-константи на `resolveModel()`.
* Bad, because `docgen-gen.mjs` Tier 1 (`LOCAL_MIN`) залишено без змін — там значення іде напряму в ollama HTTP API (не через `pi`), тому cloud-модель зламає виклик. Виняток зафіксований явно у коді.

## More Information
Змінені файли: `npm/lib/models.mjs`, `npm/scripts/coverage-classify/index.mjs`, `npm/skills/fix/js/llm-worker.mjs`, `npm/scripts/coverage-fix.mjs`, `npm/scripts/dispatcher/lib/subagent-runner.mjs`, `npm/skills/docgen/js/docgen-gen.mjs`. Change-файл: `npm/.changes/260606-2204.md`.

---

## ADR Відмова від заміни ollama HTTP на `pi` для docgen Tier 1

## Context and Problem Statement
Після введення `resolveModel(tier)` постало питання: чи варто уніфікувати Tier 1 в `docgen-gen.mjs` — замінити пряму ollama HTTP-стрімінг логіку на `piOneShot(resolveModel('min'), ...)`, щоб усунути ~140 рядків специфічного коду та зробити маршрутизацію модулів однорідною.

## Considered Options
* Замінити ollama HTTP + orchestrated на `piOneShot(resolveModel('min'))` — один режим через `pi` для обох тирів
* Залишити ollama HTTP + orchestrated mode для Tier 1

## Decision Outcome
Chosen option: "Залишити ollama HTTP + orchestrated mode для Tier 1", because бенчмарк показав регресію якості з score=100 до score=65–75 при переході на one-shot через `pi` з тією самою моделлю (`gemma3:4b`).

### Consequences
* Good, because transcript фіксує збереження score=100 для Tier 1 файлів (`discover-check-rules-from-cursor.mjs`: 44s/411tok/100, `trufflehog.mjs`: 47s/478tok/100).
* Bad, because Tier 1 залишається ollama-специфічним: ~170 рядків з `node:http`, `ollamaChat`, `num_ctx:8192`, `temperature:0.2`, `num_predict`, `keep_alive:'15m'`, що не можна замінити через `resolveModel` без втрат якості.

## More Information
Бенчмарк (2 файли, `sym < 4`, Tier 1):

| Версія | Час | Score | Issues |
|---|---|---|---|
| ollama HTTP + orchestrated | 44–47s | 100 | — |
| `pi` + `gemma3:4b` (one-shot) | 35–51s | 65–75 | `no-overview`, `internal-name` |
| `pi` + cloud дефолт (one-shot) | ~12s | 75 | `no-overview` |

Причина регресії — не транспорт, а втрата orchestrated режиму: старий підхід генерує кожну секцію (`## Огляд`, `## Поведінка`, `## Гарантії поведінки`) окремим промптом із `numPredict`-обмеженням. Change-файл: `npm/.changes/260607-0537.md` (зафіксував експеримент як `Changed`, відкочено через `git checkout HEAD`).
