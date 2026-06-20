---
session: 91ef735b-1750-4c3d-bac1-6f0627451d63
captured: 2026-06-19T17:11:42+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-cursor/91ef735b-1750-4c3d-bac1-6f0627451d63.jsonl
---

## ADR Диференційовані таймаути per-рунг у escalation-cascade

## Context and Problem Statement
Під час `lint --full` рунг `local-min` (omlx/gemma-4-e4b-it-OptiQ-4bit) блокував ескалацію на 120s через `curl: (28) Operation timed out after 120006 milliseconds`. Хардкодований `timeoutMs: 120_000` у `llm-worker.mjs:callModel` однаково застосовувався до локальних і хмарних рунгів, щоразу змушуючи чекати повну стіну навіть тоді, коли краш неминучий.

## Considered Options
* Однаковий 120s-таймаут для всіх рунгів (поточний стан)
* Різні таймаути per-рунг: коротший (~45s) для local, стандартний 120s для cloud

## Decision Outcome
Chosen option: "Різні таймаути per-рунг", because `buildLadder` (`orchestrator.mjs:29`) формує рунги, що вже несуть метадані; додавання поля `timeoutMs` per-рунг дозволяє local-рунгам фаст-фейлитися й передавати управління хмарі раніше, не марнуючи часу.

### Consequences
* Good, because local `curl 28` на важких правилах (adr) займатиме ~45s замість 120s — ескалація на `cloud-min` відбудеться вчасно.
* Bad, because потребує прокидання `timeoutMs` через ланцюжок `escalateRule` → `runLlmWorker` → `callModel` → `callLlm` — зачіпає кілька файлів (`orchestrator.mjs`, `llm-worker.mjs`, `llm.mjs`).

## More Information
Змінювані файли: `npm/scripts/lib/fix/orchestrator.mjs` (`buildLadder`, `escalateRule`), `npm/scripts/lib/fix/llm-worker.mjs` (`callModel`), `npm/lib/llm.mjs` (`callLlm`). Env-змінна для конфігурації: `N_LOCAL_FIX_TIMEOUT_MS` (дефолт 45_000). Покривається в `npm/scripts/lib/fix/tests/orchestrator.test.mjs` (перевірка, що рунги передають `timeoutMs` у opts worker'а).

---

## ADR Cloud-timeout трактується як systemic failure і обриває решту cloud-рунгів

## Context and Problem Statement
`pi ETIMEDOUT` на `cloud-min` не класифікувався як системний збій і не переривав ескалацію: каскад піднімався до `cloud-avg` (той самий 120s-таймаут), витрачаючи один із трьох доступних avg-викликів даремно. `classifyOmlxError` обробляє лише omlx-помилки й не охоплює pi-ETIMEDOUT.

## Considered Options
* Продовжувати ескалацію наскрізь (поточний стан)
* Трактувати cloud-timeout як `'break'` у `decideAfterFailure` і пропускати решту cloud-рунгів

## Decision Outcome
Chosen option: "Трактувати cloud-timeout як `'break'`", because вища модель не переможе там, де молодша провалилася через таймаут, а не через якість; avg-кеп — обмежений ресурс.

### Consequences
* Good, because transcript фіксує очікувану користь: avg-виклики не витрачаються на правила, де хмарна стіна ідентична незалежно від моделі.
* Bad, because якщо `pi ETIMEDOUT` трапляється через transient мережевий збій, а не структурну причину, `break` може приховати успішну спробу. Transcript не містить підтверджених негативних наслідків щодо false-break у нормальних умовах.

## More Information
Змінюваний файл: `npm/scripts/lib/fix/orchestrator.mjs`, функція `decideAfterFailure`. Новий предикат `isCloudTimeout(error)` = `/ETIMEDOUT|timed out|pi error/i` на non-local рунгу → повертає `'break'`. Тест: `orchestrator.test.mjs` — escalateRule з cloud-min ETIMEDOUT → `avgUsed === 0`, cloud-avg не викликано.

---

## ADR Repo-context fallback у `buildPrompt` коли `extractFilePaths` повертає порожній список

## Context and Problem Statement
Для правил `doc-files`, `adr`, `npm-module` функція `extractFilePaths` (`orchestrator.mjs:23`) не знаходить шляхів у тексті violation (порушення описує *відсутні* файли, а не наявні). Промпт отримує `(no files identified)` (`llm-worker.mjs:84`), і cloud-моделі дослівно відповідають: «Недостатньо контексту репозиторію».

## Considered Options
* Промпт із `(no files identified)` (поточний стан)
* Generic fallback: дерево репо (`git ls-files`) + маніфести (`package.json`) коли `files.length === 0`
* Per-rule context-провайдери (doc-files → список code vs docs; adr → лістинг `docs/adr/`)

## Decision Outcome
Chosen option: "Generic fallback з інкрементальним per-rule розширенням", because generic fallback вирішує проблему «no files» для всіх правил одразу, а per-rule провайдери додаються інкрементально — це мінімізує початковий ризик.

### Consequences
* Good, because transcript фіксує очікувану користь: cloud-моделі отримують достатньо контексту для генерації патча.
* Bad, because дерево репо в промпті збільшує token-usage на кожен LLM-виклик для цих правил; розмір зрізу потребує явного обмеження (відфільтровані/обрізані `git ls-files`).

## More Information
Новий хелпер `buildRepoContext(ruleId, projectRoot)` у `npm/scripts/lib/fix/llm-worker.mjs`. Потребує експортування `extractFilePaths`, `buildPrompt`, `buildRepoContext` для тестованості (зараз приватні). Новий тест: `llm-worker.test.mjs` — `buildPrompt` із порожнім `files` містить дерево + маніфест.

---

## ADR Локальний JSON-parse-fail 4b-моделі не виправляється — драбина обробляє це за дизайном

## Context and Problem Statement
На рунгу `local-min` для правила `js-run` 4b-модель (omlx/gemma-4-e4b-it-OptiQ-4bit) повернула невалідний JSON (`cannot parse pi response`). Постало питання: чи ускладнювати парсер у `llm-fix-apply.mjs`, щоб врятувати local-рунг.

## Considered Options
* Lenient-repair JSON-парсер для local-відповідей
* Залишити поточний парсер — дозволити ескалації підняти виклик до cloud-min

## Decision Outcome
Chosen option: "Залишити поточний парсер", because cloud-min успішно закрив `js-run` (✅ у transcript), що підтверджує: драбина вирішує проблему без модифікації парсера; ускладнення парсера під специфічний дефект 4b-моделі — overengineering.

### Consequences
* Good, because transcript фіксує очікувану користь: js-run закрито cloud-min без додаткового коду.
* Bad, because local-рунг витрачає retry-спробу (local-min-retry) перед ескалацією. Transcript не містить підтверджених негативних наслідків для продуктивності.

## More Information
Задіяні файли: `npm/scripts/lib/fix/llm-fix-apply.mjs` (парсер — не змінюється), `npm/scripts/lib/fix/orchestrator.mjs` (логіка ескалації). Parse-error вже призводить до ескалації через `decideAfterFailure` — окремих змін не потрібно.
