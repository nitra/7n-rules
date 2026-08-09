---
type: JS Module
title: native.mjs
resource: llm-lib/lib/internal/native.mjs
docgen:
  crc: f912be12
  model: omlx/gemma-4-e4b-it-OptiQ-4bit
  tier: local-min
  score: 70
---

## Огляд

Loader napi-аддона `llm-lib` (Rust-ядро `llm-lib/crates/llm-lib-napi`
→ `llm-lib`) — за зразком `mt/npm/lib/core/native.mjs`.

Порядок пошуку (залежить від оточення — див. [`isSourceTree`]):
  1. N_LLM_LIB_NATIVE_ADDON — явний override шляху до аддона (dev / CI / тести).
  2. **Лише у вихідному дереві** (`<repoRoot>/llm-lib/crates/llm-lib-napi/Cargo.toml`
     існує): локальна збірка `<repoRoot>/target/release|debug/` (сирий cdylib
     з `cargo build -p llm-lib-napi`) та вивід `napi build` у
     `llm-lib/crates/llm-lib-napi/`.
  3. Platform-підпакет `@7n/llm-lib-<platform>-<arch>` (napi-артефакт
     `llm-lib-napi.<triple>.node`).
  4. Той самий fallback на локальну збірку поза вихідним деревом
     (у продакшені поведінка така сама, як до фіксу).
  5. Інакше — зрозуміла помилка з підказкою.

ЧОМУ порядок різний (симетрично до `npm/scripts/lib/native.mjs`, фікс
2026-08-03): у репо локальний `cargo build -p llm-lib-napi` мовчки
перекривався опублікованим підпакетом із `node_modules` — правки Rust-ядра
не проявлялися, а «фейли LLM-контуру» діагностувалися як помилки коду.
У користувача ж підпакет — єдине авторитетне джерело (запінений lockstep до
версії `@7n/llm-lib`), тож сторонній `target/` поруч не має його перебивати.

Аддон завантажується через `process.dlopen` — працює і для `.node`, і для
сирих cdylib (`.dylib`/`.so`). Результат кешується (одне завантаження на процес).
Без JS-fallback на неоголошеній платформі — hard error, свідома межа v1
(darwin-arm64, linux-x64), не регресія.

## Публічний API

- nativeAddonChain — Ланцюг кандидатів аддона в порядку пріоритету.

Повертає СПИСОК, а не один шлях, свідомо: `existsSync` — не доказ, що аддон
завантажиться (файл може бути з іншої платформи, побитий, або `existsSync`
підмінений моком у тесті, що не має до аддона стосунку — саме так
`gen-tests.test.mjs` валив увесь контур). Остаточний вибір робить
[`loadNative`], пробуючи кандидатів по черзі.
- resolveNativeAddon — Резолвить шлях до napi-аддона `llm-lib` — перший кандидат ланцюга
[`nativeAddonChain`]. Фактичний вибір з урахуванням невдалих dlopen
робить [`loadNative`].
- loadNative — Кешований доступ до аддона (одне завантаження на процес).

## Сценарії використання

- `llm-lib/tests/native.test.mjs` (resolveNativeAddon (порядок пошуку); resolveNativeAddon (вихідне дерево vs прод)) — N_LLM_LIB_NATIVE_ADDON має найвищий пріоритет; platform-підпакет: резолвиться @7n/llm-lib-<key> з napi-суфіксом; linux-x64 мапиться на суфікс linux-x64-gnu; dev-fallback: release-cdylib перемагає debug; dev-fallback: на linux шукається .so, а останній кандидат — вивід napi build; ще 8

## Гарантії поведінки

- Власних операцій запису (ФС/БД) у файлі немає; виклики імпортованих модулів можуть писати.
- Кешує результати в межах одного прогону.
