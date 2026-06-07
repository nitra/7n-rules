---
session: d943f92b-e895-4110-8ae0-338380a03c95
captured: 2026-06-06T21:51:58+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/d943f92b-e895-4110-8ae0-338380a03c95.jsonl
---

---

## ADR Спрощення tier-routing у docgen: прибрання Haiku-рефері, додавання 5-хв timeout

## Context and Problem Statement
`docgen-gen.mjs` мав три-рівневий routing: файли з `sym < 2` йшли тільки через локальну модель без рефері; `sym ∈ [2, 4)` — локальна модель плюс `cloudScoreDoc` (Haiku) як рефері якості; `sym ≥ 4` — відразу Tier 2. Виникло питання, чи потрібен Haiku між Tier 1 і Tier 2, якщо детермінований скорер (`scoreDoc`, 0 токенів) вже виконує структурний gate, а на практиці ескалація через Haiku жодного разу не спрацьовувала на 52 local-файлах прогону.

## Considered Options
* Зберегти Haiku як рефері для `sym ∈ [2, 4)` + додати timeout
* Прибрати Haiku, залишити тільки det-scorer + timeout → Tier 2

## Decision Outcome
Chosen option: "Прибрати Haiku, залишити тільки det-scorer + timeout → Tier 2", because Haiku-рефері жодного разу не спрацював на реальних даних (мін. score = 80, поріг = 70), API-виклик є зайвим. Det-scorer (0 токенів) ловить структурні порушення; timeout 5 хвилин закриває ризик зависання локальної моделі.

### Consequences
* Good, because transcript фіксує очікувану користь: відсутність зайвих Haiku API-викликів, спрощення коду (прибрано `cloudScoreDoc`, `SCORE_RUBRIC`, `scoreModel`/`scoreCloud`-параметри).
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- Файл: `npm/skills/docgen/js/docgen-gen.mjs`
- Константа: `LOCAL_TIMEOUT_MS = 5 * 60 * 1000` + `withTimeout(promise, ms)` через `Promise.race`
- Pipeline після зміни: `sym < 4` → Tier 1 local + det-scorer → `score < 70` або timeout → Tier 2; `sym ≥ 4` → Tier 2 одразу
- Комміти: `668d1877` (routing спрощення), `2184724a` (поле `model` в результаті)

---

## ADR Виведення моделі у підсумку batch docgen

## Context and Problem Statement
Батч-скрипт `/tmp/run_docgen_batch.mjs` виводив у підсумку лише кількість OK/Error та Local/Cloud-файлів. При двотировому routing деякі файли з `local`-масиву реально обробляються Tier 2 (ескалація через timeout або det-score), тому рядок "Local: 52 файли" вводив в оману.

## Considered Options
* Показувати модель тільки в підсумку
* Показувати модель у кожному рядку прогресу і в підсумку, окремо рахувати ескалації

## Decision Outcome
Chosen option: "Показувати модель у кожному рядку прогресу і в підсумку, окремо рахувати ескалації", because дозволяє відрізнити pre-routed cloud-файли від ескальованих local → cloud, і видно яку саме модель використано для кожного файлу.

### Consequences
* Good, because transcript фіксує очікувану користь: поле `model` додано до всіх return-об'єктів `generateDoc`, підсумок розрізняє `localOk`, `cloudOk - escalated`, `escalated`.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- `generateDoc` тепер повертає `model: cloudModel` або `model: localModelId`
- Батч: `stats = { ok, err, localOk, cloudOk, escalated, errors }`
- Рядок ескалації виводиться лише якщо `stats.escalated > 0`
- Коміт: `2184724a`

---

## ADR Міграція docgen на глобальні тири моделей (ADR 260606-2124)

## Context and Problem Statement
`docgen-gen.mjs` хардкодив `'gemma3:4b'` і `'claude-sonnet-4-6'` замість посилань на глобальні тири з `npm/lib/models.mjs`. ADR 260606-2124 вимагає, щоб кожен скіл читав тири через `LOCAL_MIN`/`CLOUD_AVG`, а транспортним шаром для cloud-моделей був `pi` CLI, а не Anthropic SDK напряму.

