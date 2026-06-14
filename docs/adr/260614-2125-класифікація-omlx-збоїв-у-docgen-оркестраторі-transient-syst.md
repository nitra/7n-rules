---
session: 8e308db4-fee9-44b0-bd83-2a55c74e2dc0
captured: 2026-06-14T21:25:47+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-cursor/8e308db4-fee9-44b0-bd83-2a55c74e2dc0.jsonl
---

## ADR Класифікація omlx-збоїв у docgen-оркестраторі (transient / systemic / permanent)

## Context and Problem Statement
Оркестратор `docgen-files-batch.mjs` обробляв усі omlx-помилки однаково (`catch → ✗ → continue`), що призводило до каскаду на сотні файлів після одного systemic-збою (memory ceiling). У логах зафіксовано три різні класи: `spawnSync curl ETIMEDOUT`, `memory ceiling`, `Prompt too long`.

## Considered Options
* Єдиний клас помилок (поточна поведінка — `catch → ✗ → continue`)
* Три окремих класи: transient / systemic / permanent — з різними стратегіями реакції

## Decision Outcome
Chosen option: "три класи", because кожен клас вимагає принципово різної відповіді: transient — ретрай, systemic — аварійна зупинка, permanent — тихий пропуск без ретраю.

### Consequences
* Good, because transcript фіксує очікувану користь: усунено каскад (~200 файлів горіли після 57-го) — permanent-skip і circuit-breaker зупиняють поширення збою.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Класифікатор `classifyOmlxError` додано в `npm/lib/llm.mjs`; маркери: `memory ceiling` → systemic, `Prompt too long` → permanent, `curl error`/`ETIMEDOUT` → transient. Постійна перевірка через `npm/lib/tests/llm.test.mjs` (describe `classifyOmlxError`).

---

## ADR Circuit breaker без cooldown (fail-fast) для systemic-збоїв

## Context and Problem Statement
Після введення класифікатора потрібно було вирішити поведінку оркестратора при K підряд systemic-помилках: зупинитися відразу або чекати cooldown і перевіряти healthcheck.

## Considered Options
* Abort після K підряд systemic + cooldown-пауза + повторний `omlxHealthCheck` перед abort
* Негайний abort після K підряд systemic без будь-якого очікування

## Decision Outcome
Chosen option: "негайний abort без cooldown", because користувач явно сформулював принцип: «давай швидше помилятись і рухатись далі, чим довго чекати».

### Consequences
* Good, because transcript фіксує очікувану користь: batch негайно завершується з `exit 2` і actionable-повідомленням; невдалі файли лишаються `stale` й підбираються наступним прогоном через CRC.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Константа `SYSTEMIC_ABORT_STREAK = 3` у `npm/rules/doc-files/js/docgen-files-batch.mjs`; `exit 2` відрізняє abort від звичайного завершення з помилками (`exit 1`). Тест: `docgen-files-batch.test.mjs` describe «circuit breaker: systemic ×3 → abort».

---

## ADR Pre-send byte-guard замість chunk+merge для великих файлів

## Context and Problem Statement
Оркестратор надсилав увесь сирий код `${src}` у промпт і лише після відповіді omlx дізнавався про `Prompt too long`. Файл `euscp.js` (14.5 MB / 9.17M токенів) щоразу ініціював марний HTTP-запит. Паралельно обговорювалась ідея розбивати великий файл AST-механізмами на шматки, обробляти LLM окремо й зшивати скриптом (chunk+merge).

## Considered Options
* chunk+merge: size-guard → AST-розкладання → map (LLM per chunk) → reduce (merge-скрипт)
* pre-send byte-guard: оцінка токенів до виклику; якщо `> 0.5 × max_context` — instant-skip + діагностика

## Decision Outcome
Chosen option: "pre-send byte-guard", because скан корпусу `azov/backend` показав: усі файли, що переповнюють контекст — vendored Emscripten-блоби (`euscp*.js`), де chunk+merge дає нуль корисного (порожні `header`/`exports`/`imports`, лише WASM runtime symbols); рукописних файлів, яким бракує контексту, у проєкті нема.

### Consequences
* Good, because transcript фіксує очікувану користь: `euscp.js` (14.5 MB) дає instant-skip за 0.07с без жодного POST замість марного 9.17M-токенного запиту.
* Bad, because guard використовує евристику `bytes / 4` для оцінки токенів — для Emscripten-коду реальна кількість (~0.63 tok/byte) вища, тобто оцінка занижена; для файлів, що лежать між guard і реальним лімітом, можливий пропуск на omlx-рівні. Transcript не зафіксував підтвердженого кейсу цього сценарію.

## More Information
Реалізовано в `npm/rules/doc-files/js/docgen-gen.mjs` (константа `CTX_WINDOW`, змінна `srcTokenBudget`); поріг `> 0.5 × (N_CURSOR_DOCGEN_CTX || 131072)`; кидає `Error` з маркером `Prompt too long`, який `classifyOmlxError` мапить у `permanent`. Chunk+merge задокументовано в `docs/specs/2026-06-14-docgen-omlx-failure-handling-design.md` як відкладену опцію з тригером «рукописний файл, більший за контекст».

---

## ADR Видалення хардкоду DEFAULT_OMLX_MODEL на користь fail-loud

## Context and Problem Statement
В `npm/lib/omlx.mjs` існувала константа `DEFAULT_OMLX_MODEL = 'mlx-community--gemma-4-e2b-it-4bit'` як останній fallback у ланцюзі резолву моделі. Після видалення `e2b`-моделі з сервера хардкод указував на неіснуючу модель. У headless-середовищах без `~/.zshenv` (cron, CI) `N_LOCAL_MIN_MODEL` порожній → ланцюг падав на хардкод-фантома з незрозумілою помилкою.

## Considered Options
* Оновити хардкод на наявну `gemma-4-e4b-it-OptiQ-4bit`
* Прибрати хардкод повністю; якщо `N_LOCAL_MIN_MODEL` не задано — явний throw з actionable-повідомленням

## Decision Outcome
Chosen option: "прибрати хардкод", because кожен розробник налаштовує локальну модель самостійно; хардкод автоматично старіє при зміні моделей і маскує відсутність env замість того, щоб повідомити про неї чітко.

### Consequences
* Good, because transcript фіксує очікувану користь: preflight у `docgen-files-batch.mjs` видає actionable-повідомлення «постав `N_LOCAL_MIN_MODEL`» замість мовчазного запиту до фантома.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
`DEFAULT_OMLX_MODEL` прибрано з `npm/lib/omlx.mjs` і `npm/rules/doc-files/js/docgen-gen.mjs`; канонічний env — `N_LOCAL_MIN_MODEL` (резолвиться через `resolveModel('min')` з `npm/lib/models.mjs`). Тест у `npm/lib/tests/omlx.test.mjs` оновлено: «порожній model → fallback на дефолт» перероблено на «порожній model без fallback env → throw».
