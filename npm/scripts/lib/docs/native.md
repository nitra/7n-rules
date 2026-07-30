---
type: JS Module
title: native.mjs
resource: npm/scripts/lib/native.mjs
docgen:
  crc: 2ffe71a2
  model: omlx/gemma-4-e4b-it-OptiQ-4bit
  tier: local-min
  score: 80
---

## Огляд

Loader napi-аддона `rules-core` (`crates/rules-napi` → `rules-core`) —
за зразком `llm-lib/lib/internal/native.mjs` (T2 фази 1,
`docs/specs/2026-07-30-rules-v2-rust-core-migration.md`).

Порядок пошуку:
  1. N_RULES_NATIVE_ADDON — явний override шляху до аддона (dev / CI / тести).
  2. Platform-підпакет `@7n/rules-<platform>-<arch>` (napi-артефакт
     `rules-napi.<triple>.node`).
  3. Dev-fallback: `<repoRoot>/target/release|debug/` (сирий cdylib з
     `cargo build -p rules-napi`) та вивід `napi build` у `crates/rules-napi/`.
  4. Інакше — зрозуміла помилка з підказкою `cargo build --release -p rules-napi`.

Аддон завантажується через `process.dlopen` — працює і для `.node`, і для
сирих cdylib (`.dylib`/`.so`), і під bun (не лише node). Результат
кешується (одне завантаження на процес). Без JS-fallback на неоголошеній
платформі — hard error, свідома межа v1 (darwin-arm64, linux-x64), Р1 спеки.

Додатково (відмінність від `llm-lib`-loader-а): після dlopen звіряється
`addon.contractVersion()` з [`EXPECTED_CONTRACT_VERSION`] — розбіжність
означає несумісний DTO-контракт `rules-core` ⇄ `rules-napi` (Р10 спеки,
enforcement-точка за зразком `requiresPluginApi`). Звірка — один раз, при
першому завантаженні.

## Публічний API

- EXPECTED_CONTRACT_VERSION — Очікувана версія JSON DTO-контракту `rules-core` ⇄ `rules-napi` (Р10 спеки).
- resolveNativeAddon — Резолвить шлях до napi-аддона `rules-core`.
- loadNative — Кешований доступ до аддона (одне завантаження на процес). Після dlopen
звіряє `addon.contractVersion()` з [`EXPECTED_CONTRACT_VERSION`] — до
кешування, тож розбіжність кидає щоразу (не залипає в невдалому стані).

## Сценарії використання

- `npm/scripts/lib/tests/native.test.mjs` (resolveNativeAddon (порядок пошуку); loadNative (кеш процесу)) — N_RULES_NATIVE_ADDON має найвищий пріоритет; platform-підпакет: резолвиться @7n/rules-<key> з napi-суфіксом; linux-x64 мапиться на суфікс linux-x64-gnu; dev-fallback: release-cdylib перемагає debug; dev-fallback: на linux шукається .so, а останній кандидат — вивід napi build; ще 5

## Гарантії поведінки

- Власних операцій запису (ФС/БД) у файлі немає; виклики імпортованих модулів можуть писати.
- Кешує результати в межах одного прогону.
