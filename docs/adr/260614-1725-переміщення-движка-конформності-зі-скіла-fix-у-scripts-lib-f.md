---
session: 913990bf-de40-4a74-b536-d30012e981ab
captured: 2026-06-14T17:25:06+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-cursor/913990bf-de40-4a74-b536-d30012e981ab.jsonl
---

Нарахував 7 ключових рішень із transcript. Генерую ADR-блоки напряму.

---

## ADR Переміщення движка конформності зі скіла fix у scripts/lib/fix

## Context and Problem Statement
Движок конформності (orchestrator.mjs, t0.mjs, llm-worker.mjs) фізично розміщувався у каталозі скіла `npm/skills/fix/js/`, хоча виконував роль бібліотечного компонента, що використовується bin, lint-cli та іншими споживачами. Після рішення поглинути `fix` у `lint` та видалити публічний скіл fix, движок потребував стабільного нового дому.

## Considered Options
* Перемістити до `npm/scripts/lib/fix/` (та сама відносна глибина)
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "перемістити до `npm/scripts/lib/fix/`", because глибина шляхів залишається ідентичною (`fileURLToPath` + `join(HERE, '../../../bin/n-cursor.js')`), тому жоден відносний імпорт не ламається без додаткових правок.

### Consequences
* Good, because transcript фіксує очікувану користь: `Test Files 3 passed (3), Tests 19 passed (19)` після переміщення без жодних правок імпортів у тестах двигуна.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Переміщені файли: `skills/fix/js/orchestrator.mjs`, `t0.mjs`, `llm-worker.mjs`, docs, tests → `scripts/lib/fix/`. Споживачі оновлені: `npm/bin/n-cursor.js` (import) та `scripts/lint-cli.mjs` (import). Команда: `git mv skills/fix/js/... scripts/lib/fix/...`.

---

## ADR Спрощення PostToolUse-хука — один read-only виклик замість file-роутингу

## Context and Problem Statement
PostToolUse-хук (`npm/scripts/post-tool-use-fix.mjs`) містив функцію `routeFilePathToRules(filePath)`, яка маршрутизувала шлях відредагованого файлу у список правил і запускала кожне окремо. Після поглинання `fix` у `lint` та появи єдиного `_fix-check`-ентрипоінту роутинг став надлишковим.

## Considered Options
* Зберегти роутинг через `routeFilePathToRules` / `ROUTES`
* Один read-only виклик `_fix-check` для всіх активованих правил без роутингу

## Decision Outcome
Chosen option: "один read-only виклик `_fix-check`", because це усуває підтримку таблиці маршрутів (`ROUTES`) і залежність від `picomatch` у хуку, зводячи хук до мінімального детектора конформності.

### Consequences
* Good, because transcript фіксує очікувану користь: `post-tool-use-fix.test.mjs` — 11 passed; хук більше не потребує оновлення при додаванні нових правил.
* Bad, because хук тепер запускає всі правила після кожного редагування файлу, навіть нерелевантних — transcript не класифікує це як проблему, але потенційно збільшує час перевірки.

## More Information
Файл хука: `npm/scripts/post-tool-use-fix.mjs` (повністю переписано). Тест: `npm/scripts/tests/post-tool-use-fix.test.mjs` (переписано, 11 passed). Видалено: `routeFilePathToRules`, `ROUTES`, імпорт `picomatch`.

---

## ADR Видалення публічних команд `fix`/`check`/`fix-run` із CLI

## Context and Problem Statement
Публічний CLI `n-cursor` мав команди `fix`, `check`, `fix-run`, що запускали програматичні перевірки правил. Після реалізації осі `behavior` (`fix`-default / `--read-only`) у `lint` ці команди стали дублювати функціонал `lint`.

