---
type: ADR
title: Підтримка Rust `.rs` у команді `doc-files`
description: Команда `doc-files` має обробляти Rust-файли через додавання `.rs` до списку підтриманих розширень і мовних підказок.
---

**Status:** Accepted
**Date:** 2026-06-11

## Context and Problem Statement

Команда `doc-files` генерувала документацію для `.js`, `.mjs`, `.ts`, `.vue` і `.py`, але не підтримувала Rust-файли `.rs`. Через це Rust-код не потрапляв у збір файлів і не отримував поведінкову `.docs.md` документацію.

## Considered Options

- Додати `.rs` до `SUPPORTED_EXTENSIONS` і `LANGUAGE_HINTS` без змін у prompt builder.
- Оновити prompt template окремими Rust-aware інструкціями про `pub fn`, `pub struct`, `pub trait`, `mod` boundaries та `unsafe` blocks.

## Decision Outcome

Chosen option: "Додати `.rs` до `SUPPORTED_EXTENSIONS` і `LANGUAGE_HINTS` без змін у prompt builder", because transcript фіксує, що `buildDocPrompt` не має мовних гілок: `languageHint` передається як рядок у LLM prompt, тому достатньо передати `Language: Rust`.

### Consequences

- Good, because `.rs` файли тепер проходять через `collectFiles` і отримують `.docs.md` документацію нарівні з JS, TS, Vue та Python.
- Bad, because transcript не містить підтверджених негативних наслідків.
- Neutral, because Rust-specific prompt guidance не додано; transcript фіксує, що поточна архітектура prompt builder не потребує мовних гілок для цієї зміни.

## More Information

- Змінений файл: `src/commands/doc-files/index.mjs`.
- `SUPPORTED_EXTENSIONS`: додано `'.rs'`.
- `LANGUAGE_HINTS`: додано `'.rs': 'Rust'`.
- Опис skill оновлено з `js/mjs/ts/vue/py` на `js/mjs/ts/vue/py/rs` у `.cursor/skills/n-docgen/SKILL.md`.
- Change-файл: `.changes/doc-files-rust-support-1749601234.md`, створений через `bunx n-cursor change --type feat --message 'doc-files: add Rust (.rs) file support'`.
