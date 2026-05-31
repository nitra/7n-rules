---
session: 09dcb1bc-929b-4d88-90b0-c0611bed3d2f
captured: 2026-05-31T12:49:55+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/09dcb1bc-929b-4d88-90b0-c0611bed3d2f.jsonl
---

## ADR Squash-merge як рекомендований спосіб фінішу worktree-гілки

## Context and Problem Statement
Після завершення реалізації Spec B (9 комітів на `feat/rule-meta-json`) Worktree потрапив у `main` через fast-forward без сквошу. Користувач запитав, чи можна злити «одним комітом», а потім попросив зафіксувати цю конвенцію у правилі, щоб агент завжди її пропонував.

## Considered Options
* Додати секцію «Завершення гілки worktree» у `npm/rules/worktree/worktree.mdc` із рекомендацією `git merge --squash`
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Додати секцію squash-merge у worktree-правило", because користувач явно попросив: «додай в правило worktree щоб завжди пропонувався саме цей варіант», і цей патерн повторно виник після спостереження, що ff-merge зберіг 9 окремих TDD-комітів у `main`.

### Consequences
* Good, because transcript фіксує очікувану користь: агент тепер за замовчуванням пропонуватиме squash при завершенні будь-якої worktree-гілки, що дає чисту лінійну `main`-гісторію.
* Bad, because squash знищує поетапну TDD-гісторію (9 комітів → 1); transcript не містить підтверджених негативних наслідків — але фактично в цій самій сесії користувач обрав **(B) не squash**, коли Spec B вже потрапила в `main` через ff.

## More Information
* Змінений файл: `npm/rules/worktree/worktree.mdc` — додана секція «Завершення гілки worktree».
* Change-файл: `npm/.changes/1780218783124-a30f10.md` (bump patch, section Changed).
* Коміт: `41cc767 feat(worktree-rule): пропонувати squash-merge при завершенні гілки worktree`.
* Правило набуде сили в проєктах-споживачах після релізу нової версії `@nitra/cursor` (дзеркало `.cursor/rules/n-worktree.mdc` синкається з опублікованого пакета, не з локального джерела).

---

## ADR Архітектура розділення lint на quick і lint-ci через meta.json і CLI-оркестратор

## Context and Problem Statement
Кореневий `bun run lint` — монолітний ланцюг із 6 під-лінтів, який запускається однаково і локально (агент хоче швидко перевірити свої зміни), і в CI (повна перевірка всього репо). Ціль — розбити на `lint` (швидкий, по змінених файлах) і `lint-ci` (повний, по всіх) так, щоб приналежність кроку до кожної фази декларувалася в `meta.json` правила.

## Considered Options
* **(D1)** Атрибут `lint: "quick"|"ci"` на рівні правила — просто, але правило `js-lint` є композитним (в ньому є і quick-, і ci-інструменти), тому не ділиться одним полем без утрати точності.
* **(D3)** Атрибут на рівні правила для 90% правил + явне розщеплення `js-lint` на два кроки (quick: oxlint+eslint; ci: jscpd+knip).
* **(F1)** CLI-оркестратор `n-cursor lint`/`n-cursor lint-ci` зі збиранням набору кроків із `meta.json`; кореневий `package.json` делегує.
* **(F2)** Генерація ланцюга скриптів у `package.json` під час sync.
* **(F3)** Лишити хардкод-ланцюг, лише обернути інструменти у фільтр по diff.
* **(E1)** Поле `lint: "quick"|"ci"` (семантика: `quick ⊆ ci`, тобто quick-кроки входять в обидва).
* **(E2)** Поле-обʼєкт `lint: {phase, scope}`.
* **(E3)** Булеві прапорці `lintQuick`, `lintCi`.
* **(H1)** Обидва режими роблять `--fix` (симетрична поведінка).
* **(H2)** `lint` фіксить, `lint-ci` — тільки перевіряє (no-fix).

## Decision Outcome
Chosen option: "D3 + E1 + F1 + база working-tree+untracked + H1", because:
- **D3**: `js-lint` — єдиний реальний композитний крок; для нього свідоме розщеплення простіше за загальний механізм (D2) і не ламає семантику, як (D1).
- **E1**: одне поле з enum — мінімальна схема, scope (changed/all) виводиться з фази автоматично; YAGNI проти E2/E3.
- **F1**: data-driven оркестрація в коді пакета — те саме, що зроблено з `auto-rules.mjs` у Spec B; генерація (F2) не вирішує задачу «передати список файлів кожному інструменту».
- **База quick**: working-tree зміни проти HEAD + untracked — покриває типовий сценарій «агент наредагував і хоче перевірити», включно з новими файлами.
- **H1**: зберігає поточну fix-поведінку в обох режимах; H2 змінює поведінку CI (не всі інструменти мають однаковий `--no-fix` режим), H1 — менше сюрпризів на старті.

### Consequences
* Good, because transcript фіксує очікувану користь: `lint` (агент, швидко) не ганяє `jscpd`/`knip`/`trufflehog` по всьому репо; `lint-ci` гарантує повну перевірку; мета-атрибут у `meta.json` дозволяє додавати/змінювати кроки без редагування ланцюга в `package.json`.
* Bad, because transcript не містить підтверджених негативних наслідків. Neutral, because F1 потребує нового CLI-оркестратора в пакеті (більша поверхня коду), а js-lint розщеплення додає новий концерн/крок — обидва аспекти не верифіковані реалізацією в цій сесії (сесія завершилась на стадії brainstorming).

## More Information
* Визначені інструменти за фазою: quick — `oxlint`, `eslint`, `stylelint`, `oxfmt`; ci-only — `jscpd`, `knip`, `trufflehog`; CLI-кроки `lint-ga`, `lint-rego`, `lint-text` — потребують перевірки підтримки file-list-аргументу перед призначенням фази.
* Конвенція імен скриптів: `"lint": "n-cursor lint"`, `"lint-ci": "n-cursor lint-ci"` у кореневому `package.json`.
* Brainstorming завершився на рішенні H1; spec-документ і план реалізації ще не написані (наступний крок — writing-plans skill).
* Поточний хардкод-ланцюг: `lint-ga && lint-js && lint-rego && lint-security && lint-style && lint-text && oxfmt .` у `package.json`.
