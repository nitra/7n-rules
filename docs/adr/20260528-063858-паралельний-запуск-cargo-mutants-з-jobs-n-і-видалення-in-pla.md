---
session: c02e867c-0213-431d-b3ab-4963acd0ece6
captured: 2026-05-28T06:38:58+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/c02e867c-0213-431d-b3ab-4963acd0ece6.jsonl
---

## ADR Паралельний запуск `cargo mutants` з `--jobs N` і видалення `--in-place`

## Context and Problem Statement
`runCargoMutants` у `rules/rust/coverage/coverage.mjs` передавав `--in-place`, що несумісне з `--jobs`, обмежуючи мутаційне тестування до concurrency=1. На реальному Tauri-проєкті з 138 мутантами це давало ~8 год. Завдання — додати `--jobs N` і прибрати `--in-place`, щоб задіяти кілька CPU.

## Considered Options
* Видалити `--in-place`, додати `--jobs N` з env-override (`CARGO_MUTANTS_JOBS`) і CPU-based default `Math.min(4, Math.max(1, Math.floor(cpus().length / 2)))`.
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Видалити `--in-place`, додати `--jobs N`", because `--in-place` був обхідним маневром для JS/Bun monorepo sandbox — cargo має власну sandbox-логіку через `target/mutants.<i>/`, яка стабільна і обов'язково потрібна для `--jobs > 1`. Видалення не ламає жоден розумний user setup; edge-кейс свідомого in-place залишається доступним через `.cargo/mutants.toml` або прямий виклик `cargo mutants --in-place`.

### Consequences
* Good, because transcript фіксує очікувану користь: ~7.4× прискорення (65 хв замість ~8 год на 8-ядерній M-серії).
* Bad, because Rust linker є спільним bottleneck — `--jobs 4` дає лише ~2 ядра ефективно; реальний приріст менший за теоретичний. Transcript документує це як прийнятний компроміс.

## More Information
- Змінені файли: `npm/rules/rust/coverage/coverage.mjs`, `npm/rules/rust/coverage/tests/coverage.test.mjs`, `npm/rules/rust/rust.mdc` (version `1.1` → `1.2`).
- Нові exports: `resolveJobs(envValue)`, `buildCargoMutantsArgs({ manifestPath, outDir })` — іменовані, для unit-тестування.
- Default formula: `Math.min(4, Math.max(1, Math.floor(cpus().length / 2)))` — на 1–2 ядрах = 1, на 4 = 2, на 8+ = 4.
- Env override: `CARGO_MUTANTS_JOBS` — якщо ціле `>= 1`, застосовується дослівно.
- `@nitra/cursor` bumped `1.28.1` → `1.28.2`; `npm/CHANGELOG.md` оновлено.

---

## ADR `src/lib.rs` у Tauri canonical `exclude_globs`

## Context and Problem Statement
`pub fn run` у `src/lib.rs` є runtime entrypoint Tauri-додатку, аналогічним до `src/main.rs`. Без виключення один мутант у цьому файлі давав ~8 хв тайм-ауту через запуск усього app shell, що руйнувало тайм-аути mutation run.

## Considered Options
* Додати `src/lib.rs` до `TAURI_KEY_SNIPPETS.exclude_globs` в `cargo_mutants_config.mjs` і синхронізувати `tauri.mdc`.
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Додати `src/lib.rs` до `exclude_globs`", because `src/lib.rs` виконує роль app shell boundary — запускає весь runtime і не містить pure/business logic, яку варто тестувати mutation-тестами.

### Consequences
* Good, because transcript фіксує очікувану користь: усунення мутантів із ~8-хвилинним тайм-аутом на запуск, що прискорює загальний run і зменшує false-timeout failures.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- Змінені файли: `npm/rules/tauri/js/cargo_mutants_config.mjs`, `npm/rules/tauri/js/tests/cargo_mutants_config.test.mjs`, `npm/rules/tauri/tauri.mdc` (version `1.3` → `1.4`).
- Canon TOML-фрагмент у `tauri.mdc` синхронізований: `src/lib.rs` додано між `src/main.rs` і `src/**/android.rs`.
- Тест `cargo_mutants_config.test.mjs` додає перевірку `expect(parsed.exclude_globs).toContain('src/lib.rs')`.
