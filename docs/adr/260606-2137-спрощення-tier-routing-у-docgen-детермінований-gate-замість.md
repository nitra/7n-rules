---
session: d943f92b-e895-4110-8ae0-338380a03c95
captured: 2026-06-06T21:37:39+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/d943f92b-e895-4110-8ae0-338380a03c95.jsonl
---

*[ADR trigger]* The session described above contains several design decisions worth recording.

---

## ADR: Спрощення tier-routing у docgen — детермінований gate замість Haiku-рефері

## Context and Problem Statement
Пайплайн генерації документації мав три routing-рівні: sym < 2 (Tier 1 без рефері), sym ∈ [2,4) (Tier 1 + cloudScoreDoc через Claude Haiku), sym ≥ 4 (Tier 2 відразу). Haiku-виклик додавав затримку і вартість для borderline-файлів, але емпіричний прогін показав, що з 52 local-файлів жоден не перетнув поріг ескалації 70.

## Considered Options
* Залишити Haiku як рефері для sym ∈ [2,4)
* Замінити Haiku тільки на детермінований скорер (scoreDoc, 0 токенів) для sym < 4
* Замінити Haiku на перевірку «не порожній» / timeout

## Decision Outcome
Chosen option: "Замінити Haiku на det-scorer + timeout", because Haiku не ескалував жодного файлу на реальних даних, а det-scorer вільно ловить структурні проблеми (відсутній ## Огляд, хибне кешування, короткий ## Поведінка) при нульовій вартості. Перевірка «не порожній» відхилена — не ловить семантично зламаний але непорожній вивід.

### Consequences
* Good, because transcript фіксує очікувану користь: вилучено Haiku-виклик (вартість і латентність), поріг sym ≥ 4 залишився стабільним.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- `npm/skills/docgen/js/docgen-gen.mjs` — видалено `BORDERLINE_SYM_LOW`, `cloudScoreDoc`, `scoreModel`; додано `withTimeout`, `LOCAL_TIMEOUT_MS = 5 * 60 * 1000`
- Commits: `668d1877` (рефакторинг routing), `2184724a` (model field), `abaeaa08` (міграція на глобальні тири)

---

## ADR: Timeout 5 хвилин на локальну генерацію як gate перед Tier 2

## Context and Problem Statement
Локальна модель (gemma3:4b) не гарантує відповідь у прийнятний час: великі файли або перевантажений ollama-сервер можуть блокувати batch на невизначений час. Без обмеження один файл може зупинити весь pipeline.

## Considered Options
* Без timeout (поточна поведінка до цієї сесії)
* Promise.race з фіксованим LOCAL_TIMEOUT_MS, ескалація у Tier 2

## Decision Outcome
Chosen option: "Promise.race з LOCAL_TIMEOUT_MS = 300 000 мс", because timeout дає детерміновану верхню межу і природно тригерить escalation у Tier 2 замість зупинки.

### Consequences
* Good, because transcript фіксує очікувану користь: файли не можуть заблокувати batch назавжди; ескалація відпрацьовує через той самий код-шлях, що й низький det-score.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
```js
const LOCAL_TIMEOUT_MS = 5 * 60 * 1000
function withTimeout(promise, ms) {
return Promise.race([promise, new Promise((_, reject) =>
setTimeout(() => reject(new Error(`local timeout after ${ms / 1000}s`)), ms)
)])
}
```
- `npm/skills/docgen/js/docgen-gen.mjs` — функція `withTimeout`, константа `LOCAL_TIMEOUT_MS`
- Commit: `668d1877`

---

## ADR: Повернення поля `model` з generateDoc

## Context and Problem Statement
Batch-скрипт не міг відрізнити, яку саме модель використано для конкретного файлу — чи залишився Tier 1 (gemma3:4b), чи ескалував у Tier 2 (claude-sonnet-4-6), чи відразу потрапив у pre-routing. Це унеможливлювало точну звітність у підсумку прогону.

## Considered Options
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Додати `model` до return-об'єкта generateDoc", because кожне з трьох routing-відгалужень вже мало `cloudModel` або `model` у scope — достатньо включити відповідне значення в return.

### Consequences
* Good, because transcript фіксує очікувану користь: batch-summary показує модель у кожному рядку прогресу і в підсумку ескалацій.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- Три return-точки в `npm/skills/docgen/js/docgen-gen.mjs` — pre-routing, local-timeout escalation, det-score escalation, Tier 1 success — всі отримали `model: cloudModel` або `model`
- `/tmp/run_docgen_batch.mjs` — оновлено summary: `stats.escalated`, рядки прогресу з `[${result.model}]`
- Commit: `2184724a`

---

## ADR: Міграція Tier 2 docgen на глобальні тири моделей і pi-транспорт

## Context and Problem Statement
`docgen-gen.mjs` хардкодив `'gemma3:4b'` і `'claude-sonnet-4-6'` безпосередньо у коді та використовував Anthropic SDK (`new Anthropic()`) для Tier 2. Інші скіли (`llm-worker.mjs`) вже перейшли на глобальні тири з `npm/lib/models.mjs` і `pi`-транспорт (`spawnSync('pi', ...)`), що дає провайдер-нейтральну заміну моделей через змінні середовища.

## Considered Options
* Зберегти Anthropic SDK, лише замінити рядки моделей константами з models.mjs (strip provider-prefix)
* Перейти на `pi`-транспорт, як у llm-worker.mjs — провайдер-нейтрально

## Decision Outcome
Chosen option: "Перейти на pi-транспорт", because ADR 260606-2124 явно вказує `llm-worker.mjs` як зразковий патерн, а формат `provider/model-id` призначений саме для `pi --model`, а не для Anthropic SDK напряму.

### Consequences
* Good, because transcript фіксує очікувану користь: `CLOUD_AVG` і `LOCAL_MIN` налаштовуються один раз у середовищі; per-skill override через `N_CURSOR_DOCGEN_MODEL` / `N_CURSOR_DOCGEN_CLOUD_MODEL`; видалено залежність від `@anthropic-ai/sdk` у рантаймі docgen.
* Bad, because `piOneShot` є синхронним (`spawnSync`), що блокує event loop під час cloud-виклику. Transcript не містить підтвердження що це визнано проблемою.

## More Information
- `npm/skills/docgen/js/docgen-gen.mjs`: додано `import { LOCAL_MIN, CLOUD_AVG } from '../../../lib/models.mjs'`, `import { spawnSync } from 'node:child_process'`; видалено `import Anthropic from '@anthropic-ai/sdk'`; `claudeOneShot` → `piOneShot`; `localModelId()` знімає `ollama/` префікс для HTTP-виклику
- `npm/lib/models.mjs` — `LOCAL_MIN`, `CLOUD_AVG` (формат `provider/model-id`, env `N_LOCAL_MIN_MODEL`, `N_CLOUD_AVG_MODEL`)
- ADR-референс: `docs/adr/260606-2124-глобальна-класифікація-моделей-n-local-n-cloud.md`
- Commit: `abaeaa08`
