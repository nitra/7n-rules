---
session: 54f63bb7-8e2f-46b8-9c32-658ee5c0f7c6
captured: 2026-06-12T00:38:52+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/54f63bb7-8e2f-46b8-9c32-658ee5c0f7c6.jsonl
---

## ADR Rust-підтримка у doc-files через `orchestratedDoc`, а не `oneShotDoc`

## Context and Problem Statement
Skill `doc-files` мав два шляхи генерації документації: `oneShotDoc` (один LLM-виклик на весь файл, як для Vue/Python) та `orchestratedDoc` (посекційний конвеєр з детермінованим скорингом і нульовими LLM-токенами для секції «Гарантії»). При додаванні `.rs` до `SOURCE_EXTENSIONS` виникло питання — куди маршрутувати Rust-файли.

## Considered Options
* Мінімальна підтримка через `oneShotDoc` (як Vue/Python) — тимчасово обговорювалася на початку сесії
* Повна підтримка через `orchestratedDoc` з власним `extractFactsRust`

## Decision Outcome
Chosen option: "Повна підтримка через `orchestratedDoc`", because одразу після першого `gen`-запуску на `/Users/vitaliytv/www/nitra/task` вирішено перейти на глибший шлях: додано `extractFactsRust()` у `docgen-extract.mjs`, що повертає повний fact-list (замість `{unsupported: true}`), і Rust-файли тепер маршрутуються до `orchestratedDoc`.

### Consequences
* Good, because `lib.rs` і `main.rs` отримали `score=100`, `build.rs` — `score=80` (тривіальний файл, коротка «Поведінка»); детермінована секція «Гарантії» генерується без LLM-токенів на основі маркерів.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Файли: `npm/skills/doc-files/js/docgen-extract.mjs` (`extractFactsRust`, оновлений `extractFacts`), `npm/skills/doc-files/js/docgen-scan.mjs` (`.rs` у `SOURCE_EXTENSIONS`). Команда перевірки: `N_CURSOR_DOCGEN_MODEL=omlx/gemma-4-e2b-it-4bit node npm/bin/n-cursor.js doc-files gen --root /Users/vitaliytv/www/nitra/task --from 5 --limit 3 --overwrite`.

---

## ADR `#[tauri::command]` та інші exposure-атрибути = публічний API у Rust

## Context and Problem Statement
У Rust функції, доступні з frontend-у через Tauri, не мають `pub` у сигнатурі, але фактично є публічним API. `extractFactsRust` мусив вирішити, як класифікувати такі функції: як `exports` або як `localSymbols`.

## Considered Options
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Функції з exposure-атрибутами потрапляють у `exports[]`, а не `localSymbols[]`", because рядок `const RS_EXPOSURE_ATTR_RE = /#\[(?:tauri::command|wasm_bindgen|uniffi::export|pyo3::pyfunction|napi)/gm` детектує ці атрибути і включає відповідні `fn` до списку експортів — що підтверджено на `lib.rs`: `scan_tasks`, `find_tasks_dir`, `find_all_tasks_dirs`, `read_task` (без `pub`, але з `#[tauri::command]`) → коректно потрапляють у `exports`.

### Consequences
* Good, because behavior-prompt отримує повний список публічних символів → LLM не пропускає команди в секції «Поведінка»; `scoreDoc` не штрафує за відсутні анкори.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Файли: `npm/skills/doc-files/js/docgen-extract.mjs` (regex `RS_EXPOSURE_ATTR_RE`, логіка look-ahead у `extractFactsRust`), `npm/skills/doc-files/js/units-rs.mjs` (константа `EXPOSURE_ATTR_RE`). Тест: `docgen-extract.test.mjs` — describe `'Rust (.rs) — extractFactsRust'`, тест `'#[tauri::command] без pub — у exports'`.

---

## ADR Виключення `**/target/**` зі сканування Rust-проєктів

## Context and Problem Statement
При першому запуску `doc-files scan` на Rust-проєкті `/Users/vitaliytv/www/nitra/task` директорія `target/` (артефакти збірки Cargo) містила сотні `.rs`-файлів, які потрапляли до черги генерації документації.

