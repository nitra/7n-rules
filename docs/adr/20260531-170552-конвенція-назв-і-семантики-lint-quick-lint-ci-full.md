---
session: 09dcb1bc-929b-4d88-90b0-c0611bed3d2f
captured: 2026-05-31T17:05:52+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/09dcb1bc-929b-4d88-90b0-c0611bed3d2f.jsonl
---

## ADR Конвенція назв і семантики lint (quick) / lint-ci (full)

## Context and Problem Statement
Монолітний `bun run lint` запускав усі 6+ lint-кроків однаково і під час розробки, і в CI. Потрібно розрізнити швидку перевірку (для агента/розробника) і повну (для CI), не дублюючи налаштування.

## Considered Options
* `lint` = quick (по змінених), `lint-ci` = full (по всіх)
* Різні назви: `lint-fast`/`lint-all`, `lint-check`/`lint-full`
* Один скрипт з параметром (`lint --quick`)

## Decision Outcome
Chosen option: "`lint` = quick, `lint-ci` = full", because ця конвенція мінімально ламає існуючий `bun run lint` (CI-пайплайни можна окремо перевести на `lint-ci`), а назви читаються як «розробник кличе `lint`, CI кличе `lint-ci`».

### Consequences
* Good, because transcript фіксує очікувану користь: порожній список змінених файлів → крок скіпається миттєво, що робить `lint` практично безвитратним у чистому дереві.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Рішення прийнято в brainstorming-сесії перед написанням spec. Канонічний spec: `docs/superpowers/specs/2026-05-31-lint-quick-ci-split-design.md`. Fix-поведінка (`--fix`) збережена однаково в обох режимах (рішення H1); CI-семантика «no-fix» залишена як можливий майбутній крок.

---

## ADR Поле `meta.json.lint` — один enum `"quick" | "ci"` (E1)

## Context and Problem Statement
Data-driven lint-оркестратор потребує конфігурації на рівні правила: чи крок іде у швидкий набір, повний, чи взагалі не є lint-кроком. Питання — яка форма цього атрибута в `meta.json`.

## Considered Options
* E1: одне поле `"lint": "quick" | "ci"`, семантика quick ⊆ ci
* E2: обʼєкт `{ phase, scope }` з двома осями
* E3: два булеві прапорці `lintQuick`/`lintCi`

## Decision Outcome
Chosen option: "E1 (одне поле `lint` з enum)", because scope (`changed`/`all`) майже завжди однозначно визначається з фази (`quick`→змінені, `ci`→всі), тому окрема вісь — YAGNI; E3 допускає суперечливі комбінації; відсутність поля природно позначає «правило не є lint-кроком».

### Consequences
* Good, because transcript фіксує очікувану користь: схема проста, 33 наявних `meta.json` не потребують масової міграції — більшість правил просто не матимуть поля `lint`.
* Bad, because одне поле не може виразити «quick+ci різні команди в одному правилі» — ця проблема вирішена окремо через D3-розщеплення `js-lint`.

## More Information
Реалізовано у `npm/scripts/lib/rule-meta.mjs` (`parseRuleLintPhase`), схема `rule-meta.json`, валідація `npm/rules/npm-module/js/lint/rule_meta.mjs`. Поле відсутнє → правило ігнується оркестратором.

---

## ADR CLI-оркестратор `n-cursor lint` / `lint-ci` замість хардкод-ланцюга (F1)

## Context and Problem Statement
Кореневий `package.json` містив хардкод-ланцюг `lint-ga && lint-js && lint-rego && ...` — той самий антипатерн, що щойно видалили з `auto-rules.mjs`. Щоб `meta.json.lint` реально керував набором кроків, потрібен оркестратор, що читає метадані і збирає набір динамічно.

## Considered Options
* F1: CLI-оркестратор у пакеті (`n-cursor lint`/`lint-ci`); кореневі скрипти делегують
* F2: генерація ланцюга в `package.json` через sync
* F3: лишити ланцюг, додати лише фільтр по змінених файлах

## Decision Outcome
Chosen option: "F1 (CLI-оркестратор)", because F2 ускладнює логіку «по змінених» у генерованому рядку; F3 суперечить data-driven ідеї (не враховує `meta.json`); F1 дзеркалить наявний патерн `lint-ga`/`lint-text` (CLI-виконавець + тонкий делегат) і відповідає тому, що зробили з `auto-rules`.

### Consequences
* Good, because transcript фіксує очікувану користь: оркестратор `selectLintRules` сканує `rules/*/meta.json` і будує набір без хардкоду; нові правила з`lint`-полем підхоплюються автоматично.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Реалізовано у `npm/scripts/lint-cli.mjs` (`selectLintRules`, `runLint`). Підключено в `npm/bin/n-cursor.js` як `case 'lint'` / `case 'lint-ci'`. Старий timing-оркестратор `npm/scripts/lib/run-lint-cli.mjs` видалено.

