---
session: 913990bf-de40-4a74-b536-d30012e981ab
captured: 2026-06-14T13:05:09+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-cursor/913990bf-de40-4a74-b536-d30012e981ab.jsonl
---

## ADR Дві ортогональні осі оркестратора lint: scope (per-file|full) та behavior (fix|--read-only)

## Context and Problem Statement
Оркестратор `lint` мав заплутану модель з `quick`/`ci` режимами, що змішували концепти «які файли лінтити» і «чи виправляти знайдене». Це ускладнювало розширення і CI-інтеграцію.

## Considered Options
* Дві ортогональні осі: `scope` (`per-file|full`, база-origin) × `behavior` (fix-default|`--read-only`)
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Дві ортогональні осі scope × behavior", because специфікація `docs/specs/2026-06-14-lint-orchestrator-fix-readonly-unification-design.md` закріплює hard-rename `quick|ci→per-file|full`; `meta.json:lint` в 8 правилах оновлено; контракт `lint(files, cwd, {readOnly})` протягнуто крізь `js-lint`, `style-lint`, `text` (markdownlint/shellcheck/dotenv).

### Consequences
* Good, because transcript фіксує очікувану користь: 2353 тести зелені після інкрементів 1–2; CI-read-only та локальний fix-режим ізольовані без умовних гілок на рівні воркфлоу.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Файли: `npm/scripts/lib/rule-meta.mjs` (`parseRuleLintSpec`), `npm/scripts/lint-cli.mjs` (`selectLintRules`, `runLint`), `npm/rules/npm-module/js/rule_meta.mjs`, `meta.json` у правилах `security`, `text`, `js-lint`, `doc-files`, `ga`, `rego`, `js-lint-ci`. Команди: `n-cursor lint`, `n-cursor lint --full`, `n-cursor lint --read-only`.

---

## ADR Поглинання конформності fix у lint --full

## Context and Problem Statement
`n-cursor fix` і `n-cursor lint` існували як паралельні підсистеми; `lint` перевіряв лише лінтери, а `fix` — конформність (config-правила, whole-repo concerns). Це дублювало точки входу і ускладнювало CI.

## Considered Options
* `lint --full` як надмножина `fix` (конформність як whole-repo фаза лише при `--full`)
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "`lint --full` як надмножина `fix`", because transcript закріплює: «`lint --full` поглинає конформність — тепер функційна надмножина `fix`»; конформність-фаза додана в `runLint` після лінтер-фази, тільки якщо `full === true`.

### Consequences
* Good, because transcript фіксує очікувану користь: `lint --read-only --full` дає детект усього без мутацій — єдина точка входу для CI.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Файл: `npm/scripts/lint-cli.mjs` — додана конформність-фаза через `runOrchestratorCli(filter, cwd)` при `full`. Коміт: `028d4bf0`. Специфікація: `docs/specs/2026-06-14-lint-rule-consolidation.md`.

---

## ADR Видалення публічних команд fix/check і переміщення движка конформності

## Context and Problem Statement
Після поглинання конформності в `lint --full` команди `fix`, `check`, `fix-run` залишалися дублюючими публічними точками входу. Движок (`orchestrator.mjs`, `t0.mjs`, `llm-worker.mjs`) фізично жив у `npm/skills/fix/js/` — каталозі скіла, що блокувало видалення скіла.

## Considered Options
* Видалити публічні `fix`/`check`; перемістити движок у `scripts/lib/fix/`; позначити скіл `/n-fix` делегатом
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Видалення публічних команд і переміщення движка в `scripts/lib/fix/`", because глибина `npm/skills/fix/js/` і `npm/scripts/lib/fix/` однакова (3 рівні від `npm/`), тому `../../../`-імпорти лишились валідними без правок; `_fix-check`/`fix-t0` лишились внутрішніми фазами движка.

### Consequences
* Good, because transcript фіксує очікувану користь: 2341 тест зелений після видалення; `skills/fix/SKILL.md` перетворено на делегат `/n-lint` без втрати enumeration-інваріантів.
* Bad, because `fix changelog` у `hk.pkl` потребував синхронної заміни на `lint changelog` — точкова coupled-зміна.

## More Information
Файли переміщено: `npm/skills/fix/js/{orchestrator,t0,llm-worker}.mjs` → `npm/scripts/lib/fix/`. Bin (`npm/bin/n-cursor.js`): `case 'fix'`, `case 'check'`, `case 'fix-run'` — видалено; `ROOT_GUARDED_COMMANDS` — оновлено. `hk.pkl` рядок 18: `fix changelog` → `lint changelog`. Коміт: `185cbeab`.

