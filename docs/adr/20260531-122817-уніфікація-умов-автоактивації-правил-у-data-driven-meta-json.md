---
session: 09dcb1bc-929b-4d88-90b0-c0611bed3d2f
captured: 2026-05-31T12:28:17+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/09dcb1bc-929b-4d88-90b0-c0611bed3d2f.jsonl
---

## ADR Уніфікація умов автоактивації правил у data-driven `meta.json` (Spec B)

## Context and Problem Statement
Кожне правило у `npm/rules/` мало окремий файл `auto.md` з умовою активації. Логіку парсингу було хардкодовано масивами `autoRuleChecks`, `AUTO_RULE_ORDER`, `AUTO_RULE_DEPENDENCIES` у `npm/scripts/auto-rules.mjs`. Правило `tauri` мало мертву умову — ніколи не спрацьовувало. Нові правила вимагали змін одразу в кількох місцях.

## Considered Options
* Замінити 29 `auto.md` на `meta.json` з 4 формами (`"завжди"`, `["rule", …]`, `{ "glob": … }`, `{ "predicate", "arg"? }`) і meta-інтерпретатором у `auto-rules.mjs`
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "data-driven `meta.json` з 4 формами `auto`", because кожне правило стає самодостатнім джерелом даних; `AUTO_RULE_ORDER` і `AUTO_RULE_DEPENDENCIES` виводяться з даних, а не хардкоду; правило `tauri` автодетектується вперше.

### Consequences
* Good, because transcript фіксує очікувану користь: хардкод `autoRuleChecks`/`ORDER`/`DEPS` прибрано (−449 рядків), 33 `meta.json` + видалено 29 `auto.md`, регресійний сюїт 46/46, фінальний огляд APPROVED (6/6 інтеграційних перевірок).
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Файли: `npm/scripts/lib/rule-meta.mjs` (парсер, 11 тестів), `npm/scripts/lib/rule-predicates.mjs` (6 предикатів), `npm/scripts/lib/rule-meta-helpers.mjs` (допоміжні функції для розриву циклу), `npm/rules/*/meta.json` (33 файли). Тести: `npm/scripts/lib/tests/rule-meta.test.mjs`, `npm/scripts/tests/auto-rules.test.mjs` (46 passed). Spec: `docs/superpowers/specs/2026-05-31-rule-meta-json-design.md`, план: `docs/superpowers/plans/2026-05-31-rule-meta-json.md`. Коміт: `616f832..f02a148`.

---

## ADR Glob-форма для Type A правил з семантикою `<dir>/**`

## Context and Problem Statement
13 правил використовували перевірку `existsSync(path)` — спрацьовувала і на порожніх директоріях. При переході до `meta.json` потрібна єдина glob-форма для файлових і директорних умов.

## Considered Options
* Glob `<dir>/**` для директорій (матчить лише якщо є хоч один файл; порожній каталог не тригерить)
* Зберегти `existsSync`-семантику (порожній каталог тригерить) через окрему форму
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "`<dir>/**`", because порожній `k8s/` чи `ga/` без файлів на практиці не має сенсу підключати правило; `<dir>/**` навіть коректніше. Різниця мізерна, семантика зафіксована у spec як свідома.

### Consequences
* Good, because transcript фіксує очікувану користь: єдина glob-форма покриває і файли, і каталоги; реалізація — один прохід дерева `collectAutoRuleFacts` + glob-тестування без N-разового walk.
* Bad, because порожній каталог (наприклад `k8s/` зі стаб-файлами, видаленими тимчасово) більше не тригерить — свідома зміна семантики; transcript це фіксує як прийнятну.

## More Information
Таблиця glob-мапінгу 13 правил: `docs/superpowers/specs/2026-05-31-rule-meta-json-design.md`. Функція `globToRegex` перевикористана з `npm/rules/npm-module/js/package_structure.mjs:374`. Нюанс з `bun`: glob `package.json` (корінь, без `**/`) — навмисний, відрізняє від будь-якого `**/package.json`.

---

## ADR Squash-merge як рекомендований спосіб завершення worktree-гілки

## Context and Problem Statement
При завершенні реалізації на worktree-гілці постало питання: яким способом мерджити в `main`. Користувач запитав, чи злиття буде «одним комітом». Виникла потреба зафіксувати відповідь як постійну рекомендацію.

## Considered Options
* Squash-merge (`git merge --squash`) — один коміт в `main`
* Fast-forward merge — усі коміти гілки лінійно в `main`
* Merge-commit (`--no-ff`) — коміти гілки + один merge-коміт

## Decision Outcome
Chosen option: "squash-merge як рекомендований", because Spec B — цілісна логічна зміна, а проміжні TDD-коміти гілки не потрібні в `main`; CI-реліз агрегує по change-файлу, а не по окремих комітах.

### Consequences
* Good, because transcript фіксує очікувану користь: чистіша `main`-гісторія (один коміт = одна логічна фіча).
* Bad, because транзакційна TDD-гісторія гілки не зберігається в `main` — втрата деталей реалізації. Transcript не містить підтверджених негативних наслідків для поточного проєкту.

## More Information
Зафіксовано у `npm/rules/worktree/worktree.mdc`, секція «Завершення гілки worktree», коміт `41cc767`. Change-файл: `npm/.changes/1780218783124-a30f10.md`. Дзеркало `.cursor/rules/n-worktree.mdc` оновиться після наступного релізу пакета (sync бере з опублікованого `@nitra/cursor`, не з локального `npm/rules/`). Фактичний merge Spec B у поточній сесії відбувся через fast-forward (фонова сесія), а не squash — правило застосовуватиметься в майбутніх гілках.

---

## ADR Послідовне (не паралельне) виконання субагентів у спільному worktree

## Context and Problem Statement
При subagent-driven розробці перша спроба запустила всі субагенти одним паралельним блоком. Оскільки всі субагенти ділять один git worktree, вони б конфліктували між собою. Git і файлова система не підтримують конкурентний запис без координації.

## Considered Options
* Паралельний dispatch усіх субагентів одночасно
* Суворо послідовне виконання — один субагент → перевірка → наступний

## Decision Outcome
Chosen option: "суворо послідовне виконання", because субагенти ділять один worktree; паралельний dispatch викликав каскадне скасування (перший виконався, решта скасовано).

### Consequences
* Good, because transcript фіксує очікувану користь: ізоляція контексту кожного субагента, відсутність race conditions у git, можливість перевірки між задачами.
* Bad, because час виконання лінійно зростає з кількістю задач — паралельне прискорення недоступне для залежних задач у спільному worktree.

## More Information
Обмеження зафіксовано у skill `superpowers:subagent-driven-development`: «Dispatch multiple implementation subagents in parallel (conflicts)» — заборонено. Підтверджено практикою: cascade cancellation після паралельного dispatch 9 субагентів; реально виконався лише Task 1 (`616f832`). Решта 8 задач виконані суворо послідовно.
