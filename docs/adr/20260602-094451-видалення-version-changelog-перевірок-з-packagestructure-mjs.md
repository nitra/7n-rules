---
session: c893caa2-5ff0-49f2-878b-bcb1acbae65e
captured: 2026-06-02T09:44:51+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-cursor/c893caa2-5ff0-49f2-878b-bcb1acbae65e.jsonl
---

## ADR Видалення version/CHANGELOG-перевірок з `package_structure.mjs`

## Context and Problem Statement
`n-changelog.mdc` забороняла ручний bump версії (єдиний артефакт — change-файл), а `n-npm-module.mdc` неявно вимагала його через `checkDirtyNpmRequiresVersionBump` і `checkChangelogTopMatchesPackageVersion` у `npm/rules/npm-module/js/package_structure.mjs`. Перевірки були не просто надлишковими — вони штовхали до дій, що порушували перше правило.

## Considered Options
* Видалити `checkDirtyNpmRequiresVersionBump` і `checkChangelogTopMatchesPackageVersion` з `package_structure.mjs`; делегувати відповідальність у `changelog.mdc` і `changelog/js/consistency.mjs`
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Видалити суперечливі перевірки з `package_structure.mjs`", because перевірки були інвертовано суперечливими з `n-changelog.mdc` (не просто дублювали текст, а штовхали до ручних дій, заборонених іншим правилом); `changelog/js/consistency.mjs` вже покривала обидва сценарії (drift vs registry/git-база і missing change-file).

### Consequences
* Good, because `npm-module.mdc` більше не містить інструкцій bump/CHANGELOG — єдине місце цих правил тепер `changelog.mdc`.
* Good, because transcript фіксує очікувану користь: `eslint` exit 0, цільові тести 65/65 зелені, `grep` ручного-bump по `npm/rules/**/*.mdc` повертає лише `changelog.mdc`.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Змінені файли: `npm/rules/npm-module/js/package_structure.mjs`, `npm/rules/npm-module/js/tests/package_structure.test.mjs`, `npm/rules/npm-module/npm-module.mdc` (v1.13→1.14), `npm/rules/changelog/changelog.mdc` (v3.1→3.2), `npm/tests/integration-repo-checks.test.mjs`. Change-файл: `npm/.changes/` (bump: patch, section: Fixed). Коміти: `fe08579`, `38828ad`. Гілка: `changelog-npm-module-align`.

---

## ADR Багаторівневий cwd-незалежний резолвинг активного стану flow

## Context and Problem Statement
Команди `flow spec/plan/verify/review/gate/release` викликали `flowStatePath(cwd)`, де `cwd` — поточний каталог shell-виклику. Кожен новий Bash-блок скидає cwd у головне дерево репозиторію, а не у worktree задачі, тому команди повертали «стану нема — спершу `flow init`» навіть за активного flow; за сесію це траплялось 3 рази.

## Considered Options
* **A — багаторівневий резолвинг:** sibling-перевірка (cwd) → scan активних `.worktrees/*.flow.json` (якщо один активний — взяти з info-логом; якщо кілька — fail зі списком) → явний `--branch` завжди перемагає
* **B — лише toplevel-резолвинг:** `git rev-parse --show-toplevel`; поза worktree вимагати `--branch`
* **C — завжди вимагати явний `--branch`/`--worktree`** поза кореневою текою worktree

## Decision Outcome
Chosen option: "A — багаторівневий резолвинг", because лише варіант A авторезолвить один активний flow незалежно від cwd, що і є прямою причиною болю; sibling-шлях (варіант B) не рятує при запуску з головного дерева.

### Consequences
* Good, because transcript фіксує очікувану користь: новий модуль `flow-resolve.mjs` + `extractBranchFlag` у `dispatcher/index.mjs`; 193 тести dispatcher зелені; eslint exit 0.
* Good, because review (2 рецензенти, L2) знайшов і було виправлено: `--branch` без значення тихо ковтав сусіда → валідація доданa; `--branch` неіснуючого worktree → чітке повідомлення замість ENOENT; авторезолв тягнув чужий flow із worktree-без-стану → обмежено запуском поза worktree.
* Bad, because швидкий sibling-шлях не покриває edge-case: worktree без стану і єдиний активний flow поруч — transcript фіксує, що цей сценарій свідомо не авторезолвиться (лише за `--branch`).

## More Information
Новий файл: `npm/scripts/dispatcher/lib/flow-resolve.mjs`. Змінені файли: `npm/scripts/dispatcher/index.mjs`, `npm/scripts/dispatcher/lib/commands.mjs`, `npm/scripts/dispatcher/lib/spec.mjs`, `npm/scripts/dispatcher/lib/plan.mjs`, `npm/scripts/dispatcher/lib/gate.mjs`, `npm/scripts/dispatcher/lib/review.mjs`. Change-файл: `npm/.changes/` (bump: minor, section: Added). Коміт: `ccaad96`. Гілка: `flow-cwd-state-resolution`.

---

## ADR Резолв лінків front-matter відносно теки артефакту; поле `flow:` як info

## Context and Problem Statement
`trace.mjs` резолвив усі лінки front-matter через `join(root, target)` (root = корінь репо), тоді як конвенція доків і наявні приклади використовують file-relative шляхи (`../specs/…`). Результат: кожен коректний `spec ↔ plan` лінк давав хибне «✗ РОЗРИВ», а поле `flow:` (вказує на `.worktrees/<branch>.flow.json`, gitignored, відсутній у CI) теж рахувалось breaking — сигнал «розрив» горів завжди і став ігнорованим.

## Considered Options
* **A — file-relative + root-relative fallback; `flow:` = info:** резолвити відносно теки артефакту, якщо не знайдено — спробувати root-relative; поле `flow:` відображати як `~ … (runtime-стан)`, не рахувати breaking
* **B — прибрати `flow:` з `LINK_FIELDS` зовсім:** не показувати й не перевіряти
* **C — перевіряти всі поля однаково (relative + root fallback):** `flow:` також рахується breaking

## Decision Outcome
Chosen option: "A — file-relative + root-relative fallback; `flow:` = info", because file-relative — конвенція наявних закомічених доків; поле `flow:` є корисним людським вказівником на стан задачі, але `.flow.json` gitignored і відсутній у чистому checkout/CI — його відсутність не означає «розрив ланцюга».

### Consequences
* Good, because transcript фіксує очікувану користь: на реальних доках worktree `runTraceCli` повертає exit 0; усі `../specs/…` лінки показуються як `→` (раніше хибний `✗`); `flow:` показується як `~ … (runtime-стан)`.
* Good, because transcript фіксує очікувану користь: 16 тестів trace + 181 dispatcher зелені; eslint exit 0.
* Bad, because подвійний резолв (file-relative, потім root-relative fallback) маскує помилки конвенції у front-matter — лінк «зарезолвиться» через fallback навіть якщо використана неправильна конвенція. Рецензент позначив це як 🟡; прийнято свідомо як компроміс між сигналом і шумом.

## More Information
Змінений файл: `npm/scripts/dispatcher/trace.mjs`. Новий імпорт: `dirname` з `node:path`. Константа `LINK_FIELDS` розділена на `CHAIN_FIELDS` (breaking: adr/spec/plan/change/task) та `INFO_FIELDS` (не breaking: flow). Тест: `npm/scripts/dispatcher/tests/trace.test.mjs` (+7 нових кейсів). Change-файл: `npm/.changes/` (bump: patch, section: Fixed). Коміт: `1bd829a`. Гілка: `flow-trace-relative-links`.
