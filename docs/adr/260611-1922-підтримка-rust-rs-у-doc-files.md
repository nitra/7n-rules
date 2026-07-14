---
type: ADR
title: Підтримка Rust `.rs` у команді `doc-files`
description: Вирішено додати файли Rust до списку мов, для яких `doc-files` генерує поведінкову markdown-документацію.
---

**Status:** Accepted
**Date:** 2026-06-11

## Context and Problem Statement

Команда `doc-files` генерувала документацію для `.js`, `.mjs`, `.ts`, `.vue` і `.py`, але ігнорувала Rust-файли `.rs`. Через це проєкти з Rust-кодом не отримували `.docs.md` документацію поруч із кодом.

## Considered Options

- Додати `.rs` до `SUPPORTED_EXTENSIONS` і `LANGUAGE_HINTS` без змін у prompt-builder.
- Оновити prompt template Rust-специфічними інструкціями про `pub fn`, `pub struct`, `pub trait`, `mod` boundaries та `unsafe` blocks.
- Інші варіанти в transcript не обговорювалися.

## Decision Outcome

Chosen option: "Додати `.rs` до `SUPPORTED_EXTENSIONS` і `LANGUAGE_HINTS` без змін у prompt-builder", because transcript фіксує, що `buildDocPrompt` не має мовних гілок і лише передає `languageHint` у prompt як рядок; отже для першої підтримки Rust достатньо передати `Language: Rust`.

### Consequences

- Good, because `.rs` файли тепер потрапляють у `collectFiles` і отримують `.docs.md` документацію нарівні з JS/TS/Vue/Python.
- Good, because зміна мінімальна й не потребує перебудови prompt template.
- Bad, because transcript не містить підтверджених негативних наслідків.
- Neutral, because Rust-специфічні prompt-інструкції згадувалися як можливе покращення, але в реалізації не додавалися.

## More Information

- Змінено `src/commands/doc-files/index.mjs`: `.rs` додано до `SUPPORTED_EXTENSIONS`, а `LANGUAGE_HINTS['.rs'] = 'Rust'`.
- Змінено `.cursor/skills/n-docgen/SKILL.md`: перелік мов оновлено з `js/mjs/ts/vue/py` до `js/mjs/ts/vue/py/rs`.
- Change-файл: `.changes/doc-files-rust-support-1749601234.md`.
- Команда для change-файлу: `bunx n-cursor change --type feat --message 'doc-files: add Rust (.rs) file support'`.

## Update 2026-06-12

- Підтверджено фінальний маршрут для `.rs`: після короткої перевірки `oneShotDoc` реалізовано повну підтримку через `orchestratedDoc`.
- Додано `units-rs.mjs` з brace-counting/regex екстракцією `pub fn`, `pub struct`, `pub enum`, `pub trait`, методів в `impl`, `///` doc-коментарів і exposure-атрибутів на кшталт `#[tauri::command]`.
- `extractFactsRust` у `docgen-extract.mjs` повертає `lang: 'rs'`, exports, markers, imports, internalSymbols і localSymbols, щоб Rust-файли отримували ті самі структуровані секції, що й JS/TS.
- Верифікація з transcript: `doc-files scan` виявляє 3 `.rs` файли без `target/`; `doc-files gen` дав `build.rs=80`, `lib.rs=100`, `main.rs=100`; `doc-files check --git` завершився з exit 0.
- Зафіксовано ризик: глобальний ignore `**/target/**` потрібен для Cargo artifacts, але може виключити не-Rust теку з такою самою назвою, якщо вона використовується для іншого призначення.

## Update 2026-06-12

- Для Rust unit extraction обрано рядковий parser з brace-counting і regex, а не окремий Rust AST-парсер; transcript не містить обговорення підключення AST-залежності.
- `#[tauri::command]` вважається еквівалентом публічного API для документації: функції без `pub`, але з Tauri exposure-атрибутом, включаються в `exports[]` поруч із `pub fn`.
- `.rs` файли переключені з `oneShotDoc` на `orchestratedDoc`, щоб отримувати детермінований score, секцію «Публічний API» і «Гарантії поведінки».
- Зафіксоване обмеження: line-by-line parser може некоректно рахувати дужки в edge-cases з рядковими літералами або коментарями; call graph для Rust не реалізовано.
- Операційний факт із transcript: якщо omlx працює на дефолтному endpoint, `N_CURSOR_OMLX_URL` краще не встановлювати; env override має бути повним URL до `/chat/completions`.

## Update 2026-06-12

- Додано тестове покриття Rust-підтримки: 10 тестів для `units-rs.mjs` і 11 нових Rust-тестів у `docgen-extract.test.mjs`.
- Перевірені сценарії: exports, `#[tauri::command]`, `struct`/`enum`, markers, header із `//!`, опис із `///`.
- Оновлено stale docs із CRC для `docgen-prompts.md`, `docgen-scan.md`, `units-rs.md`; додано `units-js.md`.
- Підсумок transcript: 82 тести, 0 fail.
- Додаткові operational facts: omlx API key `1234`, порт `8000`; модель `gemma-4-e2b-it-4bit` потребує приблизно 3.5GB вільної RAM, а за нестачі памʼяті може давати `finish=null` / empty content.

## Update 2026-06-12

- Уточнено семантику `N_CURSOR_OMLX_URL`: значення env-змінної використовується як повний URL запиту без автоматичного додавання `/chat/completions`.
- Коректні варіанти запуску: не задавати `N_CURSOR_OMLX_URL`, якщо підходить дефолт `http://127.0.0.1:8000/v1/chat/completions`, або задавати повний endpoint, наприклад `http://localhost:8000/v1/chat/completions`.
- Додавання `**/target/**` до `DOCGEN_IGNORE_GLOBS` зафіксовано як необхідне після включення `.rs`, бо інакше scan знаходить build artifacts Cargo замість реальних source-файлів.
- Для `returnsFalsyOnFail` обрано мовно-нейтральний текст `false/null/Err`, щоб гарантія не була JS-специфічно хибною для Rust `Result<...>`.
