---
session: 54f63bb7-8e2f-46b8-9c32-658ee5c0f7c6
captured: 2026-06-12T00:34:10+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/54f63bb7-8e2f-46b8-9c32-658ee5c0f7c6.jsonl
---

Workflow блокується review-gate — генерую ADR безпосередньо з поточного контексту сесії:

---

## ADR Rust `.rs` до `SOURCE_EXTENSIONS` і `**/target/**` до ignore-list

## Context and Problem Statement
Скіл `doc-files` підтримував лише JS/TS/Vue/Python файли. Проект `nitra/task` містить Rust файли (`app/src-tauri/build.rs`, `src/lib.rs`, `src/main.rs`), які повністю ігнорувалися. Каталог `target/` Cargo build-системи містить сотні авто-генерованих `.rs` файлів — без фільтра вони потрапили б у чергу генерації.

## Considered Options
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "розширити `SOURCE_EXTENSIONS` + додати `**/target/**` до ignore-list", because `.rs` — єдиний спосіб охопити Rust файли, а `target/` треба явно виключити до першого scan.

### Consequences
* Good, because scan виявив рівно 3 `.rs` файли, жодного з `target/` (`"target/ у .rs: 0"` — підтверджено у verify-кроці).
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Змінені файли: `npm/skills/doc-files/js/docgen-scan.mjs` (константа `SOURCE_EXTENSIONS`), `npm/skills/doc-files/js/docgen-ignore.mjs`. Commit: `f0968598`.

---

## ADR `orchestratedDoc` для Rust через `extractFactsRust` замість `oneShotDoc`

## Context and Problem Statement
До змін Rust файли отримували `unsupported=true` з `extractFacts` і потрапляли в `oneShotDoc` — одиночний LLM-виклик без секційного поділу, без CRC-скорингу (`score=—`). Потрібна якість на рівні JS/Vue файлів.

## Considered Options
* Залишити `oneShotDoc` для Rust (попередня поведінка — неявна альтернатива)
* Реалізувати `extractFactsRust` → використовувати `orchestratedDoc`

## Decision Outcome
Chosen option: "реалізувати `extractFactsRust` для `orchestratedDoc`", because повний pipeline (Behavior → API → Overview → Guarantees → Critique-Refine) дає детерміновані секції і вимірюваний score.

### Consequences
* Good, because transcript фіксує очікувану користь: `lib.rs score=100`, `main.rs score=100`; `build.rs score=80` (мінімальний файл, норма).
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Файл: `npm/skills/doc-files/js/docgen-extract.mjs` — функція `extractFactsRust`. Поле `unsupported` у facts більше не встановлюється для `.rs`.

---

## ADR `#[tauri::command]` атрибут як критерій export у `extractFactsRust`

## Context and Problem Statement
У `lib.rs` функції `scan_tasks`, `find_tasks_dir`, `find_all_tasks_dirs`, `read_task` не мають ключового слова `pub`, але доступні для JS-фронтенду через `#[tauri::command]`. Без спеціальної обробки `extractFactsRust` ігнорував би їх і повертав `exports=[]` замість реального API.

## Considered Options
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "включати функції з рядком `#[tauri::command]` перед `fn` до `exports`", because це точно відображає публічний API Tauri-додатку незалежно від Rust-visibility.

### Consequences
* Good, because `extractFacts` на `lib.rs` повернув всі 5 exports: `scan_tasks`, `find_tasks_dir`, `find_all_tasks_dirs`, `read_task`, `run` — підтверджено запуском CLI.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Файл: `npm/skills/doc-files/js/docgen-extract.mjs`. Тести: `npm/skills/doc-files/js/tests/docgen-extract.test.mjs` (16 тестів, Rust-гілка).

---

## ADR Brace-counting tokenizer для `units-rs.mjs` замість AST-парсера

## Context and Problem Statement
JS/TS-гілка юніт-шару використовує `@oxc-parser/node` (AST). Для Rust у проекті немає аналогічного npm-пакету, тому потрібен інший підхід до виявлення меж функцій/структур/трейтів.

## Considered Options
* Додати Rust AST npm-пакет (наприклад, `@nicolo-ribaudo/rust-parser`)
* Рядковий аналізатор з підрахунком `{}`-брекетів (brace-counting tokenizer)

## Decision Outcome
Chosen option: "brace-counting tokenizer", because в проекті немає прецеденту Rust AST-пакетів; tokenizer, що пропускає рядкові літерали та коментарі, достатній для `rustfmt`-відформатованого коду.

### Consequences
* Good, because 10 тестів у `units-rs.test.mjs` проходять; нова залежність не додається.
* Bad, because `calls=[]` — call-graph не реалізовано; tokenizer не обробляє складні macro-розширення.

## More Information
Файл: `npm/skills/doc-files/js/units-rs.mjs`. Тести: `npm/skills/doc-files/js/tests/units-rs.test.mjs`. Commit: `f0968598`.

---

## ADR Мовно-нейтральний текст для маркера `returnsFalsyOnFail` у `docgen-prompts.mjs`

## Context and Problem Statement
Маркер `returnsFalsyOnFail` спрацьовував на `-> Result<` у Rust-файлах, але `factsSummary` і `guaranteesFromMarkers` виводили JS-специфічний текст `"false/null замість винятку"` — буквально хибний для Rust, де повертається `Err(...)`.

## Considered Options
* Окрема Rust-гілка (`if facts.lang === 'rs'`) з текстом `Err(...)`
* Мовно-нейтральний текст для всіх мов

## Decision Outcome
Chosen option: "мовно-нейтральний текст `false/null/Err замість винятку чи паніки`", because достатньо точний для обох мов і не ускладнює код умовним розгалуженням.

### Consequences
* Good, because текст коректний і для JS (`false/null`) і для Rust (`Err`); без умовної логіки на `lang`.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Файл: `npm/skills/doc-files/js/docgen-prompts.mjs`, рядки `factsSummary` (~35) і `guaranteesFromMarkers` (~198). Commit: `a52c366e`.

---

## ADR `N_CURSOR_OMLX_URL` потребує повного endpoint-шляху

## Context and Problem Statement
`doc-files gen` з `N_CURSOR_OMLX_URL=http://localhost:8000/v1` повертав `omlx empty content (finish=null)` для всіх файлів. Пряма curl-перевірка на `http://localhost:8000/v1/chat/completions` була успішною.

## Considered Options
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "запускати gen без `N_CURSOR_OMLX_URL` override; для кастомного override — повний шлях з `/chat/completions`", because `DEFAULT_OMLX_URL` в `npm/lib/omlx.mjs` вже містить повний endpoint; env-var замінює URL цілком, тому base URL без шляху веде на некоректний endpoint.

### Consequences
* Good, because після усунення env-var gen успішно згенерував всі 3 Rust-доки.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Файл: `npm/lib/omlx.mjs` (константа `DEFAULT_OMLX_URL = 'http://127.0.0.1:8000/v1/chat/completions'`). Робоча команда: `N_CURSOR_DOCGEN_MODEL=omlx/gemma-4-e2b-it-4bit node npm/bin/n-cursor.js doc-files gen --root /Users/vitaliytv/www/nitra/task --from 5 --limit 3`.