## Considered Options
* Видалити `fix`/`check`/`fix-run` як публічні команди, залишити `_fix-check`/`fix-t0` внутрішніми
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "видалити публічні `fix`/`check`/`fix-run`, залишити внутрішні фази", because `lint` є надмножиною `fix` (детекція + виправлення за один прохід), і наявність двох публічних ентрипоінтів з однаковою семантикою утворює неоднозначність.

### Consequences
* Good, because transcript фіксує очікувану користь: `Tests 2341 passed` після видалення; usage-рядок CLI став точнішим.
* Bad, because BREAKING change (bump major, секція Removed у change-файлі): зовнішні споживачі, що викликали `n-cursor fix` або `n-cursor check`, зламаються.

## More Information
Змінений файл: `npm/bin/n-cursor.js`. `ROOT_GUARDED_COMMANDS` оновлено до `[undefined,'','lint','coverage','change','release']`. Внутрішні команди `_fix-check` і `fix-t0` збережені. Change-файл: `npm/.changes/260614-1206.md`.

---

## ADR Повне видалення скіла `/n-fix`

## Context and Problem Statement
Після видалення публічних команд `fix`/`check` скіл `/n-fix` спочатку перетворено на делегата до `/n-lint` (SKILL.md з написом DEPRECATED). Однак скіл-делегат без власної поведінки залишається зайвим записом у каталозі, дзеркалах та CLAUDE.md.

## Considered Options
* Залишити делегатом (SKILL.md як перенаправлення)
* Повністю видалити: `npm/skills/fix/`, дзеркала `.cursor/skills/n-fix/`, `.claude/commands/n-fix.md`, запис у CLAUDE.md

## Decision Outcome
Chosen option: "повністю видалити", because скіл без поведінки — лише шум у системі discovery (auto-skills.mjs читає `meta.json` і завжди додавав `/n-fix` до конфігу).

### Consequences
* Good, because transcript фіксує очікувану користь: `Tests 2341 passed` після оновлення тестових фікстур; `ALL_SKILLS` у `auto-skills.test.mjs` скоригований без порушення логіки.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Видалені файли: `npm/skills/fix/SKILL.md`, `npm/skills/fix/meta.json`, `.cursor/skills/n-fix/SKILL.md`, `.claude/commands/n-fix.md`. Оновлені: `CLAUDE.md` (секція `## Skills`), `npm/scripts/tests/auto-skills.test.mjs` (константа `ALL_SKILLS`, 5 масивів-очікувань).

---

## ADR `rules/lint/` як домашній каталог оркестратора lint

## Context and Problem Statement
Оркестратор lint (`npm/scripts/lint-cli.mjs`) розташовувався у `scripts/`, хоча за специфікацією (spec consolidation §7) він повинен жити у `rules/lint/` як звичайне правило монорепо. Це ускладнювало навігацію та розривало зв'язок між правилом `lint` і його реалізацією.

## Considered Options
* Перемістити `scripts/lint-cli.mjs` → `rules/lint/js/orchestrate.mjs` і зареєструвати `rules/lint` як правило
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "перемістити до `rules/lint/js/orchestrate.mjs`", because це відповідає spec consolidation §7 і ставить оркестратор у один ряд з іншими правилами, спрощуючи discovery.

### Consequences
* Good, because transcript фіксує очікувану користь: `fix-mjs-contract.test.mjs` — лічильник правил 36→37; `n-cursor lint changelog` → `✅ fix: 1 правил — все чисто` через новий шлях; `_fix-check lint` → коректний no-op.
* Bad, because реєстрація `fix.mjs` для правила `lint` є no-op (правило не в `.n-cursor.json:rules`); потенційно заплутує — але transcript не кваліфікує це як проблему.

## More Information
`git mv npm/scripts/lint-cli.mjs npm/rules/lint/js/orchestrate.mjs`. Нові файли: `npm/rules/lint/meta.json` (`{ "auto": "завжди" }`), `npm/rules/lint/fix.mjs` (no-op). `PACKAGE_ROOT` у оркестраторі: `dirname(dirname(dirname(fileURLToPath(import.meta.url))))`. `npm/bin/n-cursor.js` import оновлено. Доки: `scripts/docs/lint-cli.md` → `rules/lint/js/docs/orchestrate.md` + перештампована frontmatter (`source: rules/lint/js/orchestrate.mjs`).

