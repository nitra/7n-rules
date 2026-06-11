---
session: 54f63bb7-8e2f-46b8-9c32-658ee5c0f7c6
captured: 2026-06-12T00:10:12+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/54f63bb7-8e2f-46b8-9c32-658ee5c0f7c6.jsonl
---

## ADR Rust-підтримка в doc-files: рядковий парсер замість AST

## Context and Problem Statement
Система `doc-files` підтримувала лише JS/TS файли через AST-парсер (`oxc`). Для додавання `.rs` потрібно було вирішити: будувати AST-парсер для Rust (як `oxc` для JS) або використати рядковий підхід із відстеженням глибини дужок і регулярними виразами.

## Considered Options
* Рядковий парсер (line-by-line brace-counting + regex) — `units-rs.mjs`
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Рядковий парсер (line-by-line brace-counting + regex)", because підключення окремого Rust AST-парсера не обговорювалося; `units-rs.mjs` реалізовано через ітерацію по рядках з відстеженням `depth` відкриваючих/закриваючих дужок і regex-матчинг на `pub fn`, `pub struct`, `pub enum`, `pub trait`, `impl`.

### Consequences
* Good, because transcript фіксує очікувану користь: `lib.rs` і `main.rs` отримали `score=100`, `build.rs` — `score=80`; pipeline `orchestratedDoc` запрацював для Rust без нових залежностей.
* Bad, because рядковий парсер не обробляє дужки всередині рядкових літералів та коментарів коректно в edge-cases; це залишено як майбутнє обмеження без фіксу в transcript.

## More Information
Файли: `npm/skills/doc-files/js/units-rs.mjs` (новий), `npm/skills/doc-files/js/units.mjs` (додано `rs` case), `npm/skills/doc-files/js/docgen-extract.mjs` (додано `extractFactsRust`). Коміт: `aaddd2f1`.

---

## ADR `#[tauri::command]` — еквівалент публічного експорту

## Context and Problem Statement
У Rust функції, позначені атрибутом `#[tauri::command]`, не є `pub fn` за синтаксисом мови, але стають частиною публічного API Tauri-додатку. `extractFactsRust` мав вирішити, чи включати такі функції до `exports[]` поруч із `pub fn`.

## Considered Options
* Включити `#[tauri::command]` до `exports[]` нарівні з `pub fn`
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Включити `#[tauri::command]` до `exports[]` нарівні з `pub fn`", because `lib.rs` проєкту `nitra/task` містить функції (`scan_tasks`, `find_tasks_dir`, тощо) без `pub`, але з `#[tauri::command]` — вони є фактичним API фронтенду; включення дало `score=100` і коректну секцію «Публічний API» в документі.

### Consequences
* Good, because transcript фіксує очікувану користь: `extractFacts` на `lib.rs` повернув `exports` з 5 функцій (4 через `#[tauri::command]` + 1 `pub run`), що покрило весь реальний API.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Реалізовано в `extractFactsRust` (`npm/skills/doc-files/js/docgen-extract.mjs`). `localSymbols` отримує лише функції без `pub` і без будь-яких exposure-атрибутів.

---

## ADR Rust-файли через `orchestratedDoc`, а не `oneShotDoc`

## Context and Problem Statement
До підтримки Rust файли з невідомими розширеннями поверталися як `{ unsupported: true }` з `extractFacts` і передавалися до `oneShotDoc` (один виклик LLM на весь файл). Перший прогін `oneShotDoc` на `.rs` файлах дав прийнятну документацію, але без детермінованого скорингу та секції «Гарантії поведінки».

## Considered Options
* Залишити `.rs` у `oneShotDoc` (як є після першого прогону)
* Реалізувати `extractFactsRust` і переключити `.rs` на `orchestratedDoc`

## Decision Outcome
Chosen option: "Реалізувати `extractFactsRust` і переключити `.rs` на `orchestratedDoc`", because користувач явно попросив «глибшу» підтримку після успіху `oneShotDoc`; `orchestratedDoc` дає детермінований `score`, секцію Гарантії без LLM, та окремі секції Огляд/Поведінка/API.

### Consequences
* Good, because transcript фіксує: `lib.rs` `score=100`, `main.rs` `score=100`, `build.rs` `score=80` — проти `score=—` (немає скорингу) при `oneShotDoc`.
* Bad, because `returnsFalsyOnFail` маркер генерував JS-специфічний текст `"false/null"` для Rust (пізніше виправлено до мовно-нейтрального варіанту `"false/null/Err"`).

## More Information
`extractFactsRust` повертає `lang: 'rs'`, `exports`, `markers` (`readOnly`, `catchesErrors`, `returnsFalsyOnFail`, `network`, `caches`), `imports`, `internalSymbols`, `localSymbols`. Команда перевірки: `N_CURSOR_DOCGEN_MODEL=omlx/gemma-4-e2b-it-4bit node npm/bin/n-cursor.js doc-files gen --root /Users/vitaliytv/www/nitra/task --from 5 --limit 3 --overwrite`.

---

## ADR `N_CURSOR_OMLX_URL` не має містити `/chat/completions`

## Context and Problem Statement
При спробі запустити `doc-files gen` з `N_CURSOR_OMLX_URL=http://localhost:8000/v1` всі виклики повертали `omlx empty content (finish=null)`. Причина — `callOmlxRaw` використовує значення env-змінної як повний URL, а `DEFAULT_OMLX_URL` вже містить `http://127.0.0.1:8000/v1/chat/completions`.

## Considered Options
* Не встановлювати `N_CURSOR_OMLX_URL` коли omlx слухає на дефолтному порту 8000
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Не встановлювати `N_CURSOR_OMLX_URL` коли omlx слухає на дефолтному порту 8000", because `DEFAULT_OMLX_URL` в `npm/lib/omlx.mjs` вже вказує на `http://127.0.0.1:8000/v1/chat/completions`; після видалення env-override генерація запрацювала коректно.

### Consequences
* Good, because transcript фіксує: після видалення env-override `✓ OK: 3 ⚠ degraded: 0 ✗ Err: 0`.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
`npm/lib/omlx.mjs` рядок ~110: `url = env.N_CURSOR_OMLX_URL ?? DEFAULT_OMLX_URL`. Якщо встановити `N_CURSOR_OMLX_URL=http://localhost:8000/v1` (без `/chat/completions`), запит йде на хибний endpoint і omlx повертає порожню відповідь з `finish_reason: null`.
