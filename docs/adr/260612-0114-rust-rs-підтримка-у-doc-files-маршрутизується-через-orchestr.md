---
session: 54f63bb7-8e2f-46b8-9c32-658ee5c0f7c6
captured: 2026-06-12T01:14:57+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/54f63bb7-8e2f-46b8-9c32-658ee5c0f7c6.jsonl
---

91 файл закомічено. `doc-files check --git` → exit 0.

---

Тепер виконую роль ADR-хука — фіксую рішення з сесії:

## ADR Rust `.rs` підтримка у doc-files: маршрутизується через `orchestratedDoc`, а не `oneShotDoc`

## Context and Problem Statement
Файли `.rs` не були у `SOURCE_EXTENSIONS` і потрапляли до `oneShotDoc` (один LLM-виклик без секційного аналізу), що давало документацію без детермінованих маркерів, Публічного API і Гарантій поведінки.

## Considered Options
* `oneShotDoc` — один виклик, весь файл одразу, без скорингу
* `orchestratedDoc` через `extractFactsRust` — повний pipeline: факт-екстракція → секції → scoring

## Decision Outcome
Chosen option: "`orchestratedDoc` через `extractFactsRust`", because transcript фіксує score=100 для `lib.rs` / `main.rs` з секціями Огляд / Поведінка / Публічний API / Гарантії, тоді як `oneShotDoc` давав лише маркований список без скорингу.

### Consequences
* Good, because детермінований scoring (0-100), секція «Гарантії поведінки» без LLM-токенів, підтримка маркерів `readOnly` / `catchesErrors` / `returnsFalsyOnFail`.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Файли: `npm/skills/doc-files/js/docgen-extract.mjs` (`extractFactsRust`), `npm/skills/doc-files/js/units-rs.mjs`, `npm/skills/doc-files/js/units.mjs`. Команда: `N_CURSOR_DOCGEN_MODEL=omlx/gemma-4-e2b-it-4bit node npm/bin/n-cursor.js doc-files gen --root .`

---

## ADR `#[tauri::command]`-функції вважаються публічним API у `extractFactsRust`

## Context and Problem Statement
У `lib.rs` проєкту `task` функції `scan_tasks`, `find_tasks_dir` та ін. не мають `pub`, але доступні фронтенду через Tauri-команди. Питання: чи включати їх у `facts.exports`.

## Considered Options
* Тільки `pub fn` — стандартна Rust-видимість
* `pub fn` + функції з атрибутом `#[tauri::command]` — фактична публічна поверхня

## Decision Outcome
Chosen option: "`pub fn` + `#[tauri::command]`", because transcript фіксує що `extractFacts` для `lib.rs` повертає всі 5 функцій в `exports`, включно з непублічними Tauri-командами; LLM коректно описує кожну.

### Consequences
* Good, because transcript фіксує очікувану користь: всі команди потрапляють у секцію «Публічний API».
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Файл: `npm/skills/doc-files/js/docgen-extract.mjs`, функція `extractFactsRust`. Атрибут `#[tauri::command]` перед рядком `fn` — достатній маркер public exposure.

---

## ADR `npm/rules/k8s/js/manifests.mjs` (303 KB) виключено через `DOCGEN_IGNORE_GLOBS`

## Context and Problem Statement
Файл `manifests.mjs` (6 683 рядки, 303 KB) викликав `curl: (18) transfer closed with outstanding read data remaining` при кожній спробі генерації через omlx — модель не могла прийняти запит такого розміру.

## Considered Options
* Повторні спроби генерації
* Додати точний glob до `DOCGEN_IGNORE_GLOBS` у `docgen-ignore.mjs`

## Decision Outcome
Chosen option: "Додати точний glob до `DOCGEN_IGNORE_GLOBS`", because transcript підтверджує що після додавання `'npm/rules/k8s/js/manifests.mjs'` до списку `doc-files check --git` повертає exit 0.

### Consequences
* Good, because batch-прогін завершується без помилок; файл більше не блокує `check` stop-gate.
* Bad, because `manifests.mjs` не матиме автоматичної документації — потрібна ручна або спеціальна обробка великих файлів.

## More Information
Файл: `npm/skills/doc-files/js/docgen-ignore.mjs`. Розмір-ліміт для omlx залежить від доступної RAM (memory_guard_tier).

---

## ADR `returnsFalsyOnFail` маркер — мовно-нейтральний текст гарантії

## Context and Problem Statement
`guaranteesFromMarkers` і `factsSummary` виводили JS-специфічний текст `"false/null замість винятку"`, який хибно описував Rust-файли, де повертається `Err(...)`, а не `false`/`null`.

## Considered Options
* Окремі рядки за `facts.lang === 'rs'`
* Єдиний нейтральний рядок `false/null/Err`

## Decision Outcome
Chosen option: "Єдиний нейтральний рядок `false/null/Err`", because transcript фіксує що після правки `guaranteesFromMarkers` score=100 збережено і текст описує обидві мови без JS-специфічності.

### Consequences
* Good, because transcript фіксує очікувану користь: одна гілка коду, нейтральний текст для JS і Rust.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Файл: `npm/skills/doc-files/js/docgen-prompts.mjs`, рядки `factsSummary` і `guaranteesFromMarkers`.
