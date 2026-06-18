---
type: ADR
title: "cargo-mutants: інкрементальна мутація через `--in-diff`"
---

# cargo-mutants: інкрементальна мутація через `--in-diff`

**Status:** Accepted
**Date:** 2026-06-01

## Context and Problem Statement

`cargo-mutants` не має persistent-кешу результатів між запусками (на відміну від Stryker з `incremental.json`). Кожен прогін мутував увесь Rust-код наново — навіть на PR зі зміною в одному файлі (~138 мутантів на весь crate проти 3-5 у diff).

## Considered Options

- `--in-diff <file>` — генерувати `git diff <base>...HEAD` перед прогоном і передавати файлом; cargo-mutants мутує лише рядки з diff
- `--shard K/N` — горизонтальне масштабування між CI-раннерами
- `--baseline=skip` — пропуск baseline-прогону коли тести вже зелені
- `--test-tool nextest` — швидший per-mutant test runner

## Decision Outcome

Chosen option: "`--in-diff` через env `CARGO_MUTANTS_BASE_REF`", because це найближчий еквівалент Stryker incremental для cargo-mutants: мутуються лише рядки, змінені відносно base ref; повний прогін зберігається для `main` (коли env не задана).

### Consequences

- Good, because на PR із невеликим diff кількість мутантів скорочується з ~138 до 3-5; порожній diff автоматично дає `0/0` без запуску cargo-mutants.
- Good, because graceful fallback — якщо `git diff` падає (detached HEAD, відсутній remote), провайдер автоматично переходить на повний прогін без помилки.
- Bad, because це не persistent-кеш результатів: якщо той самий мутант перевірявся раніше (але не в поточному diff), вердикт не береться з файлу — він перевіряється знову.

## More Information

- Реалізовано у `npm/rules/rust/coverage/coverage.mjs`: нові хелпери `resolveBaseRef(env)`, `runGitDiff(baseRef, cwd)`, оновлений `buildCargoMutantsArgs({ manifestPath, outDir, jobs, diffPath? })`, оновлений `collect()` — генерує diff-файл у tmpdir і прибирає в `finally`.
- Env: `CARGO_MUTANTS_BASE_REF` — порожньо = повний прогін; виставлено (напр. `origin/main`) = `--in-diff <tmpfile>`.
- Тести: `npm/rules/rust/coverage/tests/coverage.test.mjs` — 19 тестів, у т.ч. нові блоки для `resolveBaseRef` і `--in-diff`-гілки `buildCargoMutantsArgs`.
- Правило `npm/rules/rust/rust.mdc` бампнуто з v1.2 до v1.4; секції «Incremental mutation через `--in-diff`» і «Кешування `target/` у CI» додані.
- CI-кеш: `Swatinem/rust-cache@v2` (`cache-targets: true`, `shared-key: cargo-mutants`) — тепла компіляція є найбільшим абсолютним виграшем; без кешу cold linker є основним bottleneck навіть при `--jobs > 1`.
- Change-файли: `npm/.changes/1780340121953-11c872.md` (minor, Added — `--in-diff`), `npm/.changes/1780340741453-64d1ed.md` (patch, Added — CI-кеш).
- Пов'язаний ADR: `20260528-063858-cargo-mutants-паралельний-запуск-та-tauri-виключення.md`.

## Update 2026-06-01

### Додаткові деталі реалізації

- Хелпери у `npm/rules/rust/coverage/coverage.mjs`: `resolveBaseRef(env)` (читає `CARGO_MUTANTS_BASE_REF`), `runGitDiff(baseRef, cwd)` (генерує tmpfile), оновлений `buildCargoMutantsArgs({ manifestPath, outDir, jobs, diffPath? })`, оновлений `collect()` — прибирає tmpfile у `finally`.
- Тест-блоки у `npm/rules/rust/coverage/tests/coverage.test.mjs`: `resolveBaseRef` (3 кейси), `--in-diff`-гілка `buildCargoMutantsArgs` (2 кейси), разом 19 тестів.
- CI-кеш: секція «Кешування `target/` у CI» у `rust.mdc` (v1.3→1.4) — `Swatinem/rust-cache@v2` з `cache-targets: true`, `shared-key: cargo-mutants`; обґрунтування: cold linker є основним bottleneck при `--jobs > 1` без кешу.
- Латентна вада: каталог `rules/rust/coverage/` потрапляє під gitignore-патерн `**/coverage/` — oxlint/eslint пропускають цей код у project-wide прогоні.
- Інцидент під час сесії: `git pull --rebase` перетер робоче дерево → правки переписані наново.
