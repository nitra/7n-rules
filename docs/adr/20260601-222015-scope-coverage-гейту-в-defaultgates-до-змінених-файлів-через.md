---
session: 37e16d83-9fec-4e35-8975-e1f75f254fe3
captured: 2026-06-01T22:20:15+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-cursor/37e16d83-9fec-4e35-8975-e1f75f254fe3.jsonl
---

## ADR Scope coverage-гейту в DEFAULT_GATES до змінених файлів через `--changed`

## Context and Problem Statement
`DEFAULT_GATES` у `npm/scripts/dispatcher/lib/reviewer.mjs` запускає `n-cursor coverage` без жодного scope: vitest ганяє весь test-suite всіх JS-roots, а Stryker мутує весь `src/**` (incremental лише прискорює повтори, scope не звужує). В TDD-циклі `flow run --autonomous` verify викликається після кожного кроку, тож Stryker виконується N разів на task. Worktree свіжий — `reports/stryker/incremental.json` відсутній через `.gitignore`, тобто перший прогон завжди повний.

## Considered Options
* Видалити `coverage` з `DEFAULT_GATES` повністю (coverage залишається лише на `release`/ручний виклик)
* Scope coverage-гейт до змінених файлів через прапор `--changed` — vitest `--changed <base>`, Stryker `--mutate <змінені production-файли>`
* Конфіг-кероване увімкнення coverage через `.n-cursor.json#flow.gates`

## Decision Outcome
Chosen option: "Scope coverage-гейту через `--changed`", because користувач уточнив: потрібна перевірка **лише змінених файлів** всередині flow, однаково незалежно від того, закомічені вони чи ні — а не відмова від coverage-гейту взагалі.

### Consequences
* Good, because transcript фіксує очікувану користь: кількість реальних прогонів Stryker у TDD-циклі скорочується з N (per-step) до scope зі зміненими production-файлами; git-diff уніфікує committed і uncommitted зміни в одному виклику.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Зачеплені файли: `npm/scripts/dispatcher/lib/reviewer.mjs` (`DEFAULT_GATES` → cmd `coverage --changed`), `npm/bin/n-cursor.js` (парсинг `--changed`), `npm/rules/test/coverage/coverage.mjs` (оркестратор, читає `base_commit` з `.flow.json`), `npm/rules/js-lint/coverage/coverage.mjs` (scoped vitest + Stryker), `npm/scripts/lib/changed-files.mjs` (новий `collectChangedFilesSince`), `npm/rules/flow/flow.mdc`, `npm/rules/test/test.mdc`. Реалізовано в worktree `.worktrees/feat-coverage-changed-gate` на гілці `feat/coverage-changed-gate`.

---

## ADR `git diff <base_commit>` як уніфіковане джерело змінених файлів

## Context and Problem Statement
`collectChangedFiles` у `npm/scripts/lib/changed-files.mjs` використовує `git diff HEAD`, що не бачить закомічених змін поточної feature-гілки відносно base. У `flow run --autonomous` executor комітить кожен крок (`active.mjs:34`), тож після комітів `git diff HEAD` порожній. Lint quick-mode завжди від HEAD; coverage-scope потребує інваріанту: «всі зміни від початку задачі», незалежно від кількості проміжних комітів.

## Considered Options
* `git diff HEAD` (робоче дерево) — поточний підхід `collectChangedFiles`; не бачить закомічених змін від base
* `git diff <base_commit>` без `..` / без `HEAD` — порівняння base із робочим деревом; ловить committed + staged + unstaged одним викликом

## Decision Outcome
Chosen option: "`git diff <base_commit>` без `..`", because користувач вимагав «однаково опрацьовувало чи файли закомічені, чи ні», а `git diff <base>` проти робочого дерева єдиний виклик, що покриває обидва стани без двофазного підходу.

### Consequences
* Good, because transcript фіксує очікувану користь: scope незмінний протягом всього TDD-циклу flow незалежно від кількості проміжних комітів; fallback на `collectChangedFiles` (HEAD) при відсутньому стані flow зберігає зворотну сумісність для ручних викликів поза flow.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
`base_commit` читається з `.flow.json` (так само, як у `npm/scripts/dispatcher/lib/review.mjs:29`). Новий helper: `collectChangedFilesSince(base, cwd)` у `npm/scripts/lib/changed-files.mjs`. Тести: `npm/scripts/lib/tests/changed-files.test.mjs` (нові кейси: committed changes видимі, uncommitted changes видимі, поза flow → fallback).

---

## ADR Порожній changed-scope = pass (exit 0) у `runCoverageSteps`

## Context and Problem Statement
`runCoverageSteps` у `npm/rules/test/coverage/coverage.mjs` при `rows.length === 0` повертає exit 1 («Жодного провайдера…»). З `--changed`-scope root без змінених JS-файлів (наприклад, лише правки docs або Rust-коду) дасть порожній scope — і flow-турнікет фейлитиме кожен раз на нешкідливих правках.

## Considered Options
* Залишити exit 1 при порожньому scope (ломає турнікет для non-JS правок)
* Порожній changed-scope → pass (exit 0, `COVERAGE.md` не оновлюється)

## Considered Options
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Порожній changed-scope → pass (exit 0)", because це пряме логічне слідство scoped-підходу: відсутність змінених JS-файлів є валідним станом, а не помилкою конфігурації.

### Consequences
* Good, because transcript фіксує очікувану користь: flow verify не фейлить при правках поза JS (документація, Rust, конфіги).
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Зміна в `npm/rules/test/coverage/coverage.mjs`: при `--changed` і порожньому зібраному scope виконання завершується достроково з exit 0 без перезапису `COVERAGE.md`. Тест-кейс: `rules/test/coverage/tests/coverage.test.mjs` (changed-scope, немає JS-файлів → exit 0, `COVERAGE.md` не створюється).
