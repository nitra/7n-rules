---
session: 1f6e893c-e424-4755-a387-b05d8e30ffe4
captured: 2026-06-01T22:09:54+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-cursor/1f6e893c-e424-4755-a387-b05d8e30ffe4.jsonl
---

Файл уже містить мої попередні правки. Додаю секцію про CI-кеш після «Паралельний запуск»:
[assistant]
[tool: Edit] {"replace_all":false,"file_path":"/Users/vitalii/www/nitra/cursor/npm/rules/rust/rust.mdc","old_string":"> **Примітка.** `--in-place` навмисно відсутній: він несумісний із `--jobs > 1` (cargo-mutants потребує sandbox-каталогу для кожного паралельного мутанта). Це зафіксовано в ADR `20260528-063858`.","new_string":"> **Примітка.** `--in-place` навмисно відсутній: він несумісний із `--jobs > 1` (cargo-mutants потребує sandbox-каталогу для кожного паралельного мутанта). Це зафіксовано в ADR `20260528-063858`.

### Кешування `target/` у CI

Найбільший абсолютний виграш у cargo-mutants — **тепла компіляція**: без кешу кожен CI-прогін будує всі sandbox-мутанти з нуля. Рекомендований мінімум у consumer-ових workflows:

```yaml
- uses: Swatinem/rust-cache@v2
with:
cache-targets: true   # кешує target/ між runs
shared-key: cargo-mutants

- run: n-cursor coverage
env:
CARGO_MUTANTS_BASE_REF: origin/main   # (на feature-branch)
```

`Swatinem/rust-cache` автоматично кешує `~/.cargo/registry`, `~/.cargo/git`, і `target/`. Без нього `--jobs` дає менший приріст, бо bottleneck — cold linker, а не кількість воркерів (ADR `20260528-063858`)."}
[user]
[tool_result] The file /Users/vitalii/www/nitra/cursor/npm/rules/rust/rust.mdc has been updated successfully. (file state is current in your context — no need to Read it back)
[assistant]
Бампую версію правила і перевіряю changelog:
[assistant]
[tool: Edit] {"replace_all":false,"file_path":"/Users/vitalii/www/nitra/cursor/npm/rules/rust/rust.mdc","old_string":"version: '1.3'","new_string":"version: '1.4'"}
[user]
[tool_result] The file /Users/vitalii/www/nitra/cursor/npm/rules/rust/rust.mdc has been updated successfully. (file state is current in your context — no need to Read it back)
[assistant]
[tool: Bash] {"command":"cd /Users/vitalii/www/nitra/cursor && npx @nitra/cursor change --bump patch --section Added --message \"rust.mdc: рекомендований CI-фрагмент Swatinem/rust-cache для кешування target/ при cargo-mutants\" --ws npm 2>&1 | tail -5","description":"Create changelog entry for CI cache doc"}
[user]
[tool_result] ✅ npm/.changes/1780340741453-64d1ed.md
[assistant]
[tool: Bash] {"command":"cd /Users/vitalii/www/nitra/cursor && npx @nitra/cursor fix changelog 2>&1 | tail -8; echo \"EXIT: $?\"","description":"Verify changelog"}
[user]
[tool_result]   ✅ npm: є change-файл(и) у .changes/ — bump зробить CI (n-changelog.mdc)
✅ npm/package.json: files містить "CHANGELOG.md"
✅ npm/local-only: local-only воркспейси без змін відносно main

✨ Результат: 1/1 правил безпомилково виконані
EXIT: 0
[assistant]
Додав секцію **«Кешування `target/` у CI»** у `rust.mdc` (версія `1.3 → 1.4`) з конкретним YAML-фрагментом (`Swatinem/rust-cache@v2` + `CARGO_MUTANTS_BASE_REF`). Change-файл створений, changelog зелений.

Два change-файли разом (`--in-diff` + CI-кеш) підуть в один bump при наступному релізі.
[user]

---
END OF TRANSCRIPT

## ADR cargo-mutants: incremental mutation через `--in-diff`

## Context and Problem Statement
cargo-mutants не має persistent-кешу результатів мутантів між запусками (на відміну від Stryker `incremental.json`). Щоразу мутується весь набір — навіть на PR зі зміною в одному файлі.

## Considered Options
* `--in-diff` — передати `git diff <baseRef>...HEAD` файлом, мутувати лише рядки, що змінились
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "`--in-diff` через env `CARGO_MUTANTS_BASE_REF`", because це офіційна відповідь cargo-mutants на «мутуй лише змінене» — аналог Stryker incremental для PR-прогонів; повний прогін зберігається для `main` (коли env не задана).

### Consequences
* Good, because transcript фіксує очікувану користь: на PR зі зміною в 1 файлі ~138 мутантів скорочуються до 3-5; порожній diff автоматично дає `0/0` без запуску cargo-mutants.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- Реалізація: `npm/rules/rust/coverage/coverage.mjs` — нові хелпери `resolveBaseRef()`, `buildCargoMutantsArgs({ diffPath })`, `defaultRunner.runGitDiff({ manifestPath, baseRef })`; `collect()` оркеструє fallback до повного прогону якщо `git diff` впав.
- Тести: `npm/rules/rust/coverage/tests/coverage.test.mjs` — 5 нових блоків (19/19 pass).
- Документація: секція «Incremental mutation через `--in-diff`» у `npm/rules/rust/rust.mdc` (версія 1.2 → 1.3).
- CI-приклад: `CARGO_MUTANTS_BASE_REF: origin/main` у step env.
- Інцидент: `git pull --rebase` під час сесії перетер робоче дерево → правки переписано наново.
- Каталог `rules/rust/coverage/` потрапляє під gitignore-патерн `**/coverage/` — oxlint/eslint пропускають цей код у project-wide прогоні (латентна вада).

---

## ADR cargo-mutants: документування кешування `target/` у CI

## Context and Problem Statement
Холодна компіляція sandbox-мутантів — найдорожча частина cargo-mutants. У CI без кешу `target/` виграш від `--jobs` і `--in-diff` частково нівелюється cold linker overhead.

## Considered Options
* Додати рекомендований CI-фрагмент (`Swatinem/rust-cache@v2`) у `rust.mdc`
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Документувати `Swatinem/rust-cache@v2` у `rust.mdc`", because `n-cursor` постачає правила, а не consumer-ові CI-workflows; єдиний спосіб вплинути — документація з готовим YAML-фрагментом.

### Consequences
* Good, because transcript фіксує очікувану користь: тепла компіляція дає найбільший абсолютний виграш; без кешу cold linker є основним bottleneck навіть при `--jobs > 1`.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- Зміни: секція «Кешування `target/` у CI» у `npm/rules/rust/rust.mdc` (версія 1.3 → 1.4).
- YAML-фрагмент: `Swatinem/rust-cache@v2` з `cache-targets: true` + `CARGO_MUTANTS_BASE_REF: origin/main`.
- Обґрунтування вибору `Swatinem/rust-cache`: ADR `20260528-063858` фіксує linker як bottleneck.
- Change-файл: `npm/.changes/1780340741453-64d1ed.md` (patch, Added).