## Considered Options
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Додати `'**/target/**'` до `DOCGEN_IGNORE_GLOBS`", because це стандартна директорія артефактів Cargo, аналогічна `node_modules` для JS.

### Consequences
* Good, because `doc-files scan --root /Users/vitaliytv/www/nitra/task` повернув рівно 3 `.rs`-файли (`build.rs`, `lib.rs`, `main.rs`) і 0 з `target/` — підтверджено командою перевірки.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Файл: `npm/skills/doc-files/js/docgen-ignore.mjs` — рядок `'**/target/**'` у `DOCGEN_IGNORE_GLOBS`. Перевірка: `node npm/bin/n-cursor.js doc-files scan --root /Users/vitaliytv/www/nitra/task 2>&1 | python3 -c "..." → {'rs': 3, 'target/ hits': 0}`.

---

## ADR Мовно-нейтральний текст гарантії `returnsFalsyOnFail`

## Context and Problem Statement
`guaranteesFromMarkers()` і `factsSummary()` генерували JS-специфічний текст `"false/null замість винятку"` для маркера `returnsFalsyOnFail`. Для Rust-файлів цей маркер спрацьовував на `-> Result<` у сигнатурі, але текст буквально хибний: Rust повертає `Err(...)`, а не `false`/`null`.

## Considered Options
* Зберегти JS-текст і додати Rust-специфічний через `if (facts.lang === 'rs')`
* Зробити текст мовно-нейтральним для обох мов одразу

## Decision Outcome
Chosen option: "Мовно-нейтральний текст для обох мов", because це простіше і не вимагає розгалуження: `factsSummary` → `'За невдачі повертає значення помилки (false/null/Err) замість винятку чи паніки'`; `guaranteesFromMarkers` → `'- За невдачі повертає значення помилки (\`false\`/\`null\`/\`Err\`) замість генерування винятку чи паніки.'`.

### Consequences
* Good, because transcript фіксує очікувану користь: текст коректний для JS і Rust одночасно без розгалуження по `lang`.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Файл: `npm/skills/doc-files/js/docgen-prompts.mjs` — функції `factsSummary` (рядок з `returnsFalsyOnFail`) і `guaranteesFromMarkers`. Знахідка отримана на кроці `verify`: секція «Гарантії» для `lib.rs` містила `false`/`null`-текст, неприйнятний для Rust-розробника.

---

## ADR Rust unit-екстрактор через рядково-глибинне відстеження без AST-парсера

## Context and Problem Statement
Для `units-rs.mjs` потрібно витягувати юніти Rust (`pub fn`, `pub struct`, `pub enum`, `pub trait`, методи `impl`-блоків) разом із тілом, документацією і call-graph. Повноцінний AST-парсер Rust з Node.js відсутній у проєкті.

## Considered Options
* Повноцінний AST-парсер (tree-sitter або зовнішній інструмент)
* Рядкова ітерація з підрахунком глибини дужок і пропуском рядкових літералів/коментарів
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Рядкова ітерація з підрахунком глибини (`findClosingBrace`)", because `rustfmt` забезпечує стабільне форматування, достатнє для надійної рядкової евристики; зовнішніх залежностей не додається.

### Consequences
* Good, because 10/10 тестів `units-rs.test.mjs` пройшли: `pub fn`, `fn` (приватна), `#[tauri::command]`, `pub struct`, `pub enum`, методи `impl` (pub і private), doc-коментарі, захоплення тіла, call-graph, `null` на порожньому файлі.
* Bad, because `calls` завжди порожній масив — call-graph не реалізований; можливі хибні спрацювання на `pub fn` всередині рядкових літералів або вкладених макросів у нестандартно відформатованому коді.

## More Information
Файли: `npm/skills/doc-files/js/units-rs.mjs` (новий), `npm/skills/doc-files/js/units.mjs` (додано `if (ext === 'rs') return extractUnitsRs(src, relPath)`). Тести: `npm/skills/doc-files/js/tests/units-rs.test.mjs` — 10 тестів, 31 `expect()`.
