---
session: 09dcb1bc-929b-4d88-90b0-c0611bed3d2f
captured: 2026-05-31T18:08:31+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/09dcb1bc-929b-4d88-90b0-c0611bed3d2f.jsonl
---

## ADR Критерії lifecycle-рішень для git-worktree (keep vs discard)

## Context and Problem Statement
Сесія накопичила 6 git-worktree різного ступеня актуальності. Потрібно було вирішити, які видалити, а які лишити, не втративши ніякої незбереженої роботи. Два критерії конфліктували: "worktree займає місце і гілка застаріла" vs "незакомічена або незмерджена робота може бути втрачена".

## Considered Options
* Видалити всі worktree (крім main-checkout)
* Лишити всі worktree без змін
* Ітеративно аналізувати кожен worktree: `diff main`, статус uncommitted, merged flag — і приймати рішення окремо

## Decision Outcome
Chosen option: "Ітеративний аналіз кожного worktree", because це дозволяє виявити точну причину "застарілості" (merged + uncommitted = stale state vs unique new work) перед деструктивною операцією.

Встановлено конкретні критерії:
- **DISCARD**: гілка merged або вміст вже в main; uncommitted зміни = ідентичний стан у кількох worktree (shared drift, superseded main'ом); merge призвів би до регресу.
- **KEEP**: worktree містить унікальну незбережену роботу (uncommitted або non-merged коміти), якої немає ні в main, ні на origin.

### Consequences
* Good, because transcript фіксує очікувану користь: `cursor-ci-bump` і `feat-skill-meta` видалено без втрат (committed-робота вже в main); `keen-swanson-f7dff6` лишено без втрати унікального spec.
* Bad, because ітеративний розбір вимагає значного часу (кожен worktree: `git rev-list`, `git diff --stat`, порівняння mtime); при великій кількості worktree процес масштабується погано.

## More Information
Команди, що використовувались для аналізу кожного worktree:
```bash
git rev-list --left-right --count origin/main...<branch>  # ahead/behind
git log --format='%h %s' origin/main..<branch> | grep -viE 'release:|^adr$'  # uniq commits
git diff --name-only --diff-filter=A main <worktree-HEAD>  # added files
git -C <worktree> diff --name-only -- ':!docs/adr'  # uncommitted (excl adr noise)
```
Discarded worktrees: `cursor-ci-bump` (was `feat/ci-only-version-bump-2`), `feat-skill-meta` (was `feat/skill-meta-json-worktree`). Kept: `keen-swanson-f7dff6`, `coverage-fix`, `n-coverage-fix`, `stryker-incremental`.

---

## ADR Збереження worktree з унікальним незбереженим design-spec

## Context and Problem Statement
Worktree `keen-swanson-f7dff6` (гілка `claude/keen-swanson-f7dff6`) містив застарілий код (відсутній lint-split, повертає `run-lint-cli.mjs` — регрес), але єдиний унікальний артефакт — 356-рядковий design-spec `docs/specs/2026-05-31-n-cursor-lifecycle-composition-design.md` — існував тільки в коміті `ad98ac8` цього worktree і не був присутній ні в main, ні на origin, ні на жодній remote-гілці.

## Considered Options
* (A) Cherry-pick лише docs у main, тоді discard worktree + гілку
* (B) Повний discard — втратити і код (прийнятно), і spec (безповоротна втрата)
* (C) Лишити worktree як є (без змін, без merge)

## Decision Outcome
Chosen option: "(C) Лишити worktree як є", because user відповів "цей ворктрі залишаємо і рухаємось до наступного ворктрі" після підтвердження, що spec не реалізований ніде в main.

### Consequences
* Good, because 356-рядковий design-spec (`n-cursor flow — Суверенний Stateful AI-Orchestrator`) не втрачено; він описує майбутню архітектуру (5-фазний двигун, capability-router, fault-tolerant `.flow.json`, trace/verify), яка ще не реалізована.
* Bad, because worktree лишається на застарілій базі (HEAD `e43382b`, немає lint-split та інших фіч 1.38–1.40); merge неможливий без регресу — spec доведеться переносити вручну або cherry-pick'ом в майбутньому.

## More Information
Перевірені артефакти spec у main (всі відсутні):
```bash
grep "case 'flow'" npm/bin/n-cursor.js   # → 0
grep "case 'trace'" npm/bin/n-cursor.js  # → 0
ls npm/scripts/dispatcher/               # → not found
git cat-file -e main:docs/specs/2026-05-31-n-cursor-lifecycle-composition-design.md  # → NO
```
Spec описує: 5-phase AI-orchestrator engine, capability-router, `.flow.json` state-store, `n-cursor flow/trace/verify` CLI commands. Worktree path: `.claude/worktrees/keen-swanson-f7dff6` (захищена директорія згідно `cursor/CLAUDE.md`).

---

## ADR Виявлення "shared drift" як ознаки безпечного discard uncommitted-змін

## Context and Problem Statement
Три worktree (`feat/coverage-fix`, `fix/stryker-incremental`, `feat/demo`) містили по 21–30 файлів із uncommitted-змінами (581, ~128, ~107 рядків відповідно). Перший погляд давав враження живої незбереженої роботи. Потрібно було визначити, чи є ці зміни унікальною роботою чи артефактом старого спільного base-стану.

## Considered Options
* Вважати всі uncommitted-зміни "живою роботою" і лишати всі worktree
* Перевірити вміст незакомічених файлів на ідентичність між worktree і порівняти з main

## Decision Outcome
Chosen option: "Перевірити ідентичність між worktree та порівняти з main", because порівняння `git show main:<file>` з `diff -q <wt1-file> <wt2-file>` показало: uncommitted-файли ідентичні між усіма трьома worktree (наприклад `npm/scripts/utils/resolve-js-root.mjs`, `npm/rules/changelog/js/consistency.mjs`) і є **старішими** за main-версії (main вже має нові функції яких в worktree нема). Це означає "shared drift": три worktree замерзли на одному спільному старому стані, який main уже переписав новішим.

### Consequences
* Good, because transcript фіксує очікувану користь: можна безпечно ідентифікувати uncommitted-зміни як stale-артефакти (не нову роботу) і дати чітку рекомендацію discard без ризику втрати.
* Bad, because transcript не містить підтверджених негативних наслідків; утім, захист `.claude/worktrees/` у `cursor/CLAUDE.md` блокував автономне видалення — рішення user'а залишилось pending на кінець сесії.

## More Information
Команда для виявлення shared drift:
```bash
diff -q <wt1-path>/<file> <wt2-path>/<file>  # IDENT → не унікальна робота
diff -q <wt-path>/<file> <(git show main:<file>)  # wt-версія старіша
```
Результат: `coverage-fix` SAME=8 DIFFER=30; `stryker-incremental` SAME=8 DIFFER=21; `n-coverage-fix` SAME=8 DIFFER=22. Усі три "differ"-файли mtime = 26.05.2026 ~22:00 (4+ дні до дати сесії). Untracked у `n-coverage-fix`: лише `npm/demo/` (порожній demo-каталог) + `npm/skills/n-coverage-fix/auto.md` (10 байт legacy-файл).
