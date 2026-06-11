---
session: 54f63bb7-8e2f-46b8-9c32-658ee5c0f7c6
captured: 2026-06-11T23:52:53+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/54f63bb7-8e2f-46b8-9c32-658ee5c0f7c6.jsonl
---

## ADR Підтримка Rust у doc-files: поетапне введення one-shot → orchestrated

## Context and Problem Statement
Скіл `doc-files` не виявляв `.rs` файли взагалі: `SOURCE_EXTENSIONS` у `docgen-scan.mjs` містив лише JS/TS/Vue/Python розширення. Крім того, директорія `target/` (Cargo build artifacts) не ігнорувалась, що призвело б до сотень зайвих файлів у черзі генерації. Після базового виявлення була запрошена глибша підтримка з orchestrated pipeline (секції Огляд/Поведінка/API/Гарантії та детермінований scoring), а не one-shot генерація як для Vue/Python.

## Considered Options
* Мінімальна підтримка (one-shot): додати `.rs` до `SOURCE_EXTENSIONS` — Rust проходить той самий шлях що Vue/Python (`oneShotDoc`, один LLM-виклик на весь файл, `unsupported: true` у `extractFacts`).
* Повна підтримка (orchestrated): створити `units-rs.mjs` (unit-екстрактор), оновити `units.mjs` і `docgen-extract.mjs` щоб `extractFacts` повертав справжні `exports`/`markers`/`imports` для `.rs` — тоді `docgen-gen.mjs` маршрутизує до `orchestratedDoc`.

## Decision Outcome
Chosen option: "Поетапно: спочатку one-shot (один рядок), потім відразу orchestrated", because обидва кроки зроблено в одній сесії — спочатку `.rs` додано до `SOURCE_EXTENSIONS` і перевірено на проєкті `nitra/task`, потім одразу реалізована повна підтримка, оскільки score one-shot не нормується і не дає секцій Гарантій.

### Consequences
* Good, because `lib.rs` і `main.rs` отримали score=100, `build.rs` — score=80 при регенерації через `orchestratedDoc`; секції Огляд / Поведінка / Публічний API / Гарантії формуються детерміновано.
* Good, because `extractFactsRust` коректно розпізнає `#[tauri::command]`-функції як effectively-public exports (не лише `pub fn`), що відповідає реальній семантиці Tauri-проєктів.
* Good, because `**/target/**` доданий до `DOCGEN_IGNORE_GLOBS` у `docgen-ignore.mjs`, що виключає Cargo build artifacts так само як `node_modules` для JS.
* Bad, because `calls`-граф у `units-rs.mjs` залишається порожнім масивом (`[]`) — call-graph detection для Rust ще не реалізовано.
* Bad, because `N_CURSOR_OMLX_URL` env-var під час запуску `doc-files gen` має бути або не заданий (використовується `DEFAULT_OMLX_URL = 'http://127.0.0.1:8000/v1/chat/completions'`), або містити повний URL до `/chat/completions`. Передача лише базового шляху `/v1` спричинила `omlx empty content (finish=null)` під час тесту.

## More Information
Змінені файли:
- `npm/skills/doc-files/js/docgen-scan.mjs` — `.rs` додано до `SOURCE_EXTENSIONS`
- `npm/skills/doc-files/js/docgen-ignore.mjs` — `**/target/**` у `DOCGEN_IGNORE_GLOBS`
- `npm/skills/doc-files/js/units-rs.mjs` (новий) — `extractUnitsRs(src)`: brace-counting tokenizer, витяг `pub fn`/`pub struct`/`pub enum`/`pub trait`/`impl`-методів, `///` doc-comments, `#[tauri::command]` та інші attribute-based exposure markers
- `npm/skills/doc-files/js/units.mjs` — додано `case 'rs': return extractUnitsRs(src)` у фасад `extractUnits`
- `npm/skills/doc-files/js/docgen-extract.mjs` — `extractFactsRust(src, relPath)`: header із `//!`-коментарів, exports із pub-оголошень + атрибутів, markers (readOnly, catchesErrors, returnsFalsyOnFail, network, caches), imports std/external

Тестовий проєкт: `/Users/vitaliytv/www/nitra/task/app/src-tauri/` (3 файли: `build.rs`, `src/lib.rs`, `src/main.rs`).
Команда регенерації: `N_CURSOR_DOCGEN_MODEL=omlx/gemma-4-e2b-it-4bit node npm/bin/n-cursor.js doc-files gen --root /Users/vitaliytv/www/nitra/task --from 5 --limit 3 --overwrite`