---

## ADR Розщеплення `js-lint` на quick (oxlint+eslint) і `js-lint-ci` (jscpd+knip) — D3

## Context and Problem Statement
`lint-js` в `package.json` містив 4 інструменти: `oxlint`, `eslint`, `jscpd`, `knip`. Перші два приймають список файлів → придатні для quick; `jscpd` (детектор клонів) і `knip` (граф імпортів) потребують повного репо і не мають сенсу на підмножині. Одне поле `meta.json.lint` не може виразити «quick і ci одночасно» для одного правила.

## Considered Options
* D3: атрибут на рівні правила + окреме правило `js-lint-ci` для крос-файлових інструментів
* D1: атрибут на рівні правила грубо (увесь `js-lint` → quick або → ci)
* D2: гранулярніший конфіг на рівні інструмента всередині правила

## Decision Outcome
Chosen option: "D3 (розщеплення js-lint)", because D1 або жертвує jscpd/knip у quick (вони там марні), або викидає oxlint/eslint із quick (вбиває сенс quick); D2 вводить новий рівень конфігурації без необхідності — js-lint єдиний реальний композит, тому одне виключення замість загального ускладнення.

### Consequences
* Good, because transcript фіксує очікувану користь: `quick = [js-lint]`, `ci = [js-lint, js-lint-ci]` — перевірено реальним скануванням `selectLintRules`.
* Bad, because зʼявилося нове правило `js-lint-ci` без власного `auto`-поля; треба знати, що воно не генерує config-файлів, лише lint-крок.

## More Information
`npm/rules/js-lint/meta.json` → `"lint": "quick"`; нове правило `npm/rules/js-lint-ci/` (`meta.json` → `"lint": "ci"`, `js/lint.mjs` делегує до jscpd+knip). `js-lint/js/lint.mjs` — quick: `filterJsFiles` + oxlint+eslint по змінених.

---

## ADR База quick = working-tree vs HEAD включно з untracked-файлами

## Context and Problem Statement
Для quick-режиму потрібно визначити «змінені файли». Питання — що є базою порівняння і чи входять нові (ще не додані до git) файли.

## Considered Options
* G1+untracked: working-tree vs HEAD + нові файли (untracked)
* G1 без untracked: лише tracked-modified + staged
* G2: vs merge-base з `main` (вся гілка)

## Decision Outcome
Chosen option: "working-tree vs HEAD + untracked", because сценарій quick — «агент щойно наредагував/створив файл, хоче перевірити до коміту»; новий файл, якого ще немає в git, також потребує lint; G2 ширший за потреби quick і ближчий до ролі ci.

### Consequences
* Good, because transcript фіксує очікувану користь: порожнє дерево → quick нічого не лінтить, миттєво завершується.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Реалізовано у `npm/scripts/lib/changed-files.mjs` (`collectChangedFiles`): `git diff HEAD --name-only` + `git ls-files --others --exclude-standard`. Тести: 3 сценарії (modified, untracked, clean tree).

---

## ADR Squash-merge як конвенція завершення worktree-гілки

## Context and Problem Statement
Після реалізації Spec B (9 комітів) виникло питання, як інтегрувати worktree-гілку в `main`: зберегти всі коміти чи squash. Для Spec B обрали «лишити 9 комітів» (fast-forward). Щоб уникати неоднозначності в майбутніх сесіях, потрібна явна конвенція.

## Considered Options
* Squash-merge за замовчуванням (`git merge --squash`)
* Зберігати всі коміти (fast-forward або merge commit)
* Вибирати case-by-case без правила

## Decision Outcome
Chosen option: "squash-merge за замовчуванням", because агент має запропонувати squash при завершенні гілки — це зменшує шум в `main` і кожна фіча з`являється як один атомарний коміт; якщо треба зберегти коміти, користувач явно відмовляється від squash.

### Consequences
* Good, because transcript фіксує очікувану користь: Spec C інтегровано одним squash-комітом `ebe76db`; `main` лишається чистим.
* Bad, because транзакційна детальна історія гілки втрачається після squash (для Spec B це вже не вдалося застосувати ретроактивно).

## More Information
Конвенція зафіксована в `npm/rules/worktree/worktree.mdc` (коміт `b2b8e11`, потім `41cc767` на origin). Застосована вперше для Spec C: `git merge --squash feat/lint-quick-ci` → коміт `ebe76db` → `git branch -D feat/lint-quick-ci`.
