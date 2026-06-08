---
session: aff5fe01-add5-41b1-9164-384bb1718de9
captured: 2026-06-07T21:51:04+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/aff5fe01-add5-41b1-9164-384bb1718de9.jsonl
---

## ADR Маршрутизація локальних моделей: pi vs direct ollama

## Context and Problem Statement
Система `models.mjs` визначає тири `local-min/avg/max` у форматі `ollama/gemma3:Xb` (pi-формат), але всі виклики до локальних моделей проходять виключно через `pi --model`. Для local-тирів існує два можливих шляхи виконання: через `pi` (проксі з нормалізацією, overhead шаблону) і напряму до ollama HTTP API (`http://localhost:11434/v1`) з нульовим overhead, що актуально для операцій без tool-calling (класифікація, simple Q&A).

## Considered Options
* **Поле в `resolveModel`** — функція повертає `{ model, backend: 'pi' | 'ollama-direct' }`; callsite сам вирішує метод виклику.
* **Окрема функція `callLocal()`** — абстракція, що читає env-змінну `N_LOCAL_BACKEND=pi|direct` і вибирає між `callPi()` і `fetchOllama()`.
* **Env-змінна на рівні тиру** — `N_LOCAL_MIN_BACKEND`, `N_LOCAL_AVG_BACKEND` тощо; незалежний override для кожного тиру, default `'pi'`.

## Decision Outcome
Chosen option: не обрано, because transcript завершився до відповіді користувача на питання вибору механізму. Сесія зафіксувала проблему й три варіанти, але фінального вибору не було зроблено.

### Consequences
* Good, because transcript фіксує очікувану користь: прямий виклик ollama усуває overhead pi-шаблону для `--no-tools`-сценаріїв (класифікація мутантів у `coverage-classify`, docgen).
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- `npm/lib/models.mjs` — `resolveModel()`, defaults: `ollama/gemma3:4b`, `ollama/gemma3:12b`, `ollama/gemma3:27b`; env-override через `N_LOCAL_{MIN,AVG,MAX}_MODEL`.
- `npm/skills/fix/js/llm-worker.mjs:11-12` — `MODEL` / `MODEL_HEAVY` беруть `resolveModel('min')` / `resolveModel('avg')`.
- `npm/skills/docgen/js/docgen-gen.mjs:92` — `callPi()` спавнить `pi` через `spawnSync`.
- `npm/scripts/coverage-classify/index.mjs:6-7` — задокументований ladder: Local (pi) → Cloud (pi).
- `npm/scripts/dispatcher/lib/subagent-runner.mjs:2` — усі субагенти йдуть через `pi` (§9.1: не рекурсивно).
- При direct-виклику треба strip `ollama/` prefix → `gemma3:4b` для ollama REST API.
