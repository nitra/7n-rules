---
session: c893caa2-5ff0-49f2-878b-bcb1acbae65e
captured: 2026-06-02T16:50:22+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-cursor/c893caa2-5ff0-49f2-878b-bcb1acbae65e.jsonl
---

Маю повну картину сесії. Готую ADR-документацію.

## ADR DEFAULT_GATES = lint + coverage (інкрементальний)

## Context and Problem Statement
Незавершений merge `feat/coverage-changed-gate → main` лишив маркери конфлікту у трьох файлах: `reviewer.mjs`, `flow.mdc`, `rust/coverage/coverage.mjs`. Через `=======` у `reviewer.mjs` flow CLI падав з `Unexpected token`. Потрібно було обрати одну зі сторін конфлікту і в `DEFAULT_GATES`.

## Considered Options
* **feat-сторона** для `reviewer.mjs` та `flow.mdc`: `DEFAULT_GATES = [lint, coverage --changed]` (інкрементальне покриття лише змінених файлів)
* **HEAD-сторона** для `reviewer.mjs` та `flow.mdc`: `DEFAULT_GATES = [lint]` (coverage поза turnstile — окремий `npx @nitra/cursor coverage`)
* **HEAD-сторона** для `rust/coverage/coverage.mjs`: зберегти `diffPath`/`--in-diff` + `baseline skip` API (feat зрегресував би JSDoc і API)

## Decision Outcome
Chosen option: "feat-сторона для reviewer/flow.mdc, HEAD-сторона для rust/coverage", because feat додає лише scoped-coverage (`--changed`), що зменшує env-крихкість; rust/coverage HEAD містить новіше API (`diffPath`, `baseline skip`), яке використовує функція-виклику на рядку 90.

### Consequences
* Good, because `flow verify` отримав інкрементальне coverage у turnstile зі scope лише до змінених файлів.
* Bad, because coverage-gate у verify виявився env-залежним (Stryker через npx не знаходив vitest-runner) — потребував окремого фіксу в тій самій сесії.

## More Information
Файли: `npm/scripts/dispatcher/lib/reviewer.mjs`, `npm/rules/flow/flow.mdc`, `npm/rules/rust/coverage/coverage.mjs`, `npm/scripts/dispatcher/lib/tests/reviewer.test.mjs`. Коміт: `c091708`. Перевірка: 330 тестів по всьому сліду merge зелені, маркерів нема, `flow` CLI відновлено.

---

## ADR flow release: авто-інференс --ws із git diff

## Context and Problem Statement
`flow release` без явного `--ws` створював change-файл у корені монорепо, хоча всі зміни лежали під `npm/`. Потрібно автоматично визначати воркспейс зі змін від `base_commit` і передавати `--ws` у `n-cursor change`.

## Considered Options
* Інференс через `collectChangedFilesSince(state.base_commit)` + `getMonorepoProjectRootDirs` — визначити, які subworkspace-теки зачіпають змінені файли; один voркспейс → авто-додати `--ws`; кілька → fail з повідомленням; нуль → залишити як є (change дефолтиться на `.`)
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Інференс через collectChangedFilesSince + getMonorepoProjectRootDirs", because це усуває ручну передачу `--ws` у стандартному сценарії (один змінений subworkspace), зберігаючи fail-soft: при помилці інференсу (недосяжний base, git недоступний) `change` запускається без `--ws` (поведінка до фіксу).

### Consequences
* Good, because transcript фіксує очікувану користь: change-файл автоматично потрапляє до `<ws>/.changes/`, а не в корінь монорепо.
* Bad, because у монорепо із вкладеними воркспейсами (`apps` + `apps/web`) файл матчиться до кількох — алгоритм `toSorted` за глибиною (найглибший перемагає) закриває цей кейс, але додає складність.

## More Information
Файли: `npm/scripts/dispatcher/lib/commands.mjs` (функції `matchChangedWorkspaces`, `resolveChangeWsArgs`), `npm/scripts/dispatcher/lib/tests/commands.test.mjs` (27 тестів). Ключові семантики: явний `--ws x` або `--ws=x` у `rest` — інференс не виконується. Коміт: `282332c` на `flow-release-infer-ws`. Виявлена проблема `--ws=` inline-форми та вкладених воркспейсів — закрита у тій самій ітерації review.

---

## ADR flow review: рецензент верифікує cross-file твердження через Read

## Context and Problem Statement
Рецензентський subagent отримував `allowedTools: ['Read', 'Edit', 'Bash']`, але промпт наказував дивитись «ЛИШЕ в цьому diff». Через це з'являлись нефальсифіковні findings вигляду «з diff не видно» — рецензент не перевіряв referenced-файли та spec перед репортом.

## Considered Options
* Змінити промпт: дозволити та зобов'язати читати referenced-файли через Read перед репортом finding, scope лишити на нових/змінених файлах diff
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Зміна промпта: зобов'язати верифікацію через Read", because subagent вже технічно мав Read у allowed-tools, тому зміна лише інструкції (не конфігурації) достатня і не потребує зміни runner-об'єкта.

### Consequences
* Good, because transcript фіксує очікувану користь: рецензент отримує вказівку не видавати нефальсифіковані findings без читання referenced-коду.
* Bad, because промпт оголошує «маєш інструмент Read», але не перевіряє реальний allowed-tools runner-а; якщо виклик відбувається без Read у дозволах — інструкція вводить модель в оману (відзначено в review findings).

