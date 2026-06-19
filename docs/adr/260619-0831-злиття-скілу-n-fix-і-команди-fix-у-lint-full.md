---
session: 92b92f8f-d999-4638-807d-e743dbb88c8b
captured: 2026-06-19T08:31:51+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-cursor/92b92f8f-d999-4638-807d-e743dbb88c8b.jsonl
---

## ADR Злиття скілу `/n-fix` і команди `fix` у `lint --full`

## Context and Problem Statement
Проєкт мав дві окремі команди/скіли: `/n-fix` (`n-cursor fix`) для детекту й виправлення структурної конформності (конфіги, залежності, workflows) і `/n-lint` для запуску лінтерів коду. Розрізнення двох точок входу ускладнювало CLI-інтерфейс і вимагало від користувача знати, яку з них застосовувати.

## Considered Options
* Залишити `fix` і `lint` як окремі підкоманди з чіткими обов'язками
* Злити `fix`-рушій у конформність-фазу `lint`, видалити окрему підкоманду `fix` і скіл `/n-fix`

## Decision Outcome
Chosen option: "Злиття в `lint`", because комітами `185cbeab` (рушій конформності → `scripts/lib/fix`) і `6f49a0c8` (видалення скілу `/n-fix`) `fix`-функціонал повністю поглинуто: `lint` без прапорів = лінтери по дельті; `lint --full` = лінтери по всьому репо **+** конформність-фаза (`runOrchestratorCli`) — той самий convergence-loop check→T0→LLM, що раніше містився в `/n-fix`.

### Consequences
* Good, because transcript фіксує очікувану користь: один прохід `lint --full` замінює дві окремі команди; code-лінтери й структурна конформність виконуються разом.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- `npm/bin/n-cursor.js:1538` — `case 'lint'`, коментар: «позиційні аргументи = фільтр правил конформності (мапить колишній `fix <rule>`)»
- `npm/rules/lint/js/orchestrate.mjs:91` — оркестратор; конформність-фаза викликається тільки при `full=true` (рядок 133)
- `npm/scripts/lib/fix/orchestrator.mjs` — переїхав convergence-loop, `DEFAULT_MAX_ITER=3`, `ESCALATE_AFTER=2`
- `npm/scripts/lib/fix/llm-worker.mjs` — воркер; `MODEL=resolveModel('min')`, `MODEL_HEAVY=resolveModel('avg')`

---

## ADR Спостережуваний каскад LLM-ескалації у конформності-фазі з логуванням

## Context and Problem Statement
Наявна ескалація в `npm/scripts/lib/fix/orchestrator.mjs` проста: min-модель → через 2 послідовні провали → avg-модель (`ESCALATE_AFTER=2`). Причини провалів не логуються, а повторна спроба з тим самим tier-ом не розрізняє «перша» від «аналізована повтор» — неможливо post-factum зрозуміти, чому конкретна модель не впоралась і чи допомогло ескалювання.

## Considered Options
* Запропонований user каскад: local-min → retry local-min з аналізом причини → cloud-min (через pi) → cloud-avg; всі кроки логуються з diagnosis для подальшого аналізу
* Залишити наявний simple `ESCALATE_AFTER=2` без observation-шару

## Decision Outcome
Chosen option: "Спостережуваний каскад з логуванням", because user явно формулює: «аналізуємо чому не вдалося і повторний виклик N_LOCAL_MIN_MODEL і фіксуємо чому не вдалося і чи допомогло повторним в лог (щоб потім проаналізувати)» — ціль збирати дані для майбутнього аналізу якості кожного тиру.

### Consequences
* Good, because transcript фіксує очікувану користь: логи дозволять post-factum визначити, для яких класів порушень local-min достатній, а коли потрібен cloud.
* Bad, because transcript не містить підтверджених негативних наслідків; реалізація ще не виконана — рішення зафіксоване на рівні пропозиції user.

## More Information
- `npm/scripts/lib/fix/orchestrator.mjs:51,54` — поточний `runLlmStep` з `ESCALATE_AFTER=2`
- `npm/scripts/lib/fix/llm-worker.mjs` — `MODEL` (env `N_CURSOR_FIX_MODEL` ?? `resolveModel('min')`), `MODEL_HEAVY` (env `N_CURSOR_FIX_MODEL_HEAVY` ?? `resolveModel('avg')`)
- `npm/lib/models.mjs:28` — `resolveModel('min')` каскадує `N_LOCAL_MIN_MODEL→LOCAL_AVG→LOCAL_MAX→N_CLOUD_MIN_MODEL`; у середовищі user `~/.zshenv` → `N_LOCAL_MIN_MODEL=omlx/gemma-4-e4b-it-OptiQ-4bit`
- Запропоновані тири по порядку: `N_LOCAL_MIN_MODEL` → retry `N_LOCAL_MIN_MODEL` (з diagnosis) → `N_CLOUD_MIN_MODEL` (pi) → `N_CLOUD_AVG_MODEL`