---

## ADR PostToolUse-хук: один read-only виклик усіх правил замість routing-таблиці

## Context and Problem Statement
Попередній PostToolUse-хук мав таблицю `ROUTES` (шлях файлу → список правил), щоб уникнути дорогого повного `fix` на кожному edit. Після переходу до read-only режиму (нуль мутацій, нуль LLM) оптимізація-роутинг стала зайвою.

## Considered Options
* Один виклик `_fix-check` для всіх активованих правил без роутингу
* Фільтр файл→правила (залишити таблицю ROUTES для read-only)

## Decision Outcome
Chosen option: "Один виклик без роутингу", because користувач підтвердив: «якщо read-only детект — дешевий, роутинг зайвий; один виклик усіх активованих правил»; таблицю `ROUTES` і `picomatch`-залежність хука видалено.

### Consequences
* Good, because хук став тривіально простим: `extractFilePath(stdin)` → якщо файл є → `spawnSync('bun', [N_CURSOR_BIN, '_fix-check'])`.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Файл: `npm/scripts/post-tool-use-fix.mjs` — повністю переписано. Тест: `npm/scripts/tests/post-tool-use-fix.test.mjs` — 11 тестів (routing-тести видалено, залишено `extractFilePath` + CLI entry). Коміт: `185cbeab`.

---

## ADR Релаксація заборони паралельного ESLint: диз'юнктні файли дозволено

## Context and Problem Statement
CLAUDE.md містила абсолютну заборону на паралельний запуск `eslint`/`lint`/`lint-js` у різних задачах. Це не дозволяло агентам лінтити різні (диз'юнктні) файли паралельно, що сповільнювало роботу.

## Considered Options
* Релаксація: паралельно по диз'юнктних файлах — дозволено; серіалізувати лише whole-tree прогони того самого корпусу
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Релаксація для диз'юнктних наборів файлів", because джерело-канон `buildClaudeLintParallelismSectionLines` у `npm/bin/n-cursor.js` оновлено із новою семантикою; `npm/skills/lint/SKILL.md` синхронізовано; CLAUDE.md перерендерено.

### Consequences
* Good, because transcript фіксує очікувану користь: агенти можуть паралельно лінтити per-file зміни без конфлікту (per-file `lint` на змінених vs origin — диз'юнктні набори).
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Файли: `CLAUDE.md` (секція «Лінт і ESLint»), `npm/bin/n-cursor.js` (функція `buildClaudeLintParallelismSectionLines`), `npm/skills/lint/SKILL.md`. Коміт: `4ceb657e`.

---

## ADR `lint-text --read-only`: детект без авто-фіксу як окрема вісь підкоманди

## Context and Problem Statement
Підкоманда `lint-text` завжди запускала авто-фікс (markdownlint/shellcheck patch/dotenv fix). Для майбутнього CI-перевода на read-only (`lint-text.yml` без мутацій) потрібний прапорець, що гейтить усі мутації.

## Considered Options
* Прапорець `--read-only` у `lint-text` → пропускає авто-фікс, лише детект
* Окрема команда `lint-text-ci`
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Прапорець `--read-only` у `lint-text`", because вісь behavior вже прийнята для оркестратора; `lint-text` природно слідує тому ж контракту; реалізовано протягуванням `readOnly` крізь `runLintTextCli` → `runLintTextSteps` → `runShellcheckText` / `runDotenvLinter`.

### Consequences
* Good, because transcript фіксує очікувану користь: можливість `bun ./npm/bin/n-cursor.js lint-text --read-only` у CI без зміни канону воркфлоу (CI-реструктуризація воркфлоу відкладена через coupled-залежність `checkText` → `formatting.mjs` канону).
* Bad, because transcript фіксує: спроба змінити `lint-text.yml` і `lint-style.yml` для CI-read-only зламала `checkText` (правило `text/js/formatting.mjs` енфорсить `bun run lint-text` без прапорців) — воркфлоу відкочено, CI-follow-up залишено відкритим.

## More Information
Файли: `npm/bin/n-cursor.js` (dispatch `lint-text` + `--read-only`), `npm/rules/text/lint/lint.mjs` (`runLintTextSteps(readOnly)`), `npm/rules/text/lint/run-shellcheck.mjs`, `npm/rules/text/lint/run-dotenv-linter.mjs`. Коміт: `60e6aaa3`. CI-follow-up: оновлення `rules/text/js/formatting.mjs` канону + воркфлоу.
