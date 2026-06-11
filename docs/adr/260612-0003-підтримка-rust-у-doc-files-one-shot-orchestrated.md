---
session: 54f63bb7-8e2f-46b8-9c32-658ee5c0f7c6
captured: 2026-06-12T00:03:58+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/54f63bb7-8e2f-46b8-9c32-658ee5c0f7c6.jsonl
---

Хуки автоматично зробили два коміти:
- `aeb4ea9f cursor` — всі doc-files зміни (units-rs.mjs, docgen-extract.mjs, units.mjs, docgen-scan.mjs)
- `78ba38b2 s` — change файл `npm/skills/doc-files/.changes/260612-0002.md`

Робоче дерево чисте. Change файл створено та все заком'ічено.

---

## ADR Підтримка Rust у doc-files (one-shot → orchestrated)

## Context and Problem Statement
Скіл `doc-files` підтримував документування лише JavaScript/TypeScript (через AST-парсер oxc), Vue та Python (через `oneShotDoc`). Проєкт `/Users/vitaliytv/www/nitra/task` містить Rust-файли у `app/src-tauri/`, які scanner не виявляв і не документував. Потрібно було розширити підтримку до `.rs` файлів.

## Considered Options
* **Мінімальна підтримка** — додати `.rs` до `SOURCE_EXTENSIONS` і залишити маршрут `oneShotDoc` (як для Vue/Python)
* **Повна підтримка** — додати `units-rs.mjs` з regex-екстракцією Rust-юнітів та `extractFactsRust` в `docgen-extract.mjs`, щоб `.rs` файли проходили `orchestratedDoc`

## Decision Outcome
Chosen option: "Повна підтримка", because користувач явно запросив "глибшу" підтримку після того, як one-shot варіант продемонстрував якість генерації score≈70-80 без секцій Гарантії та Публічний API.

### Consequences
* Good, because `lib.rs` і `main.rs` отримали score=100 через `orchestratedDoc` з детермінованими маркерами (`readOnly`, `catchesErrors`, `returnsFalsyOnFail`), секціями Публічний API та Гарантії поведінки.
* Bad, because `**/target/**` доданий до `DOCGEN_IGNORE_GLOBS` глобально — це необхідно для Rust, але може несподівано виключити `target/` і в не-Rust проєктах, якщо таке ім'я теки використовується для іншого призначення.

## More Information
- `npm/skills/doc-files/js/docgen-scan.mjs` — `.rs` додано до `SOURCE_EXTENSIONS`
- `npm/skills/doc-files/js/docgen-ignore.mjs` — `**/target/**` додано (Cargo build artifacts)
- `npm/skills/doc-files/js/units-rs.mjs` (новий) — brace-counting екстрактор: `pub fn`, `pub struct`, `pub enum`, `pub trait`, методи в `impl` блоках, `///` doc-коментарі, `#[tauri::command]` exposure detection
- `npm/skills/doc-files/js/units.mjs` — додано `case 'rs': return extractUnitsRs(src)`
- `npm/skills/doc-files/js/docgen-extract.mjs` — `extractFactsRust`: header з `//!` inner doc comments, exports включають `pub fn` та функції з `#[tauri::command]`/`#[tauri::command_async]`, маркери readOnly/catchesErrors/returnsFalsyOnFail/network/caches, imports (stdlib/external)
- Верифіковано: `doc-files scan` виявляє 3 `.rs` файли без `target/`; `doc-files gen` score: build.rs=80, lib.rs=100, main.rs=100; `doc-files check --git` exit 0; CRC-drift детектується коректно