## More Information
Файли: `npm/scripts/dispatcher/lib/review.mjs` (функція `reviewerPrompt`), `npm/scripts/dispatcher/lib/tests/review.test.mjs` (14 тестів, включаючи тест на регекс `/ПЕРЕВІР/`). Бічний ефект: виправлено латентний oxlint-борг у `review.test.mjs` (static-regex, no-empty-function, require-await, no-useless-undefined). Коміт: `b0308d4` на `flow-review-read-access`.

---

## ADR Stryker запускається через локальний core-bin (shebang), не npx

## Context and Problem Statement
`runStryker` у `npm/rules/js-lint/coverage/coverage.mjs` запускав `@stryker-mutator/core` через `npx`, що тягнуло core у власний кеш npx. У тому кеші не було `@stryker-mutator/vitest-runner` → plugin-discovery падав з «Cannot find TestRunner plugin "vitest"», і `flow verify` coverage-gate незмінно падав локально.

## Considered Options
* **Запустити локально встановлений core через `process.execPath` (node)** — резолвити `@stryker-mutator/core/bin/stryker.js` через `require.resolve` і запускати `spawnSync(process.execPath, [strykerBin, 'run', ...])`: перша спроба, відкинута, бо `exports` пакета не відкриває subpath `./bin/stryker.js` → `ERR_PACKAGE_PATH_NOT_EXPORTED` → тихий fallback на npx
* **Резолвити через `package.json` → поле `bin`, запускати bin напряму (shebang)** — `require.resolve('@stryker-mutator/core/package.json')` → `dirname` → `bin/stryker.js`; запуск `spawnSync(strykerBin, ['run', ...])` без node/bun-батька: bin має `#!/usr/bin/env node`, тому завжди виконується node незалежно від рантайму батька

## Decision Outcome
Chosen option: "Резолвити через package.json → bin, запускати bin напряму (shebang)", because shebang bin завжди виконується через node (закриває ризик bun-рантайму батька), `vitest-runner` є сусідом в тому ж `node_modules`, plugin-discovery його знаходить. E2e-валідація: «Starting initial test run (vitest test runner…)», exit 0.

### Consequences
* Good, because transcript фіксує очікувану користь: coverage-gate `flow verify` проходить, 34 тести dispatcher зелені, oxlint exit 0.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Файли: `npm/rules/js-lint/coverage/coverage.mjs` (функції `resolveLocalStrykerBin`, `runStryker`). Імпорт: `createRequire` з `node:module`, `dirname` з `node:path`, `readFileSync` з `node:fs`. Коміт: `373ce42` на `flow-coverage-stryker-local`. Діагностика: `ERR_PACKAGE_PATH_NOT_EXPORTED` при першій спробі зафіксована в сесії як корінь провалу першого варіанта.

---

## ADR detectLevel: complexity guard піднімає L0 → L1 (не L2)

## Context and Problem Statement
`detectLevel` у `npm/scripts/dispatcher/lib/level.mjs` знижував задачу до L0 через підрядок `'fix'` у `L0_KEYS`, навіть коли опис містив сигнали складності (`mdc`, `rego`, `суперечн`, `checker` тощо). Задача «виправити класифікатор» отримала L0 при `flow init` — пропустивши spec-фазу. Крім того, підрядок `'fix'` ловиться в `prefix`/`fixture` → хибний L0 без complexity-ключів.

## Considered Options
* **A (complexity → L2)**: сигнал складності перекриває L0-дієслово і піднімає до L2 (2 рецензенти, spec+plan обов'язкові)
* **B (complexity → L1)**: сигнал складності піднімає тільки до L1, не L2; порядок `L3 > L2_KEYS > [L0 без guard] > L1`
* Звузити підрядок `'fix'` до word-boundary (прибрати false-positive у `prefix`, `fixture`)

## Decision Outcome
Chosen option: "B (complexity → L1) + word-boundary hygiene для 'fix'", because варіант B вже був задеплоєний у `main` паралельно і зафіксований у тестах (рядки 30-36 `level.test.mjs`); A-перевага (1 vs 2 рецензенти для complexity-задач) марґінальна, а головна шкода (skip-spec) вже усунена. Word-boundary hygiene лишається невиправленим false-positive (`'add prefix validation'` → L0).

### Consequences
* Good, because transcript фіксує очікувану користь: `fix mdc checker` → 1, `fix суперечність у spec` → 1, `fix rego policy` → 1.
* Bad, because false-positive підрядка `'fix'` у словах типу `prefix`/`fixture` не усунений у записаній частині сесії — реалізація word-boundary hygiene була наступним кроком, але сесія завершилась на фазі читання файлів.

## More Information
Файли: `npm/scripts/dispatcher/lib/level.mjs` (масив `COMPLEXITY_GUARD_KEYS`, функція `detectLevel`), `npm/scripts/dispatcher/lib/tests/level.test.mjs`. Емпіричне підтвердження: `node --input-type=module` показав `'add prefix validation'` → 0 (false-positive залишився). Ключі complexity guard: `mdc`, `rego`, `policy`, `правил`, `rules`, `checker`, `check-`, ` spec`, `інваріант`, `invariant`, `кілька файлів`, `декілька`, `multiple files`, `суперечн`, `конфлікт`, `conflict`, `порушен`, `violation`.