## Considered Options
* Залишити Anthropic SDK, просто замінити дефолтні рядки на `LOCAL_MIN`/`CLOUD_AVG` (strip provider prefix при потребі)
* Перейти на `pi` transport (як у `llm-worker.mjs`), видалити SDK-залежність повністю

## Decision Outcome
Chosen option: "Перейти на `pi` transport", because ADR явно посилається на `llm-worker.mjs` як референс-реалізацію; формат `provider/model-id` призначений для `pi --model`, а не для Anthropic SDK напряму.

### Consequences
* Good, because transcript фіксує очікувану користь: `@anthropic-ai/sdk` прибрано з `package.json`; cloud-tier тепер провайдер-нейтральний (може бути `openai/gpt-*`, `anthropic/claude-*` тощо); per-skill overrides `N_CURSOR_DOCGEN_MODEL` і `N_CURSOR_DOCGEN_CLOUD_MODEL` дозволяють конфігурувати без зміни коду.
* Bad, because `piOneShot` синхронний (`spawnSync`) — блокує event-loop на час cloud-генерації; це прийнятно для batch-скрипта але може бути проблемою у майбутніх асинхронних контекстах.

## More Information
- Файл: `npm/skills/docgen/js/docgen-gen.mjs`
- Нові імпорти: `import { LOCAL_MIN, CLOUD_AVG } from '../../../lib/models.mjs'`; `import { spawnSync } from 'node:child_process'`
- Прибрано: `import Anthropic from '@anthropic-ai/sdk'`, `cloudScoreDoc`, `SCORE_RUBRIC`, `scoreModel`/`scoreCloud` параметри
- `localModelId()` helper: знімає `ollama/` prefix перед передачею до ollama HTTP API
- Коміт: `abaeaa08`

---

## ADR Міграція coverage-classify на pi two-tier routing (LOCAL_MIN → CLOUD_MIN)

## Context and Problem Statement
`npm/scripts/coverage-classify/index.mjs` використовував Anthropic SDK (`new Anthropic()`) для класифікації вцілілих Stryker-мутантів, хардкодив `claude-sonnet-4-6` і залежав від `ANTHROPIC_API_KEY`. Після міграції `docgen` на `pi` постало питання уніфікації транспорту і зниження вартості класифікації за допомогою local-first підходу.

## Considered Options
* Замінити Anthropic SDK на `pi` з `CLOUD_MIN` (дешевше за Sonnet)
* Двотировий routing: `LOCAL_MIN` спочатку, при невалідному JSON → `CLOUD_MIN`
* Залишити `CLOUD_AVG` (Sonnet) — поточна поведінка

## Decision Outcome
Chosen option: "Двотировий routing: `LOCAL_MIN` спочатку, при невалідному JSON → `CLOUD_MIN`", because знижує вартість на простих мутантах (glue/wrapper) де локальна модель достатня; cloud-ескалація захищає від структурно некоректних відповідей local-моделі на складних вердиктах (equivalent/defensive).

### Consequences
* Good, because transcript фіксує очікувану користь: `@anthropic-ai/sdk` видалено з `package.json`; немає `ANTHROPIC_API_KEY` перевірок; cache key `LOCAL_MIN+CLOUD_MIN` автоматично інвалідується при зміні будь-якого тира; `opts.callPi` injection замінює `vi.mock('@anthropic-ai/sdk')` у тестах.
* Bad, because складні вердикти (equivalent, defensive) потребують семантичного аналізу — `LOCAL_MIN` (gemma3:4b, 4B параметрів) ненадійний, тому для таких кейсів ескалація до `CLOUD_MIN` відбудеться майже завжди → два виклики замість одного.

## More Information
- Файл: `npm/scripts/coverage-classify/index.mjs`
- Тести: `npm/scripts/coverage-classify/tests/index.test.mjs`
- Gate для ескалації: `parseVerdict()` кидає (bad JSON або Zod validation fail) → Tier 2
- `FALLBACK_VERDICT`: `{ verdict: 'worth-testing', confidence: 0, reason: '…', suggestedTest: null }` — якщо обидва тири впали
- Коміти: `a883b44d` (міграція), `b90ad6b9` (видалення SDK з package.json)
