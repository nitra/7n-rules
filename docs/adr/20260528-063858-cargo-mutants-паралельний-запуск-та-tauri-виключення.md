# Оптимізація `cargo mutants`: паралельний запуск і виключення `src/lib.rs`

**Status:** Accepted
**Date:** 2026-05-28

## Context and Problem Statement

`runCargoMutants` у `rules/rust/coverage/coverage.mjs` передавав прапор `--in-place`, несумісний із `--jobs`, що обмежувало mutation run до concurrency=1. На реальному Tauri-проєкті з 138 мутантами повний прогін займав ~8 год. Водночас `pub fn run` у `src/lib.rs` є runtime entrypoint Tauri-додатку: без виключення один мутант у цьому файлі давав ~8-хвилинний тайм-аут через запуск усього app shell, руйнуючи тайм-аути всього mutation run.

## Considered Options

**Паралельний запуск:**
- Видалити `--in-place`, додати `--jobs N` з env-override (`CARGO_MUTANTS_JOBS`) і CPU-based default `Math.min(4, Math.max(1, Math.floor(cpus().length / 2)))`.
- Інші варіанти в transcript не обговорювалися.

**Виключення `src/lib.rs`:**
- Додати `src/lib.rs` до `TAURI_KEY_SNIPPETS.exclude_globs` в `cargo_mutants_config.mjs` і синхронізувати `tauri.mdc`.
- Інші варіанти в transcript не обговорювалися.

## Decision Outcome

Chosen option: "Видалити `--in-place`, додати `--jobs N`; додати `src/lib.rs` до `exclude_globs`", because `--in-place` був обхідним маневром для JS/Bun monorepo sandbox — cargo має власну sandbox-логіку через `target/mutants.<i>/`, яка стабільна і обов'язкова для `--jobs > 1`. `src/lib.rs` виконує роль app shell boundary без pure business logic, придатної для mutation-тестування.

### Consequences

- Good, because transcript фіксує ~7.4× прискорення на 8-ядерній M-серії (65 хв замість ~8 год).
- Good, because усунення мутантів із ~8-хвилинним тайм-аутом у `src/lib.rs` прискорює загальний run і зменшує false-timeout failures.
- Bad, because Rust linker є спільним bottleneck — `--jobs 4` дає лише ~2 ядра ефективно; реальний приріст менший за теоретичний. Transcript документує це як прийнятний компроміс.
- Neutral, because edge-кейс свідомого in-place залишається доступним через `.cargo/mutants.toml` або прямий виклик `cargo mutants --in-place`.

## More Information

**Паралельний запуск:**
- `npm/rules/rust/coverage/coverage.mjs` — видалено `--in-place`, додано `--jobs N`
- Нові exports: `resolveJobs(envValue)`, `buildCargoMutantsArgs({ manifestPath, outDir })` — іменовані для unit-тестування
- Default formula: `Math.min(4, Math.max(1, Math.floor(cpus().length / 2)))` — на 1–2 ядрах = 1, на 4 = 2, на 8+ = 4
- Env override: `CARGO_MUTANTS_JOBS` — якщо ціле `>= 1`, застосовується дослівно
- `npm/rules/rust/coverage/tests/coverage.test.mjs` — оновлені тести
- `npm/rules/rust/rust.mdc` version `1.1` → `1.2`
- `@nitra/cursor` bumped `1.28.1` → `1.28.2`; `npm/CHANGELOG.md` оновлено

**Виключення `src/lib.rs`:**
- `npm/rules/tauri/js/cargo_mutants_config.mjs` — `src/lib.rs` додано до `TAURI_KEY_SNIPPETS.exclude_globs`
- `npm/rules/tauri/js/tests/cargo_mutants_config.test.mjs` — `expect(parsed.exclude_globs).toContain('src/lib.rs')`
- `npm/rules/tauri/tauri.mdc` version `1.3` → `1.4` — Canon TOML-фрагмент синхронізовано: `src/lib.rs` між `src/main.rs` і `src/**/android.rs`
