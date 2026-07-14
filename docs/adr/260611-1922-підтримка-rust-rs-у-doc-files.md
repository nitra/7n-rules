---
type: ADR
title: Підтримка Rust `.rs` у команді `doc-files`
description: Команда `doc-files` має збирати Rust-файли й передавати в prompt мовну підказку `Rust`.
---

**Status:** Accepted
**Date:** 2026-06-11

## Context and Problem Statement

Команда `doc-files` підтримувала генерацію документації для `.js`, `.mjs`, `.ts`, `.vue` і `.py`, але ігнорувала Rust-файли `.rs`. Через це проєкти або частини проєкту з Rust-кодом не отримували `.docs.md`-документацію через існуючий механізм.

## Considered Options

- Додати `.rs` до списку підтримуваних розширень і `Rust` до мовних підказок без зміни prompt-builder.
- Додати Rust-specific prompt-інструкції про `pub fn`, `pub struct`, `pub trait`, `mod` boundaries і `unsafe`.

## Decision Outcome

Chosen option: "Додати `.rs` до списку підтримуваних розширень і `Rust` до мовних підказок без зміни prompt-builder", because transcript фіксує, що `buildDocPrompt` не має language-specific гілок: `languageHint` передається в LLM-промпт як рядок, тому для підтримки Rust достатньо додати розширення та label.

### Consequences

- Good, because `.rs` файли тепер потрапляють у `collectFiles` і можуть отримувати `.docs.md`-документацію нарівні з JS/TS/Vue/Python.
- Good, because зміна мінімальна й не потребує перебудови prompt-builder.
- Bad, because transcript не містить підтверджених негативних наслідків.
- Neutral, because Rust-specific інструкції про `pub fn`, `pub struct`, `pub trait`, `mod` boundaries і `unsafe` були названі можливими, але не реалізовані в цьому кроці.

## More Information

- Змінений файл: `src/commands/doc-files/index.mjs`.
- `SUPPORTED_EXTENSIONS` розширено значенням `'.rs'`.
- `LANGUAGE_HINTS['.rs'] = 'Rust'`.
- Опис skill оновлено в `.cursor/skills/n-docgen/SKILL.md`: `js/mjs/ts/vue/py/rs`.
- Change-файл: `.changes/doc-files-rust-support-1749601234.md`, створений через `bunx n-cursor change --type feat --message 'doc-files: add Rust (.rs) file support'`.
