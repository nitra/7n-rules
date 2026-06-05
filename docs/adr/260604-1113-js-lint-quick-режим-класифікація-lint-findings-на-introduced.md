---
session: c893caa2-5ff0-49f2-878b-bcb1acbae65e
captured: 2026-06-04T11:13:25+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-cursor/c893caa2-5ff0-49f2-878b-bcb1acbae65e.jsonl
---

---

## ADR js-lint quick-режим: класифікація lint-findings на introduced vs pre-existing

## Context and Problem Statement
`flow verify` запускає lint лише на змінених файлах, але перевіряє весь файл — тому знайдений лінт-борг, внесений попередніми авторами, блокував verify навіть якщо поточна зміна його не вносила. Розробник не міг відрізнити власні порушення від передіснуючих без ручного аналізу diff.

## Considered Options
* **A. Label-only** — класифікувати й позначати findings у виводі; блокування без змін (фейл на будь-якому finding, як раніше).
* **B. Label + relax** — класифікувати й блокувати лише на introduced; pre-existing → warning (не блокує).

## Decision Outcome
Chosen option: "A. Label-only", because користувач обрав варіант A — перш за все забезпечити видимість (хто вніс знайдений баг), не послаблюючи самого блокування.

### Consequences
* Good, because transcript фіксує очікувану користь: розробник одразу бачить `🆕 introduced (N)` vs `🗄 pre-existing (M)` і розуміє, що саме він вніс, без ручного зіставлення з diff.
* Bad, because verify досі падає на pre-existing знахідках (якщо вони є) — корінь болю «чужий борг блокує verify» variant A не усуває, лише робить видимим. Transcript не містить підтверджених негативних наслідків щодо нових обмежень.

## More Information
- Змінені/створені файли: `npm/rules/js-lint/js/lint.mjs`, `npm/rules/js-lint/js/lint-findings.mjs` (нові: `parseOxlint`, `parseEslint`, `classifyFindings`, `renderFindings`), `npm/scripts/lib/diff-added-lines.mjs` (парсер git-diff hunks; `ALL_LINES` sentinel для untracked).
- Pipeline: fix-пас (`stdio: inherit`, `--fix`) → репорт-пас (`--format=json`, після фіксу — рядки findings узгоджені з пост-фікс станом файлу) → classify (порівняння рядку finding з доданими діапазонами diff) → render.
- Лінтери: `bunx oxlint --format=json` → `{diagnostics:[{filename, labels:[{span:{line}}]}]}`, `bunx eslint --format=json` → `[{filePath, messages:[{line}]}]`.
- Review-фікс (🔴): `runJson` при крашу інструмента повертав `stdout=''` → `JSON.parse` → `[]` → тихий pass; виправлено на `null`-семантику (`parseOxlint`/`parseEslint` повертають `null` на непарсабельне) + перевірка `status !== 0 && stdout === null` → явний fail.
- Гілка: `flow-lint-introduced-classify`, коміт `8af1ae0e`, змерджено в `main` (`809599e2..61021f67`). `flow verify` зелений (✅ lint, ✅ coverage) на цих змінах.

---

## ADR detectLevel: complexity-guard перекриває L0 для ASCII дієслів

## Context and Problem Statement
`detectLevel` повертав `L0` (тривіальне) для будь-якого опису з підрядком `fix/typo/bump` тощо, навіть якщо опис сигналізував складну задачу (mdc-правило, policy, rego, checker, суперечність інваріанту). Це спричиняло skip spec/plan у flow для tasks, які реально потребували ретельного опрацювання.

## Considered Options
* **A. Complexity → L2** — якщо в описі є і L0-дієслово, і сигнал складності, результат L2 (spec/plan рекомендовані, 2 рецензенти).
* **B. Complexity → L1** — fix+complexity → L1 (1 рецензент), тільки чистий fix → L0.
* **Інші варіанти в transcript не обговорювалися.**

