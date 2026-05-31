---
session: 09dcb1bc-929b-4d88-90b0-c0611bed3d2f
captured: 2026-05-31T17:15:58+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/09dcb1bc-929b-4d88-90b0-c0611bed3d2f.jsonl
---

## ADR Розділення lint на `lint` (quick) / `lint-ci` (full) через `meta.json.lint` (Spec C, E1)

## Context and Problem Statement
Кореневий `bun run lint` запускав хардкод-ланцюг із 6 під-лінтів (`lint-ga`, `lint-js`, `lint-rego`, `lint-security`, `lint-style`, `lint-text`) + `oxfmt` — однаковий і при розробці, і в CI. Користувач запропонував керувати належністю lint-кроку до швидкого чи повного набору через поле у `meta.json` правила, з конвенцією: `lint` = швидкий (тільки по змінених), `lint-ci` = повний (по всіх).

## Considered Options
* **(E1) Одне поле `lint: "quick"|"ci"` у `meta.json`** — семантика `quick ⊆ ci`; крок із `"quick"` входить в обидва набори, з `"ci"` — лише в `lint-ci`; відсутнє поле = правило не є lint-кроком.
* **(E2) Поле-об'єкт `lint: { phase, scope }`** — окремо фаза і scope (scope майже завжди корелює з фазою — зайва вісь).
* **(E3) Булеві прапорці `lintQuick: true`, `lintCi: true`** — два поля, багатослівно, допускає суперечливі комбінації.
* **(F1) CLI-оркестратор у пакеті** — нові команди `n-cursor lint` / `n-cursor lint-ci`, які сканують `rules/*/meta.json` і збирають набір кроків; кореневі скрипти делегують у CLI.
* **(F2) Генерація скриптів** — CLI генерує ланцюг у `package.json` із meta (як AGENTS.md); складно вшити різну область сканування в генерований рядок.
* **(F3) Лишити ланцюг, додати лише фільтр** — мінімальна зміна без data-driven підходу.
* **(H1) Fix симетрично** — обидва `lint` і `lint-ci` роблять `--fix` і падають на залишку.
* **(H2) quick фіксить, ci лише перевіряє** — `lint-ci` без `--fix`.

## Decision Outcome
Chosen option: **E1 + F1 + H1**, because:
- E1 — мінімальне одне поле, семантика `quick ⊆ ci` покриває всі випадки без зайвих осей (YAGNI); scope виводиться з фази автоматично.
- F1 — єдиний варіант, що реалізує ідею «meta.json керує»; дзеркалить наявний патерн `lint-ga`/`lint-text` (CLI-виконавець + тонкий скрипт-делегат); хардкод-ланцюг у `package.json` зникає.
- H1 — зберігає наявну fix-поведінку для обох наборів, мінімум сюрпризів; H2 можна додати пізніше.

### Consequences
* Good, because transcript фіксує очікувану користь: `n-cursor lint` ганяє лише швидкий набір (oxlint+eslint+stylelint+oxfmt) по підмножині файлів; `n-cursor lint-ci` ганяє повний набір (включно з jscpd, knip, trufflehog, ga, rego, text) по всьому репо.
* Good, because transcript фіксує очікувану користь: scope lint-кроків задається в `meta.json` один раз для всіх репо; кореневий `package.json` лише делегує через sync.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- Файли реалізації (зафіксовані в коміті squash `ebe76db`, реліз `@nitra/cursor@1.40.0`): `npm/scripts/lint-cli.mjs`, `npm/scripts/lib/changed-files.mjs`, `npm/scripts/lib/run-lint-cli.mjs` (видалено), `npm/bin/n-cursor.js` (case `lint` / `lint-ci`), `npm/rules/*/meta.json` (поле `lint`), `npm/rules/js-lint-ci/` (нове правило).
- Spec: `docs/superpowers/specs/2026-05-31-lint-quick-ci-split-design.md` (статус Approved, переписаний під E1 у коміті `ac2b165`).
- Тести: `npm/scripts/tests/lint-cli.test.mjs` (`selectLintRules` — quick/ci фільтрація), `npm/scripts/lib/tests/changed-files.test.mjs`, `npm/scripts/lib/tests/rule-meta.test.mjs` (`parseRuleLintPhase`).
- Інструменти без підтримки subset-сканування (`jscpd`, `knip`, `trufflehog`, `lint-ga`, `lint-rego`, `lint-text`) класифіковано `"lint": "ci"`; інструменти, що приймають список файлів (`oxlint`, `eslint`, `stylelint`, `oxfmt`), — `"lint": "quick"`. Класифікація `ga`/`rego`/`text` звірена фактично (їхні CLI не приймають файли).

