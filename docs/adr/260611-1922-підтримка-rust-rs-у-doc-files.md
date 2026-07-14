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