## Decision Outcome
Chosen option: "A. Complexity → L2", because користувач обрав варіант A; ретроспектива сесії показала, що skip-spec для rules/checks-задач призводив до реальних проблем (задача з `changelog/npm-module` отримала L0 і мало не пропустила spec-фазу).

### Consequences
* Good, because transcript фіксує очікувану користь: догфуд-тест (`flow init` для самої задачі #2-guard із `mdc/rego/checker/суперечн` у описі) дав L2 замість L0 — rules/checks-задачі класифікуються коректно.
* Bad, because transcript не містить підтверджених негативних наслідків; зауважено review-знахідку (🟡): реордер L0/L2 міг ненавмисно дати `rename feature` → L2; виправлено так, що лише `COMPLEXITY_KEYS` перекривають `isL0`, а `L2_KEYS` — ні.

## More Information
- Змінений файл: `npm/scripts/dispatcher/lib/level.mjs`.
- Нова константа `COMPLEXITY_KEYS`: `['mdc', 'policy', 'політик', 'rego', 'checker', 'чекер', 'правило', 'правила', 'rules', 'суперечн', 'інваріант', 'violation', 'порушен', 'кілька файл', 'кілька правил']`.
- Логіка: `isL0 = hasWord(L0_WORD_KEYS) || substr(L0_SUBSTR_KEYS)` → якщо `isL0 && !has(COMPLEXITY_KEYS)` → 0; якщо `has(L2_KEYS) || has(COMPLEXITY_KEYS)` → 2.
- Review-фікси (🟡): `'правил'` ловив `'правильно'` → замінено на `'правило'/'правила'`; `'conflict'` давав L2 на `fix merge conflict` → прибрано.
- Гілка: `flow-level-complexity-guard`, коміт `25e1a0c`, змерджено в `main` (`aa658861..f4f9a288`). 17 тестів зелені.

---

## ADR detectLevel: word-boundary матч для ASCII L0-дієслів

## Context and Problem Statement
`detectLevel` матчив L0-дієслова (`fix`, `typo`, `bump`, `rename`, `hotfix`) як підрядок — `fix` спрацьовував усередині `prefix`, `fixture`, `suffix`, даючи хибний `L0` для описів типу `add prefix validation`.

## Considered Options
* **Word-boundary match** — ASCII L0-дієслова матчити regex `\b<keyword>\b` (ціле слово), кириличні — підрядком (стемінг).
* **Інші варіанти в transcript не обговорювалися.**

## Decision Outcome
Chosen option: "Word-boundary match", because підрядковий матч `fix` у `prefix` — конкретний підтверджений false-positive; word-boundary виправляє його без введення нових залежностей.

### Consequences
* Good, because transcript фіксує: `detectLevel('add prefix validation')` → `1` (раніше `0`); `detectLevel('fix typo')` → `0` (регрес відсутній).
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- Змінений файл: `npm/scripts/dispatcher/lib/level.mjs`.
- Введено `L0_WORD_KEYS` (ASCII) + `L0_SUBSTR_KEYS` (кириличні) + хелпер `hasWord(d, k)` з `RegExp(String.raw\`\\b${k}\\b\`)`.
- Гілка: `flow-level-l0-word-boundary`, коміт `b8fe7df`, змерджено в `main` (`8d3e3f6..d22af43`). 13 тестів зелені.

---

## ADR coverage-gate: Stryker запускається через node-shebang локального core, не npx

## Context and Problem Statement
`flow verify` coverage-gate запускав Stryker через `npx`, що тягнув його з кешу без `@stryker-mutator/vitest-runner` — plugin-discovery падала з `Cannot find TestRunner plugin "vitest"`. Перша спроба фіксу через `require.resolve('@stryker-mutator/core/bin/stryker.js')` не спрацювала: `exports` пакета не відкриває цей subpath, тому резолв кидав `ERR_PACKAGE_PATH_NOT_EXPORTED` і тихо падав у той самий `npx`.

## Considered Options
* **Резолв через `package.json` → поле `bin`, запуск напряму** — знайти `package.json` core-пакета через `createRequire`, дістати `bin.stryker`, запустити файл напряму (його `#!/usr/bin/env node` shebang → завжди node, навіть під bun).
* **Інші варіанти в transcript не обговорювалися.**

## Decision Outcome
Chosen option: "Резолв через `package.json` → поле `bin`, запуск напряму", because bin-файл має `#!/usr/bin/env node` shebang і є executable — запуск напряму гарантує node-рантайм незалежно від батьківського процесу (bun чи node), а резолв через `package.json` обходить обмеження `exports`.

### Consequences
* Good, because transcript фіксує очікувану користь: `coverage --changed` завантажив `vitest test runner`, `Initial test run succeeded. Ran 34 tests`, `flow verify` → `✅ gate: coverage`.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- Змінений файл: `npm/rules/js-lint/coverage/coverage.mjs`, функція `resolveLocalStrykerBin`.
- Діагностика: `require.resolve('@stryker-mutator/core/bin/stryker.js')` → `ERR_PACKAGE_PATH_NOT_EXPORTED` (exports не відкриває subpath).
- Фікс: `createRequire(import.meta.url).resolve('@stryker-mutator/core/package.json')` → `dirname` → `join(dir, pkg.bin.stryker)`.
- Review-фікс (🔴 від `flow review`): `process.execPath` під bun → bun-бінарник; виправлено на прямий запуск shebang-файлу через `spawnSync(strykerBin, …)`.
- Гілка: `flow-coverage-stryker-local`, коміт `373ce42`, змерджено в `main`. 34 тести зелені (oxlint чистий).

---

## ADR mirror-parity: parity-гард дзеркала `.cursor/rules` ↔ канонічний `npm/rules`

## Context and Problem Statement
Файли `.cursor/rules/n-<id>.mdc` є дзеркалами канонічних `npm/rules/<id>/<id>.mdc` з inlined-шаблонами. Після кількох задач сесії дзеркало розійшлося з каноном (5 файлів: changelog, flow, ga, npm-module, test) — без автоматичного виявлення дрейф міг накопичуватись непоміченим.

## Considered Options
* **Parity-тест у repo-self-suite** — хелпер `mirror-parity.mjs` з `findMirrorDrift` порівнює дзеркало з `inlineTemplateLinks(канон)` і live-гард як vitest-тест фіксує дрейф.
* **Легка targeted-resync команда** — ресинкати лише змінені правила без побічного синку skills/devDeps.
* **Pre-commit hook** — тримати дзеркало актуальним автоматично при кожному коміті.

## Decision Outcome
Chosen option: "Parity-тест у repo-self-suite", because це найменший tooling із раннім виявленням дрейфу (CI/verify падає на розбіжності); не потребує нового CLI-коду і не ризикує сповільнити pre-commit.

### Consequences
* Good, because transcript фіксує очікувану користь: live-гард (4-й тест) підтвердив `drift: []` після регенерації 5 розійшлених дзеркал; `flow verify` зелений.
* Bad, because transcript фіксує by-design обмеження: orphan-дзеркало (канон видалено, mirror лишився) `listManagedMirrors` мовчки пропускає — гард не помічає «застряглого» mirror-файлу.

## More Information
- Новий файл: `npm/scripts/lib/mirror-parity.mjs` — `listManagedMirrors`, `expectedMirrorContent`, `findMirrorDrift`.
- Тест: `npm/scripts/lib/tests/mirror-parity.test.mjs` — 4 тести (юніт детекції дрейфу + live-гард на реальному репо).
- Трансформ: `inlineTemplateLinks(text, ruleDir)` з `npm/scripts/lib/inline-template-links.mjs` — той самий, що використовує CLI sync.
- Регенеровано 5 розійшлених дзеркал (changelog, flow, ga, npm-module, test).
- Гілка: `flow-mirror-parity`, коміт `fe5501f`, змерджено в `main` (`75d7b18..d06ed58`). 4 тести зелені.
