---
session: 54f63bb7-8e2f-46b8-9c32-658ee5c0f7c6
captured: 2026-06-12T00:31:55+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/54f63bb7-8e2f-46b8-9c32-658ee5c0f7c6.jsonl
---

Готово. Всі три пункти закриті та закомічені:

- **Rust-тести в `docgen-extract.test.mjs`** — 11 нових тестів для `extractFactsRust` (exports, `#[tauri::command]`, struct/enum, markers, header, `///` desc)
- **Стале-доки оновлено** — CRC перегенерований для `docgen-prompts.md`, `docgen-scan.md`, `units-rs.md`; доданий новий `units-js.md`
- **71+11 = 82 тести, 0 fail**

По `doc-files` залишків більше немає.

---

Нижче — ADR-документація цієї сесії:

## ADR Підтримка Rust (.rs) у doc-files: виявлення, ігнорування артефактів, екстракція фактів

## Context and Problem Statement
Проєкт `nitra/task` містить Tauri-застосунок із вихідними файлами на Rust (`.rs`). Конвеєр `doc-files` не виявляв `.rs` файли і не генерував для них документацію. Потрібно було додати Rust до підтримуваних мов, виключити артефакти збірки Cargo (`target/`), і вирішити: генерувати документацію через `oneShotDoc` (як для решти непідтримуваних мов) чи через `orchestratedDoc` (з детермінованим скорингом і секціями).

## Considered Options
* `oneShotDoc` — один виклик LLM на весь файл, без структури (попередня поведінка для Python, Vue)
* `orchestratedDoc` з `extractFactsRust` — детермінований екстрактор фактів + покроковий LLM-конвеєр секцій (Огляд / Поведінка / Публічний API / Гарантії)

## Decision Outcome
Chosen option: "`orchestratedDoc` з `extractFactsRust`", because транскрипт зафіксував чіткий запит на «глибшу» підтримку, а наявна інфраструктура (`extractFacts` → `orchestratedDoc`) вже забезпечувала score=100 для JS/TS; підключення Rust до неї дало score=100 для `lib.rs`/`main.rs` і score=80 для тривіального `build.rs`.

### Consequences
* Good, because transcript фіксує очікувану користь: `lib.rs` score=100 та `main.rs` score=100 із чітко структурованими секціями Огляд/Поведінка/Публічний API/Гарантії; CRC-stamping і `doc-files check` stop-gate працюють для `.rs` файлів.
* Bad, because маркер `returnsFalsyOnFail` генерує мовно-нейтральний текст (`false`/`null`/`Err`), а не специфічний Rust-варіант; call-graph у `extractUnitsRs` порожній (`calls: []`), оскільки повноцінний аналіз залежностей не реалізовано.

## More Information
- `npm/skills/doc-files/js/docgen-scan.mjs` — додано `.rs` до `SOURCE_EXTENSIONS`
- `npm/skills/doc-files/js/docgen-ignore.mjs` — додано `**/target/**`
- `npm/skills/doc-files/js/units-rs.mjs` — новий Rust unit-екстрактор (regex + brace-counting, `#[tauri::command]` exposure, `///` doc)
- `npm/skills/doc-files/js/units.mjs` — диспатч `rs` → `extractUnitsRs`
- `npm/skills/doc-files/js/docgen-extract.mjs` — `extractFactsRust`: header з `//!`, exports з `pub`/exposure-attrs, markers (readOnly/catchesErrors/returnsFalsyOnFail/network/caches), imports std/external
- `npm/skills/doc-files/js/tests/units-rs.test.mjs` — 10 тестів
- `npm/skills/doc-files/js/tests/docgen-extract.test.mjs` — 11 нових Rust-тестів
- omlx API-ключ `1234`, порт `8000` (не 10434); `N_CURSOR_OMLX_URL` не слід встановлювати якщо вже задано `DEFAULT_OMLX_URL = 'http://127.0.0.1:8000/v1/chat/completions'`
- Модель `gemma-4-e2b-it-4bit` потребує ≥3.5GB вільної RAM; за нестачі повертає `finish=null` (empty content)