---

## ADR Гранулярність D3: атрибут на правилі + розщеплення `js-lint`/`js-lint-ci`

## Context and Problem Statement
Поле `meta.json.lint` (E1) працює, якщо одне правило = один lint-крок. Правило `js-lint` порушує цю модель: `lint-js` раніше поєднував `oxlint --fix && eslint --fix . && jscpd . && knip` — і quick-інструменти (oxlint, eslint, що приймають список файлів), і ci-тільки інструменти (jscpd, knip — крос-файлові). Одне поле `lint` на рівні правила не може це розрізнити.

## Considered Options
* **(D1) Атрибут на правилі, грубо** — `js-lint` цілком у `"quick"` або цілком у `"ci"`; неточно (у `"quick"` — jscpd/knip марно ганяються на diff; у `"ci"` — eslint/oxlint не у швидкому наборі).
* **(D2) Атрибут на lint-кроці/інструменті** — окремий рівень декларації з тегом `quick`/`ci` для кожного інструмента; гнучко, але новий рівень конфігу.
* **(D3) Атрибут на правилі + розщеплення `js-lint`** — більшість правил отримують простий атрибут (D1); `js-lint` як єдиний композитний розбивається на `js-lint` (oxlint+eslint, `"lint":"quick"`) і нове `js-lint-ci` (jscpd+knip, `"lint":"ci"`).

## Decision Outcome
Chosen option: **D3**, because `js-lint` — єдиний реальний композит; одне свідоме розщеплення для одного виключення простіше за загальне ускладнення схеми (D2) або за втрату точності (D1). Дзеркалить принцип «90% простих + 1 явний виняток».

### Consequences
* Good, because transcript фіксує очікувану користь: `npm/rules/js-lint-ci/` (jscpd+knip, `"lint":"ci"`) і `npm/rules/js-lint/` (oxlint+eslint, `"lint":"quick"`) успішно сканується `selectLintRules` — тест `quick: ['js-lint']`, `ci: ['js-lint', 'js-lint-ci']` PASS.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- Нові файли: `npm/rules/js-lint-ci/js-lint-ci.mdc`, `npm/rules/js-lint-ci/meta.json` (`{"lint":"ci"}`), `npm/rules/js-lint-ci/js/lint.mjs`, `npm/rules/js-lint-ci/fix.mjs`.
- `npm/rules/js-lint/meta.json` оновлено: додано `"lint":"quick"`.
- Коміт `995baef` (Task 4), інтегровано в squash `ebe76db`.

---

## ADR База «змінених файлів» для quick-lint: working-tree vs HEAD плюс untracked

## Context and Problem Statement
Оркестратор `n-cursor lint` (quick-набір) має ганяти lint лише по «змінених» файлах. Потрібно визначити, що вважати «зміненими»: незакомічені зміни проти HEAD, усі зміни гілки проти main, або інше; і чи включати нові (untracked) файли.

## Considered Options
* **(G1) `git diff` проти HEAD** — незакомічені зміни (working tree + staged), без untracked.
* **(G2) Проти merge-base з основною гілкою** — усі зміни гілки vs `main`; ширше, але ближче до ролі CI.
* **(G3 / пропозиція сесії) Working-tree vs HEAD + untracked** — G1 плюс нові файли (ще не `git add`); охоплює «агент щойно створив файл, але ще не закомітив».

