---
session: 8e669f3c-28f9-4b13-9f55-6a6ec894debe
captured: 2026-06-07T05:53:45+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/8e669f3c-28f9-4b13-9f55-6a6ec894debe.jsonl
---

```
---

Now I'll generate the ADR based on this session.

## ADR Каскадний fallback для tier-моделей через `resolveModel()`

## Context and Problem Statement
У проєкті визначено 6 глобальних змінних середовища для моделей (`N_LOCAL_MIN_MODEL`, `N_LOCAL_AVG_MODEL`, `N_LOCAL_MAX_MODEL`, `N_CLOUD_MIN_MODEL`, `N_CLOUD_AVG_MODEL`, `N_CLOUD_MAX_MODEL`). Якщо локальні змінні не встановлені, споживачі (`coverage-classify`, `fix/llm-worker`, `coverage-fix`, `subagent-runner`, `docgen-gen`) напряму зверталися до конкретних констант і повертали порожній рядок без жодного fallback, що унеможливлювало прозору роботу без локального ollama.

## Considered Options
* Каскадний helper `resolveModel(tier)` у `npm/lib/models.mjs` + заміна прямих константних імпортів
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Каскадний helper `resolveModel(tier)` у `npm/lib/models.mjs`", because необхідно щоб система штатно відпрацьовувала навіть коли локальні моделі не налаштовані — каскад дозволяє прозоро перемикатися на наступний доступний тир.

Каскад, зафіксований у `npm/lib/models.mjs`:
- `resolveModel('min')` → `N_LOCAL_MIN_MODEL` → `N_LOCAL_AVG_MODEL` → `N_LOCAL_MAX_MODEL` → `N_CLOUD_MIN_MODEL`
- `resolveModel('avg')` → `N_LOCAL_AVG_MODEL` → `N_LOCAL_MAX_MODEL` → `N_CLOUD_AVG_MODEL`
- `resolveModel('max')` → `N_LOCAL_MAX_MODEL` → `N_CLOUD_MAX_MODEL`

### Consequences
* Good, because transcript фіксує очікувану користь: система штатно працює без локального ollama, прозоро перемикаючись на хмарний тир.
* Bad, because `npm/skills/docgen/js/docgen-gen.mjs` залишає `LOCAL_MIN` незмінним для Tier 1 — там він передається напряму в ollama HTTP (не через pi), тому `resolveModel('min')` там не застосований: якщо `N_LOCAL_MIN_MODEL` не встановлено, Tier 1 docgen усе одно використовує захардкоджений дефолт `gemma3:4b`.

## More Information
- Файл з каскадом: `npm/lib/models.mjs` — функція `resolveModel(tier)`
- Оновлені споживачі: `npm/scripts/coverage-classify/index.mjs`, `npm/skills/fix/js/llm-worker.mjs`, `npm/scripts/coverage-fix.mjs`, `npm/scripts/dispatcher/lib/subagent-runner.mjs`, `npm/skills/docgen/js/docgen-gen.mjs` (лише Tier 2 `CLOUD_AVG` → `resolveModel('avg')`)
- Change-файл: `npm/.changes/260606-2204.md` (bump minor, section Added)

---

## ADR Бамп major-версій через change-файл, а не пряме редагування

## Context and Problem Statement
Інші варіанти в transcript не обговорювалися.

## Considered Options
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Інші варіанти в transcript не обговорювалися.", because transcript фіксує лише факт: зміна записана через `n-cursor change --bump minor --section Added --message "..." --ws npm`, а не ручним редагуванням `CHANGELOG` чи `package.json`. Це відповідає наявному правилу у пам'яті проєкту.

### Consequences
* Good, because transcript фіксує очікувану користь: change-файл створено без ручного бампу версій.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- Команда: `n-cursor change --bump minor --section Added --message "resolveModel(tier) — прозорий каскадний fallback local→cloud для всіх 3 тирів (min/avg/max)" --ws npm`
- Результат: `npm/.changes/260606-2204.md`

---

## ADR Бамп major-версії через change-файл у docgen-експерименті

## Context and Problem Statement
Інші варіанти в transcript не обговорювалися.

## Considered Options
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Інші варіанти в transcript не обговорювалися.", because transcript фіксує лише факт: зміна записана через `n-cursor change`.

### Consequences
* Good, because transcript фіксує очікувану користь: change-файл створено без ручного бампу версій.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- Команда: `n-cursor change --bump minor --section Changed --message "docgen Tier 1: пряму ollama HTTP замінено на pi+resolveModel('min') — universally через каскад" --ws npm`
- Результат: `npm/.changes/260607-0537.md`

---

## ADR Експеримент: заміна ollama HTTP на pi у docgen Tier 1

## Context and Problem Statement
Docgen Tier 1 використовував прямий HTTP до `localhost:11434` (ollama) зі streaming, `num_ctx:8192`, `temperature:0.2`, `keep_alive:15m` та orchestrated режимом (N окремих pi-викликів по секціях). Виникло питання: чи варто уніфікувати Tier 1 через `pi` (як Tier 2) для спрощення коду і прозорого використання `resolveModel('min')`.

## Considered Options
* Tier 1 через прямий ollama HTTP + orchestrated режим (статус кво)
* Tier 1 через `pi` + `resolveModel('min')` + one-shot промпт (експеримент)

## Decision Outcome
Chosen option: "Tier 1 через прямий ollama HTTP + orchestrated режим", because бенчмарк зафіксував регресію якості з **score=100** (старий підхід) до **score=65-75** (новий pi one-shot) — втрачається orchestrated режим із секційними промптами та `num_predict`/`temperature` параметрами, які гарантували наявність усіх секцій (`## Огляд`, `## Поведінка`, тощо).

Бенчмарк на двох Tier 1 файлах (`sym < 4`):

| Версія | Файл | Час | Score | Issues |
|---|---|---|---|---|
| OLD ollama HTTP + orchestrated | `discover-check-rules-from-cursor.mjs` | 44s | 100 | — |
| OLD ollama HTTP + orchestrated | `trufflehog.mjs` | 47s | 100 | — |
| NEW pi + gemma3:4b | `discover-check-rules-from-cursor.mjs` | 51s | 75 | no-overview |
| NEW pi + gemma3:4b | `trufflehog.mjs` | 35s | 65 | no-overview, internal-name |
| NEW pi + cloud-дефолт | `discover-check-rules-from-cursor.mjs` | 12s | 75 | no-overview |
| NEW pi + cloud-дефолт | `trufflehog.mjs` | 12s | 75 | no-overview |

### Consequences
* Good, because transcript фіксує очікувану користь: pi + cloud-дефолт у 3-4× швидший (12s vs 44-47s) і -142 рядки коду.
* Bad, because бенчмарк підтвердив: якість падає з 100 до 65-75. Причина — втрата orchestrated режиму; one-shot через pi пропускає `## Огляд`. Виграш у простоті не компенсує регресію якості.

## More Information
- Тестові файли Tier 1 (sym < 4): `npm/scripts/lib/discover-check-rules-from-cursor.mjs` (sym=0), `npm/rules/security/js/trufflehog.mjs` (sym=2)
- Tier 2 (sym ≥ 4) в обох версіях однаковий (`piOneShot`) — різниці немає
- Новий `docgen-gen.mjs` (експериментальна версія): `-142 рядки` (321 → 179), видалено `ollamaChat`, `localModelId`, `withTimeout`, `generateOrchestrated`, `generateOneShot`, `assemble`, `import { request } from 'node:http'`
- Рішення сесії: відкотити до старої версії ollama HTTP
