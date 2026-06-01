---
session: 1f6e893c-e424-4755-a387-b05d8e30ffe4
captured: 2026-06-01T22:04:15+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-cursor/1f6e893c-e424-4755-a387-b05d8e30ffe4.jsonl
---

[assistant]
[thinking]
The transcript shows an AI coding session where:

1. The user asked about incremental mutation testing (Stryker) behavior - whether it recomputes mutations from scratch or uses a hash cache
2. The discussion revealed that Stryker has `incremental: true` with `incrementalFile: 'reports/stryker/incremental.json'`, but cargo-mutants doesn't have a similar persistent cache
3. The user asked how to improve cargo-mutants in this direction
4. The discussion led to a decision to implement `--in-diff` flag support for cargo-mutants to achieve incremental-like behavior by only mutating code that changed relative to a base git ref
5. The implementation was done in `npm/rules/rust/coverage/coverage.mjs` with:
- New `resolveBaseRef()` function that reads `CARGO_MUTANTS_BASE_REF` env var
- New `runGitDiff()` function that generates a git diff file
- Updated `buildCargoMutantsArgs()` to accept `diffPath` parameter and add `--in-diff` flag
- Updated `collect()` to generate diff when base ref is available, then pass to cargo-mutants
6. Tests were added/updated in `coverage.test.mjs`
7. `rust.mdc` was bumped from v1.2 to v1.3 and documentation was updated
8. A change file was created via `npx @nitra/cursor change`

Key decisions:
1. **Use `--in-diff` as the mechanism for incremental mutation testing in cargo-mutants** (not a persistent cache like Stryker's `incremental.json`, because cargo-mutants doesn't support that)
2. **Use `CARGO_MUTANTS_BASE_REF` env var as the opt-in mechanism** for diff-based mutation (empty = full run, set = diff against that ref)
3. **Fallback to full mutation run when git diff fails** (graceful degradation)

Let me write ADRs for these decisions.
</thinking>

## ADR cargo-mutants: incremental mutation через `--in-diff` з git-diff проти base ref

## Context and Problem Statement
`cargo-mutants` не має persistent-кешу результатів між запусками (на відміну від Stryker з `incremental.json`). Кожен прогін мутував увесь Rust-код наново, що на PR-гілках марнувало час на незачеплений код.

## Considered Options
* `--in-diff <file>` — генерувати `git diff <base>...HEAD` перед прогоном і передавати файлом; cargo-mutants мутує лише рядки з diff
* `--shard K/N` — горизонтальне масштабування між CI-раннерами
* `--baseline=skip` — пропуск baseline-прогону коли тести вже зелені
* `--test-tool nextest` — швидший per-mutant test runner

## Decision Outcome
Chosen option: "`--in-diff` через env `CARGO_MUTANTS_BASE_REF`", because це найближчий еквівалент Stryker incremental для cargo-mutants: мутуються лише рядки, змінені відносно base ref, що на PR із невеликим diff зменшує кількість мутантів з ~138 до 3-5.

### Consequences
* Good, because transcript фіксує очікувану користь: diff-прогін на PR-гілці торкається лише зачеплених рядків; повний прогін на `main` (коли env не виставлено) зберігається.
* Good, because graceful fallback — якщо `git diff` падає (detached HEAD, відсутній remote), провайдер автоматично переходить на повний прогін без помилки.
* Bad, because це не persistent-кеш результатів: якщо той самий мутант вже перевірявся раніше (але не в поточному diff), вердикт не береться з файлу — він перевіряється знову.

## More Information
- Реалізовано у `npm/rules/rust/coverage/coverage.mjs`: нові хелпери `resolveBaseRef(env)` і `runGitDiff(baseRef, cwd)`, оновлений `buildCargoMutantsArgs({ manifestPath, outDir, jobs, diffPath? })`, оновлений `collect()` — генерує diff-файл у tmpdir і прибирає його в `finally`.
- Env: `CARGO_MUTANTS_BASE_REF` — порожньо = повний прогін, виставлено (напр. `origin/main`) = `--in-diff <tmpfile>`.
- Тести: `npm/rules/rust/coverage/tests/coverage.test.mjs` — 19 тестів, у т.ч. нові блоки для `resolveBaseRef` і `--in-diff`-гілки `buildCargoMutantsArgs`.
- Правило `npm/rules/rust/rust.mdc` бампнуто з v1.2 до v1.3, документація секції coverage оновлена.
- Change-файл: `npm/.changes/1780340121953-11c872.md` (minor, Added).
- Попередній ADR по cargo-mutants: `docs/adr/20260528-063858-cargo-mutants-паралельний-запуск-та-tauri-виключення.md`.
