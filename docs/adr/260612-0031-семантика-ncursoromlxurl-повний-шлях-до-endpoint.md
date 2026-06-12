---
session: 54f63bb7-8e2f-46b8-9c32-658ee5c0f7c6
captured: 2026-06-12T00:31:31+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/54f63bb7-8e2f-46b8-9c32-658ee5c0f7c6.jsonl
---

Задача ще триває (3 сесії конкурують за omlx). Поки вона завершується — виконую основне завдання: аналіз transcript і продукую ADR.

---

## ADR Семантика N_CURSOR_OMLX_URL — повний шлях до endpoint

## Context and Problem Statement
При запуску `doc-files gen` з кастомним `N_CURSOR_OMLX_URL=http://localhost:8000/v1` усі файли повертали `omlx empty content (finish=null)`. За замовчуванням `DEFAULT_OMLX_URL = 'http://127.0.0.1:8000/v1/chat/completions'` вже містить повний шлях, але env-змінна використовується як-є — без дописування `/chat/completions`.

## Considered Options
* Env-змінна містить повний URL (включно з `/chat/completions`)
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Env-змінна містить повний URL", because `callOmlxRaw` у `npm/lib/omlx.mjs` підставляє `N_CURSOR_OMLX_URL` напряму як URL запиту без жодної конкатенації — або повний шлях, або дефолт.

### Consequences
* Good, because transcript фіксує очікувану користь: після видалення env-override (повернення до дефолту) всі 3 Rust-файли згенеровано без помилок.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Фікс: запускати без `N_CURSOR_OMLX_URL` (дефолт `http://127.0.0.1:8000/v1/chat/completions`) або передавати повний URL: `N_CURSOR_OMLX_URL=http://localhost:8000/v1/chat/completions`. Файл: `npm/lib/omlx.mjs`.

---

## ADR Виключення `**/target/**` із doc-files scan для Rust

## Context and Problem Statement
Після додавання `.rs` до `SOURCE_EXTENSIONS` команда `doc-files scan` починала виявляти тисячі авто-генерованих Rust-файлів у директорії `target/` (Cargo build artifacts), що робило черги нереалістичними для ручного прогону.

## Considered Options
* Додати `**/target/**` до ignore-списку у `docgen-ignore.mjs`
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Додати `**/target/**` до ignore-списку", because без цього exclude scan повертав сотні `.rs` файлів build-артефактів замість 3 реальних файлів проєкту.

### Consequences
* Good, because transcript фіксує очікувану користь: після додавання ignore scan знайшов рівно 3 `.rs` файли (`build.rs`, `lib.rs`, `main.rs`) без `target/` hits.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Зміна у `npm/skills/doc-files/js/docgen-ignore.mjs:7`. Закомічено разом із `.rs` у `SOURCE_EXTENSIONS` (`docgen-scan.mjs:13`) у коміті з повідомленням `feat(npm/skills/doc-files): doc-files: підтримка Rust (.rs)`.

---

## ADR Rust exports: `pub fn` + атрибут `#[tauri::command]` як еквівалентні маркери публічного API

## Context and Problem Statement
У `lib.rs` проєкту nitra/task функції `scan_tasks`, `find_tasks_dir` тощо оголошені без `pub`, але доступні зовні через `#[tauri::command]` — це Tauri-специфічна форма export, яка не виражена через стандартний `pub` Rust.

## Considered Options
* Вважати публічними лише `pub fn` (стандартний Rust visibility)
* Вважати публічними і `pub fn`, і `fn` з атрибутами-exposure (зокрема `#[tauri::command]`)
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Обидва `pub fn` і `#[tauri::command]`", because ці функції є реальною публічною поверхнею Tauri-бекенду незалежно від `pub` ключового слова; відображення їх у `exports` дозволяє `orchestratedDoc` генерувати секцію «Публічний API» з коректним переліком.

### Consequences
* Good, because transcript фіксує очікувану користь: `extractFacts` на `lib.rs` повернув 5 exports (включно з 4 tauri-командами), `doc-files gen` досяг `score=100`.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Реалізовано в `extractFactsRust` у `npm/skills/doc-files/js/docgen-extract.mjs`. Атрибути-exposure визначаються regex-рядком перед `fn`-оголошенням; поточний список: `tauri::command`. Тести: `npm/skills/doc-files/js/tests/docgen-extract.test.mjs` (секція `Rust (.rs)`).

---

## ADR Мовно-нейтральний текст гарантії `returnsFalsyOnFail`

## Context and Problem Statement
Маркер `returnsFalsyOnFail` спрацьовував для Rust-файлів з `-> Result<` сигнатурою, але генерував JS-специфічний рядок `"false/null замість винятку"` у секції «Гарантії поведінки», що є буквально хибним для Rust (Rust повертає `Err(...)`, не `false`/`null`).

## Considered Options
* Мовно-нейтральний текст для обох мов: `false/null/Err`
* Окремий текст для `lang === 'rs'`: `Повертає Err(...) замість паніки`
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Мовно-нейтральний текст `false/null/Err`", because це мінімальна зміна, яка прибирає буквальну хибність для Rust без ускладнення branching-логіки у `docgen-prompts.mjs`.

### Consequences
* Good, because transcript фіксує очікувану користь: рядок стає точним і для JS (`false`/`null`), і для Rust (`Err`).
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Зміни у `npm/skills/doc-files/js/docgen-prompts.mjs` рядки 35 і 198 (`factsSummary` і `guaranteesFromMarkers`). Тест-покриття через `docgen-extract.test.mjs` (маркери Rust).

---

Генерація doc-файлів все ще триває у фоні. Як тільки завершиться — закомічу оновлені docs і зроблю `n-cursor change`.
