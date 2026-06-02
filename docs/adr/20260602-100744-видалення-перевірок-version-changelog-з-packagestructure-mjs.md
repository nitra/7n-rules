---
session: c893caa2-5ff0-49f2-878b-bcb1acbae65e
captured: 2026-06-02T10:07:44+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-cursor/c893caa2-5ff0-49f2-878b-bcb1acbae65e.jsonl
---

## ADR Видалення перевірок version/CHANGELOG з package_structure.mjs

## Context and Problem Statement
`package_structure.mjs` (npm/rules/npm-module) містив перевірки, що вимагали відповідності `version` у `package.json` та наявності свіжого запису у `CHANGELOG`. Ці перевірки конфліктували з правилом `n-changelog.mdc`, яке забороняє ручний bump — єдиний дозволений артефакт зміни є change-файл (`npx @nitra/cursor change …`). Результат: `npx @nitra/cursor fix changelog npm-module` давав ❌ навіть за коректно складеної гілки.

## Considered Options
* Видалити перевірки `version`/`CHANGELOG` з `package_structure.mjs`, лишивши `changelog/consistency.mjs` єдиним валідатором узгодженості.
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Видалити суперечливі перевірки з `package_structure.mjs`", because єдиний легальний артефакт змін — change-файл; узгодженість version/CHANGELOG вже валідує `changelog/consistency.mjs`, тому дублювання лише примушувало до ручного bump, що `n-npm-module.mdc` явно забороняє.

### Consequences
* Good, because `npx @nitra/cursor fix changelog npm-module` проходить без ❌ по version/CHANGELOG; ручний bump більше не вимагається.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Змінені файли: `npm/rules/npm-module/js/package_structure.mjs`, `npm/tests/integration-repo-checks.test.mjs`. Коміт `fe08579`. Change-файл — `npm/.changes/` (bump: patch, section: Fixed). Перша спроба помістила change-файл у кореневий `.changes/` через відсутній `--ws npm` — виправлено повторним `flow release --ws npm`.

---

## ADR Багаторівневий cwd-незалежний резолвинг активного стану flow

## Context and Problem Statement
Команди `spec`, `plan`, `verify`, `review`, `gate`, `release` обчислювали шлях до `.flow.json` через `flowStatePath(cwd)`, де `cwd = process.cwd()`. Якщо команду запускали не з кореня worktree (наприклад, з головного дерева), стан не знаходився і команда відмовляла з «стану нема — спершу `flow init`». Це блокувало роботу при будь-якому переключенні директорії.

## Considered Options
* **A. Багаторівневий резолвинг**: (1) sibling-файл поточного `cwd` (швидкий шлях без git, зворотна сумісність); (2) `git rev-parse --show-toplevel` (якщо toplevel відповідає `.worktrees/<x>`); (3) скан активних `.worktrees/*.flow.json` зі статусом `in_progress` — якщо рівно один, взяти з інфо-логом; якщо кілька — fail зі списком і підказкою `--branch`; (4) явний `--branch` завжди перемагає.
* **B.** Тільки toplevel-резолв + вимагати `--branch` поза worktree.
* **C.** Завжди вимагати явний `--branch` або `--worktree` для всіх команд.

## Decision Outcome
Chosen option: "A — багаторівневий резолвинг", because один активний flow авторезолвиться без `--branch`; існуючі тести (cwd=tmp, не git-repo) продовжують працювати через швидкий шлях без git.

### Consequences
* Good, because команди знаходять стан незалежно від cwd; transcript фіксує очікувану користь: 193 тести dispatcher зелені, всі конвенції зворотньо сумісні.
* Bad, because якщо кілька flow активні одночасно — потрібен явний `--branch`; авторезолв спрацьовує лише при запуску поза worktree (при наявному sibling — швидкий шлях, git не виклик).

## More Information
Новий файл: `npm/scripts/dispatcher/lib/flow-resolve.mjs` (функція `resolveActiveFlowState`). Інтегровано в `spec.mjs`, `plan.mjs`, `gate.mjs`, `review.mjs`, `commands.mjs` (verify + release). `--branch` парсить `extractBranchFlag` в `dispatcher/index.mjs` з валідацією: значення після `--branch` не повинно починатися з `--`. Коміт `ccaad96`. Change-файл `npm/.changes/` (bump: minor, section: Added). Знахідка під час review: `--branch` без значення тихо ковтав сусідній прапорець (`--json`); виправлено валідацією в `extractBranchFlag`.

---

## ADR Резолвинг лінків front-matter у trace відносно теки артефакту