## Decision Outcome
Chosen option: **G3 (working-tree vs HEAD + untracked)**, because нові файли, які агент щойно створив, теж мають потрапити у quick-lint; без untracked «причесати свої зміни» пропустить їх. G2 (vs main) ближче до ролі CI, а не quick.

### Consequences
* Good, because transcript фіксує очікувану користь: тест `changed-files.test.mjs` перевіряє три сценарії — modified tracked, untracked (новий файл), чисте дерево → порожньо; усі 3 PASS (`9edd63e`).
* Good, because transcript фіксує очікувану користь: порожній набір змінених файлів → крок quick скіпається миттєво.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- Реалізація: `npm/scripts/lib/changed-files.mjs` — `collectChangedFiles(cwd)`, використовує `git diff HEAD --name-only` + `git ls-files --others --exclude-standard`.
- Тест: `npm/scripts/lib/tests/changed-files.test.mjs` (3 кейси).
- Коміт `9edd63e` (Task 2), інтегровано в squash `ebe76db`.

---

## ADR Канонізація E1 (одне поле) поверх 5-польової схеми паралельної сесії

## Context and Problem Statement
У процесі сесії з'ясувалося, що паралельний агент написав канонічний spec `2026-05-31-lint-quick-ci-split-design.md` зі статусом «Approved», але з 5-польовою `meta.json`-схемою (`lint`, `lintCmd`, `lintScoped`, `lintAlways`, `lintCiCmd`), яка суперечила E1 (одне поле `lint: "quick"|"ci"`), узгодженому в brainstorming поточної сесії. Одночасно існував дубль-spec (`lint-split-quick-ci-design.md`, 1 коміт) і дубль-план під 5-польову схему (`lint-quick-all-meta-json.md`).

## Considered Options
* **Наш E1** (одне поле `lint`, виконавець `js/lint.mjs`) — простіше, узгоджено в brainstorming; вимагає переписати spec і план.
* **5-польова схема паралельної сесії** (`lintCmd`/`lintScoped`/`lintAlways`/`lintCiCmd`) — вже у spec і плані; потужніше, але складніше і суперечить E1.
* **Зупинитись, не виконувати** — лишити паралельній фермі агентів довести одну версію.

## Decision Outcome
Chosen option: **наш E1**, because користувач явно підтвердив «наш E1» після отримання опису розбіжності. Spec переписано (`ac2b165`), 5-польовий план (`lint-quick-all-meta-json.md`) видалено і замінено новим E1-планом (`lint-quick-ci-e1.md`), дубль-spec (`lint-split-quick-ci-design.md`) видалено (`26cb6ac`).

### Consequences
* Good, because transcript фіксує очікувану користь: одне поле у `meta.json` простіше декларувати і валідувати; `rule_meta.mjs` розширено лише одним полем-enum.
* Bad, because transcript фіксує, що E1 не може задекларувати «обидві фази» для одного правила в одному полі — це вирішено через D3 (розщеплення `js-lint`), а не через гнучкіший 5-польовий підхід.

## More Information
- Spec: `docs/superpowers/specs/2026-05-31-lint-quick-ci-split-design.md` (переписаний коміт `ac2b165`, статус «Approved (E1 — узгоджено в brainstorming)»).
- Видалені: `docs/superpowers/specs/2026-05-31-lint-split-quick-ci-design.md` (дубль), `docs/superpowers/plans/2026-05-31-lint-quick-all-meta-json.md` (5-польовий план).
- Новий план: `docs/superpowers/plans/2026-05-31-lint-quick-ci-e1.md` (8 задач, коміт `a434653`).
- Brainstorming незалежно підтвердив дизайн, який паралельна сесія вже зафіксувала в spec (у 5-польовій формі), але E1 обрано як канон за явним рішенням користувача.