---

## ADR CI lint без авто-фіксу (read-only режим)

## Context and Problem Statement
CI-воркфлоу `lint-text.yml` і `lint-style.yml` мутували робоче дерево під час перевірки (`markdownlint --fix`, `stylelint --fix`), що порушує принцип CI як read-only верифікатора. Спроба просто прибрати `--fix` одразу ламала тести, бо правила (`formatting.mjs`, Rego) енфорсять точний вміст кроків воркфлоу через snippet-шаблони.

## Considered Options
* Оновити усі точки канону синхронно (snippet → Rego-тест → JS-перевірка → mdc → дзеркало → actual workflow)
* Лишити `--fix` у CI (відкинуто)
* Local-bin-хак для `n-cursor` у CI (непотрібний — `n-cursor` є workspace-symlink на локальне джерело)

## Decision Outcome
Chosen option: "оновити всі точки канону синхронно", because правила enforcing-канону (`formatting.mjs` перевіряє точний run-рядок, `lint_text.rego` виводить очікуване з `data.template.snippet`) вимагають узгодженого оновлення; часткова зміна ламає integration-тест `checkText`.

### Consequences
* Good, because transcript фіксує очікувану користь: `conftest verify lint_text 5/5, lint_style_yml 4/4`; `integration-repo-checks.test.mjs` — всі перевірки пройшли; CI більше не мутує дерево.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Для `lint-text.yml`: нова команда `n-cursor lint-text --read-only`. Оновлені канон-точки: `rules/text/policy/lint_text/template/lint-text.yml.snippet.yml`, `rules/text/js/formatting.mjs`, `rules/text/policy/lint_text/lint_text_test.rego`, `rules/text/js/tests/formatting/tests/check-fixture.test.mjs`, `.cursor/rules/n-text.mdc` (регенеровано). Для `lint-style.yml`: `npx stylelint '**/*.{css,scss,vue}'` (без `--fix`). Оновлені: `rules/style-lint/policy/lint_style_yml/template/lint-style.yml.snippet.yml`, `rules/style-lint/policy/lint_style_yml/lint_style_yml_test.rego`, `rules/style-lint/style-lint.mdc` (×3). `npm/bin/n-cursor.js` — dispatch `lint-text` додав підтримку `--read-only`.

---

## ADR Релаксація заборони паралельного запуску eslint

## Context and Problem Statement
Попередня політика (CLAUDE.md, `npm/skills/lint/SKILL.md`) забороняла будь-який паралельний запуск `bun run lint` / `lint-js` / `eslint` у різних Bash-задачах чи субагентах. Це надмірно обмежувало сценарії, де агент аналізує диз'юнктні набори файлів одночасно.

## Considered Options
* Лишити повну заборону паралелізму
* Дозволити паралелізм по диз'юнктних файлах, серіалізувати лише whole-tree прогони того самого корпусу

## Decision Outcome
Chosen option: "дозволити паралелізм по диз'юнктних файлах", because диз'юнктні набори (per-file `lint` на змінених vs origin) не конфліктують і не перевантажують диск/CPU; ризик виникає лише при одночасних whole-tree прогонах одного корпусу.

### Consequences
* Good, because transcript фіксує очікувану користь: агенти можуть паралельно лінтити різні файли без серіалізації; change-файл `260614-1250.md` зафіксував зміну як minor.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Оновлені файли: `CLAUDE.md` (секція `## Лінт і ESLint`, джерело — `buildClaudeLintParallelismSectionLines()` у `npm/bin/n-cursor.js`), `npm/skills/lint/SKILL.md` (секція про навантаження на macOS). Change-файл: `npm/.changes/260614-1250.md`.