## Context and Problem Statement
`trace.mjs` перевіряв лінки front-matter (`spec`, `plan`, `adr`, `flow`, `change`, `task`) через `exists(join(root, target))`, де `root` — корінь репо. Усі doc-артефакти використовують file-relative шляхи (`../specs/…`) — стандарт, підтверджений наявними прикладами в репо. `join(root, '../specs/…')` виходить за межі репо → файл не знаходиться → `ok: false` → хибний «РОЗРИВ» на кожному коректно злінкованому spec↔plan. Поле `flow:` (вказівник на `.worktrees/<branch>.flow.json`) є gitignored runtime-станом — фізично відсутній у CI і чистому checkout, тому незалежно від резолвингу завжди давав «РОЗРИВ».

## Considered Options
* **A.** Резолвити лінки відносно теки артефакту (з root-relative fallback); поле `flow:` показувати у виводі (`~ … (runtime-стан)`), але не рахувати розривом ланцюга.
* **B.** Прибрати `flow:` із `LINK_FIELDS` зовсім.
* **C.** Перевіряти всі поля однаково (relative+root fallback), включно з `flow:`.

## Decision Outcome
Chosen option: "A — file-relative резолв + root-relative fallback; `flow:` як info-only", because file-relative — існуюча конвенція репо; root-relative fallback гарантує відсутність хибних розривів для обох конвенцій; `flow:` — принципово інша категорія (ефемерний runtime-стан, не ланка ланцюга простежуваності), і його перевірка на розрив гарантовано шумить у CI.

### Consequences
* Good, because `runTraceCli` повертає exit 0 на реальних доках worktree без жодного хибного «РОЗРИВ»; transcript підтверджує: усі `../specs/…` лінки відображаються `→`, `flow:` — `~`; лінтер сигналізує лише справжні розриви.
* Bad, because подвійний (relative+root) резолв може приховати невідповідність конвенцій (review-finding підтверджено, прийнято as by-design).

## More Information
Змінені файли: `npm/scripts/dispatcher/trace.mjs` (нова функція `resolveLink`, розділення `CHAIN_FIELDS`/`INFO_FIELDS`), `npm/scripts/dispatcher/tests/trace.test.mjs` (16 тестів). Коміт `1bd829a`. Change-файл `npm/.changes/` (bump: patch, section: Fixed). Рядок `render` оновлено: chain-розрив — `✗ … (РОЗРИВ)`; info-відсутність — `~ … (runtime-стан, не перевіряється як ланка ланцюга)`.

---

## ADR Завершення merge feat/coverage-changed-gate: вибір сторін конфлікту

## Context and Problem Statement
Незавершений merge гілки `feat/coverage-changed-gate` у `main` лишив маркери конфлікту (`<<<<<<< HEAD`, `=======`, `>>>>>>>`) у трьох файлах: `npm/scripts/dispatcher/lib/reviewer.mjs`, `npm/rules/flow/flow.mdc`, `npm/rules/rust/coverage/coverage.mjs`. Маркер `=======` у `reviewer.mjs` синтаксично ламав JS-модуль → `npx @nitra/cursor flow` (будь-яка підкоманда) падав з `Unexpected token '==='`. Оскільки `node_modules/@nitra/cursor` — симлінк на `./npm`, зламаним виявився весь CLI flow у локальному середовищі.

## Considered Options
* Взяти бік `feat/coverage-changed-gate` для `reviewer.mjs` і `flow.mdc` (lint + incremental `coverage --changed`); взяти бік `HEAD` (main) для `rust/coverage/coverage.mjs` (новіший, містить `diffPath`/`baseline:skip`).
* Взяти бік `HEAD` для всіх файлів (`git checkout HEAD -- <файли>`).
* Дорезолвити merge вручну (обраний варіант).

## Decision Outcome
Chosen option: "feat-бік для `reviewer.mjs`/`flow.mdc`, HEAD-бік для `rust/coverage.mjs`", because `DEFAULT_GATES = [lint, coverage --changed]` (feat) — зберігає safety net з інкрементальним scope і вирішує первинну проблему повільного coverage-gate; `rust/coverage.mjs` на HEAD новіший (отримав `diffPath`/`baseline:skip`-функціонал після відгалуження feat-гілки).

### Consequences
* Good, because `flow` CLI відновлено (exit з Usage замість краші); 330 тестів по сліду merge зелені; `reviewer.test.mjs` оновлено до `['lint', 'coverage']`.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Зведені файли: `npm/scripts/dispatcher/lib/reviewer.mjs` (DEFAULT_GATES), `npm/rules/flow/flow.mdc` (опис verify), `npm/rules/rust/coverage/coverage.mjs` (JSDoc `diffPath`/`baseline`), `npm/scripts/dispatcher/lib/tests/reviewer.test.mjs` (test «лише lint» → «lint + coverage --changed»). `rust/coverage/` знаходиться під gitignore-патерном → `git add -f`. Коміт `c091708`. Валідація: `node --check` по 3 файлах, `grep -rl '<<<'` — маркерів нема, `bun run vitest run scripts/dispatcher … rules/rust/coverage` — 330/330.
