---
session: 54f63bb7-8e2f-46b8-9c32-658ee5c0f7c6
captured: 2026-06-11T19:27:20+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/54f63bb7-8e2f-46b8-9c32-658ee5c0f7c6.jsonl
---

Можна тимчасово знизити `memory_guard_tier` в omlx settings, але це потребує редагування ~/.omlx/settings.json та рестарту сервера.

Найпростіший шлях — звільнити памʼять або почекати.

Насправді перевірка вже успішна: scan виявляє `.rs` файли, ignore `target/` працює. Результат:
[assistant]
Тест виявлення Rust-файлів пройшов успішно. Генерація заблокована memory guard (модель 3.5GB, вільно ~1.8GB).

**Підсумок того що зроблено:**
1. `docgen-scan.mjs` — додано `.rs` до `SOURCE_EXTENSIONS`
2. `docgen-ignore.mjs` — додано `**/target/**` до ignore list (Rust build output)
3. Скан підтверджує 3 файли: `build.rs`, `lib.rs`, `main.rs` — всі правильно виявлені, `target/` ігнорується

**Для завершення тесту** потрібно або звільнити RAM (закрити важкі процеси) або тимчасово знизити `memory_guard_tier` у `~/.omlx/settings.json`. Хочеш щоб я показав як?

---
END OF TRANSCRIPT

## ADR Підтримка Rust (`.rs`) у `doc-files` скілі

## Context and Problem Statement
Скіл `doc-files` (`npm/skills/doc-files/`) підтримував виявлення лише JS/TS/Vue/Python файлів. Коли проєкт містить Rust-код (наприклад `app/src-tauri/*.rs`), файли не потрапляли до черги документування. Крім того, для Rust-проєктів каталог `target/` (Rust build output) не ігнорувався, що призводить до виявлення сотень авто-генерованих файлів.

## Considered Options
* Додати `.rs` до `SOURCE_EXTENSIONS` у `docgen-scan.mjs` (one-shot шлях, як Vue/Python)
* Повноцінна підтримка з AST-парсером через `tree-sitter-rust` + новий модуль `units-rs.mjs` (orchestrated path, як JS/TS)

## Decision Outcome
Chosen option: "Мінімальна підтримка one-shot (додати `.rs` до `SOURCE_EXTENSIONS`)", because існуючий `oneShotDoc()` шлях у `docgen-gen.mjs` вже обробляє файли з `extractFacts()` → `{ unsupported: true }`, тому жодних змін у генераторі не потрібно; повний AST-парсер виправданий лише при значній кількості `.rs` файлів у проєкті.

### Consequences
* Good, because одна зміна в `docgen-scan.mjs:14` вмикає виявлення `.rs` файлів без жодних нових залежностей.
* Good, because transcript фіксує очікувану користь: скан коректно виявив 3 файли (`app/src-tauri/build.rs`, `app/src-tauri/src/lib.rs`, `app/src-tauri/src/main.rs`), каталог `target/` виключено.
* Bad, because Rust-файли обробляються через `oneShotDoc()` без структурного розуміння `pub fn`/`pub struct`/`impl` — якість документації нижча ніж для JS/TS.

## More Information
Змінені файли:
- `npm/skills/doc-files/js/docgen-scan.mjs` — додано `'.rs'` до `SOURCE_EXTENSIONS`
- `npm/skills/doc-files/js/docgen-ignore.mjs` — додано `'**/target/**'` до `DOCGEN_IGNORE_GLOBS`

Команда перевірки: `node npm/bin/n-cursor.js doc-files scan --root /Users/vitaliytv/www/nitra/task`
Генерація заблокована memory guard (`gemma-4-e2b-it-4bit` 3.5GB > ~1.8GB вільної RAM під час тесту).
