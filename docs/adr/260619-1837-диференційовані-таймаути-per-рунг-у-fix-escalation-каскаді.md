---
session: 91ef735b-1750-4c3d-bac1-6f0627451d63
captured: 2026-06-19T18:37:00+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-cursor/91ef735b-1750-4c3d-bac1-6f0627451d63.jsonl
---

Аналіз транскрипту завершено. Видаю документацію рішень.

---

## ADR Диференційовані таймаути per-рунг у fix-escalation-каскаді

## Context and Problem Statement
`llm-worker.mjs` хардкодив `timeoutMs: 120_000` для всіх рунгів каскаду. Під час `lint --full` локальний 4b-рунг на правилі `adr` впирався у стіну 120s (`curl 28`), марнуючи час перед ескалацією на хмарний рунг. Локальні маленькі моделі об'єктивно не здатні обробити великі промпти за 120s, і тримати їх стільки — неефективно.

## Considered Options
* Per-tier `timeoutMs` у структурі рунга `buildLadder` (локальні — коротко, хмарні — повний ліміт)
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Per-tier `timeoutMs` у `buildLadder`", because transcript фіксує: 4b-модель на `adr` системно не встигає за 120s, тоді як хмарні рунги потребують повного ліміту.

Реалізація: `buildLadder` отримав поле `timeoutMs` на кожен рунг — локальні беруть `N_LOCAL_FIX_TIMEOUT_MS` (дефолт `45_000`), хмарні — `N_CLOUD_FIX_TIMEOUT_MS` (дефолт `120_000`). Значення прокидається через `escalateRule` → `runLlmWorker` opts → `callModel` → `callLlm`.

### Consequences
* Good, because transcript фіксує очікувану користь: adr-local-timeout скоротився з 120s до 45s (`45003 ms` у реальному прогоні після зміни).
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Файли: `npm/scripts/lib/fix/orchestrator.mjs` (`buildLadder`, `escalateRule`), `npm/scripts/lib/fix/llm-worker.mjs` (`callModel`, `runLlmWorker`). Env-змінні: `N_LOCAL_FIX_TIMEOUT_MS`, `N_CLOUD_FIX_TIMEOUT_MS`. Тести: `npm/scripts/lib/fix/tests/orchestrator.test.mjs` (нові кейси перевіряють `timeoutMs` у worker-call). Change-файл: `npm/.changes/260619-1716.md`.

---

## ADR Хмарний транспортний збій → обрив каскаду замість ескалації на cloud-avg

## Context and Problem Statement
Після таймауту `cloud-min` (помилка `pi error: spawnSync pi ETIMEDOUT`) каскад ескалював на `cloud-avg`, де той самий транспортний збій повторювався. Це марнувало один із трьох avg-викликів, не покращуючи результат. `decideAfterFailure` не відрізняла транспортні збої від збоїв якості моделі.

## Considered Options
* Хмарний transport-збій → `break` у `decideAfterFailure` (обривати решту хмарних рунгів)
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Хмарний transport-збій → `break`", because transcript фіксує: `ETIMEDOUT` на cloud-min означає висячий `pi`-процес/auth, а не слабкість моделі — cloud-avg не здолає транспортну стіну.

Реалізація: в `decideAfterFailure` (`orchestrator.mjs`) додано `isCloudTimeout(error)` — регулярний вираз `CLOUD_TRANSPORT_RE` (`/ETIMEDOUT|timed out|pi error/i`) на не-local рунгу → повертає `'break'`. Реальний прогін підтвердив: після зміни adr зупиняється на cloud-min ETIMEDOUT без спроби cloud-avg.

### Consequences
* Good, because transcript фіксує очікувану користь: cloud-avg бюджет (кеп: 3) більше не спалюється на правила, де cloud-min зазнав транспортного збою.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Файли: `npm/scripts/lib/fix/orchestrator.mjs` (`decideAfterFailure`, константа `CLOUD_TRANSPORT_RE`). Тести: `orchestrator.test.mjs` — кейс "cloud-transport обриває драбину з `avgUsed: 0`". Разом із [[per-tier-timeout]] — Фаза 1 fail-fast оптимізацій каскаду.

---

## ADR Діагностика кореневої причини відмов doc-files у LLM-каскаді

## Context and Problem Statement
Правило `doc-files` систематично провалювалося у LLM-каскаді: локальні моделі повертали "no changes", хмарні — "Недостатньо контексту репозиторію". Передбачалося, що `extractFilePaths` не знаходить шляхів у violation output. Насправді root cause виявився глибшим: `docgen-judge-measure.mjs` лежить у `js/` директорії правила (де `listJsConcerns` підбирає всі `.mjs` файли як JS-концерни). При імпорті як концерн файл виконує `main()` без `isRunAsCli` guard → `process.exit(2)` → `fix.mjs` крашиться → violation output містить лише "Usage: node docgen-judge-measure.mjs...". При цьому `lint.mjs` не експортує `check()`, тобто фактична детекція застарілих доків через `runRule` не виконується.

## Considered Options
* Додати `isRunAsCli` guard до `docgen-judge-measure.mjs` + `check()` до `lint.mjs` + збагатити violation output (docPath + pre-computed CRC) для LLM
* Перенести `docgen-judge-measure.mjs` за межі `js/` (наприклад, з `_`-префіксом)
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Додати `isRunAsCli` guard + `check()` + збагачений violation output", because transcript фіксує два незалежних баги: (1) crash при import, (2) відсутність `check()` — обидва треба закрити; збагачений output із docPath + CRC дає моделі все необхідне (CRC32 LLM не може обчислити сам).

Реалізація Фази 2 в transcript незавершена (зупинена на дозволі запису файлу), але діагноз зафіксований.

### Consequences
* Good, because transcript фіксує очікувану користь: після фіксів LLM отримає source + doc + pre-computed CRC → зможе оновити контент доки й проставити правильний CRC.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Файли: `npm/rules/doc-files/js/docgen-judge-measure.mjs` (відсутній `isRunAsCli` guard на виклику `main()`), `npm/rules/doc-files/js/lint.mjs` (відсутній `check()` export), `npm/scripts/lib/discover-checkable-rules.mjs` (`listJsConcerns` підбирає всі `.mjs` без `_`-префіксу), `npm/scripts/lib/run-rule.mjs` (`runRule` викликає `mod.check()` для JS-концернів). Пов'язаний план: збагатити `reportStale` полями `docPath` і `new-crc` (pre-computed через `crc32(readFileSync(join(cwd, f.sourcePath)))`).
