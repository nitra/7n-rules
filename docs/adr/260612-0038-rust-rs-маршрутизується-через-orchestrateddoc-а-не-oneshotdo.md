---
session: 54f63bb7-8e2f-46b8-9c32-658ee5c0f7c6
captured: 2026-06-12T00:38:37+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/54f63bb7-8e2f-46b8-9c32-658ee5c0f7c6.jsonl
---

## ADR Rust `.rs` маршрутизується через `orchestratedDoc`, а не `oneShotDoc`

## Context and Problem Statement
Нові `.rs` файли були додані до `SOURCE_EXTENSIONS`, але без `extractFacts`-підтримки вони б потрапляли до `oneShotDoc` через `{unsupported: true}`. Потрібно було вирішити, чи надавати Rust той самий повний конвеєр (секційна генерація + детермінований скоринг), що й JavaScript/TypeScript.

## Considered Options
* Залишити Rust на `oneShotDoc` (мінімальний шлях — один LLM-виклик на файл)
* Додати `extractFactsRust` і маршрутизувати `.rs` через `orchestratedDoc` (повний конвеєр)

## Decision Outcome
Chosen option: "Додати `extractFactsRust` і маршрутизувати через `orchestratedDoc`", because цей шлях дає детермінований скоринг (0-100), секцію «Гарантії поведінки» без LLM-токенів, і CRC-стабільність — ті самі властивості, що вже є для JS/TS.

### Consequences
* Good, because `lib.rs` та `main.rs` у проєкті `task` отримали score=100; `build.rs` (тривіальний файл) — 80, що відповідає очікуваній поведінці скорера.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Реалізація: `docgen-extract.mjs` — `extractFactsRust(src, relPath)`, підключена в `extractFacts()` через `if (lang === 'rs') return extractFactsRust(src, relPath)`. Тести: `docgen-extract.test.mjs` (9 Rust-тестів, 16 усього pass).

---

## ADR `#[tauri::command]` та інші exposure-атрибути рахуються як публічні exports

## Context and Problem Statement
У Rust функції, що викликаються з frontend через Tauri, не мають ключового слова `pub` у сигнатурі, але є частиною публічного API файлу. Без спеціальної обробки `extractFactsRust` не включала б їх до `exports[]`, що призводило б до порожнього списку в `lib.rs`.

## Considered Options
* Рахувати лише `pub fn` як exports
* Рахувати `pub fn` + функції з exposure-атрибутами (`#[tauri::command]`, `#[wasm_bindgen]`, `#[uniffi::export]`, `#[pyo3::pyfunction]`, `#[napi]`) як exports

## Decision Outcome
Chosen option: "Рахувати `pub fn` + exposure-атрибути", because `#[tauri::command]`-функції є справжнім публічним API файлу і повинні з'являтись у документації як такі.

### Consequences
* Good, because transcript фіксує очікувану користь: `extractFacts` на `lib.rs` повертає всі 5 функцій (`scan_tasks`, `find_tasks_dir`, `find_all_tasks_dirs`, `read_task`, `run`) в `exports[]`.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Регекс: `RS_EXPOSURE_ATTR_RE = /#\[(?:tauri::command|wasm_bindgen|uniffi::export|pyo3::pyfunction|napi)/gm` у `docgen-extract.mjs`. Аналогічна логіка в `units-rs.mjs` через `EXPOSURE_ATTR_RE`.

---

## ADR Посторядковий brace-depth скан замість повного Rust-парсера

## Context and Problem Statement
Для `extractUnitsRs` і `extractFactsRust` потрібно було ідентифікувати публічні елементи Rust-файлу (функції, структури, enums, traits, impl-блоки) разом з їхніми тілами й doc-коментарями. Питання — використовувати повноцінний AST-парсер чи простіший підхід.

## Considered Options
* Повноцінний AST-парсер (наприклад, виклик `rustfmt` або `syn` через окремий Rust-процес)
* Посторядковий скан з відстеженням глибини фігурних дужок і базовою токенізацією для рядків/коментарів

## Decision Outcome
Chosen option: "Посторядковий brace-depth скан", because код у проєкті відформатований через `rustfmt` (консистентне відступання), що дозволяє надійно знаходити top-level оголошення по глибині дужок без залежності від зовнішніх бінарних файлів.

### Consequences
* Good, because реалізація залишається чистим JS без зовнішніх залежностей; `units-rs.test.mjs` (10 тестів) підтверджує коректність для pub fn, struct, enum, impl-методів, doc-коментарів і call-graph.
* Bad, because підхід не обробляє код з нестандартним форматуванням (наприклад, незакриті дужки в рядках/макросах без екранування) — обмеження зафіксоване в коді, але не є проблемою для `rustfmt`-відформатованих файлів.

## More Information
Реалізація: `npm/skills/doc-files/js/units-rs.mjs` — функції `extractUnitsRs`, `findClosingBrace`, `docBefore`. Токенізатор у `findClosingBrace` пропускає рядкові літерали (`"..."`) і коментарі (`//`, `/* */`) для точного підрахунку дужок.

---

## ADR Текст гарантії `returnsFalsyOnFail` — мовно-нейтральний

## Context and Problem Statement
Маркер `returnsFalsyOnFail` в `docgen-prompts.mjs` генерував текст `"false/null замість винятку"` — специфічний для JavaScript. Після додавання Rust-підтримки цей текст з'являвся і для `.rs`-файлів, де функції повертають `Err(...)`, а не `false`/`null`.

## Considered Options
* Додати Rust-специфічну гілку (`facts.lang === 'rs'`) з окремим текстом
* Зробити текст мовно-нейтральним: `false`/`null`/`Err`

## Decision Outcome
Chosen option: "Мовно-нейтральний текст `false`/`null`/`Err`", because один текст покриває обидві мови без умовних гілок у `factsSummary` і `guaranteesFromMarkers`.

### Consequences
* Good, because transcript фіксує очікувану користь: текст коректний для JavaScript (`false`/`null`) і для Rust (`Err`) одночасно.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Зміни у `docgen-prompts.mjs`: `factsSummary` рядок ~35 і `guaranteesFromMarkers` рядок ~198. Нові значення: `'За невдачі повертає значення помилки (false/null/Err) замість винятку чи паніки'` та `` '- За невдачі повертає значення помилки (`false`/`null`/`Err`) замість генерування винятку чи паніки.' ``.

---

## ADR `**/target/**` виключено з DOCGEN_IGNORE_GLOBS

## Context and Problem Statement
Після додавання `.rs` до `SOURCE_EXTENSIONS`, `doc-files scan` починав виявляти сотні Rust-файлів у `target/` (Cargo build artifacts), що є артефактами збірки й не повинні документуватися.

## Considered Options
* Додати `**/target/**` до `DOCGEN_IGNORE_GLOBS` у `docgen-ignore.mjs`

## Decision Outcome
Chosen option: "Додати `**/target/**` до `DOCGEN_IGNORE_GLOBS`", because `target/` — стандартна директорія артефактів Cargo і ніколи не містить коду, що потребує документації.

### Consequences
* Good, because transcript фіксує очікувану користь: `doc-files scan` на проєкті `task` повертає рівно 3 `.rs` файли (`build.rs`, `lib.rs`, `main.rs`) без жодного з `target/`.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Зміна у `npm/skills/doc-files/js/docgen-ignore.mjs`. Аналогічна логіка вже існує для `node_modules`, `.git` тощо. Коміт: `f0968598`.
