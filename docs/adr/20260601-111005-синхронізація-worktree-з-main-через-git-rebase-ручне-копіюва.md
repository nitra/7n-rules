---
session: beb8b049-be24-4771-bf14-8f37df4e65d6
captured: 2026-06-01T11:10:05+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-cursor/beb8b049-be24-4771-bf14-8f37df4e65d6.jsonl
---

## ADR Синхронізація worktree з main через git rebase + ручне копіювання файлів

## Context and Problem Statement
Скіл `/n-fix` виконується виключно в окремому git-worktree (`main-fix`). Після завершення роботи треба перенести зміни в основну гілку `main`. При спробі `git rebase main` виник конфлікт у `npm/scripts/lib/worktree-notice.mjs`, бо `main` містив коміт `worktree2` (паралельно просунутий), що зробило автоматичне перенесення неможливим.

## Considered Options
* `git rebase main` у гілці `main-fix` → потім `git merge main-fix` у `main`
* Ручне копіювання цільових файлів із worktree в основний worktree + `git stash` / `git pull --ff-only` / `git stash pop`

## Decision Outcome
Chosen option: "Ручне копіювання файлів + stash/pull", because `git rebase main` в worktree завершився конфліктом (`CONFLICT` у `npm/scripts/lib/worktree-notice.mjs`); rebase було скасовано (`git rebase --abort`), а конкретні файли (`.oxlintrc.json`, change-файли) скопійовано вручну в основне дерево, де `git stash push -u` + `git pull --ff-only origin main` + `git stash pop` синхронізував з `origin/main` без конфлікту.

### Consequences
* Good, because transcript фіксує очікувану користь: після stash/pull/pop основний worktree чистий, `npx @nitra/cursor fix` пройшов усі правила.
* Bad, because ручне копіювання файлів залишає зміни незакоміченими в основному дереві — користувач мусить самостійно вирішити, що закомітити; сесія завершилась без автоматизованого рішення для цього кроку (user прямо запитав про таку команду).

## More Information
- Команди: `git rebase origin/main` (у `main-fix`), `git rebase --abort`, `cp .worktrees/main-fix/.oxlintrc.json .oxlintrc.json`, `git stash push -u -m "n-fix structural changes"`, `git pull --ff-only origin main`, `git stash pop`
- Конфліктний файл: `npm/scripts/lib/worktree-notice.mjs`
- Причина конфлікту: `main` містив коміт `bfdde36 worktree2`, якого не було в `main-fix` (worktree створювався від `a288edc`)
- User-запит наприкінці: «хочу щоб у нас була команда яка після того як ми попрацювали у ворктрі, забираємо свіжі зміни з поточною гілки… і потім перенесення файлів в основну гілку» — залишився відкритим, рішення в transcript не зафіксовано

---

## ADR Додавання e18e/* deny-правил і розширення ignorePatterns у .oxlintrc.json

## Context and Problem Statement
`npx @nitra/cursor fix js-lint` перевіряв відповідність `.oxlintrc.json` канону `@nitra/cursor` (правило `n-js-lint.mdc`). Поточний файл не містив правил `e18e/*` і мав неповний список `ignorePatterns`, що порушувало канон.

## Considered Options
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Додати e18e/* deny-правила і розширити ignorePatterns", because `npx @nitra/cursor fix js-lint` підтвердив ✅ після правок, а перевірка канону `@nitra/cursor` вимагає цих записів.

### Consequences
* Good, because `npx @nitra/cursor fix js-lint` пройшов без `❌` після змін.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- Файл: `.oxlintrc.json` у корені репо та `.worktrees/main-fix/.oxlintrc.json`
- Додані правила: `"e18e/prefer-array-fill": "deny"`, `"e18e/prefer-array-to-reversed": "deny"` та ін. (13 правил `e18e/*`)
- Розширено `ignorePatterns`: `"npm/types/**"`, `"demo/node/rules-demo.js"`
- Change-файл: `npm/.changes/1780300299314-c5d303.md` (bump: patch, section: Changed)

---

## ADR Видалення застарілих Stryker-sandbox директорій для усунення хибно-позитивних порушень fix-test

## Context and Problem Statement
`npx @nitra/cursor fix test` фіксував 31 `❌` через знаходження `process.chdir(` у тест-файлах під `npm/reports/stryker/.tmp/sandbox-*`. Ці директорії є тимчасовими артефактами Stryker (вказані в `.gitignore`) і не є частиною репозиторію, але правило `no-process-chdir` сканувало їх.

## Considered Options
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Видалити стані sandbox-директорії (`rm -rf npm/reports/stryker/.tmp/sandbox-*`)", because після видалення `npx @nitra/cursor fix` пройшов `fix-test` без `❌`; директорії були залишками попереднього запуску Stryker і не повинні скануватися.

### Consequences
* Good, because transcript фіксує очікувану користь: `fix-test` ✅ після очищення.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- Команда: `rm -rf npm/reports/stryker/.tmp/sandbox-*`
- Директорії: `npm/reports/stryker/.tmp/sandbox-FR4ess`, `sandbox-ZI7BqU`, `sandbox-uXrVRj`
- `.gitignore` рядки: `**/.stryker-tmp/`, `**/reports/stryker/.tmp/`
- Правило, що сканує: `npm/rules/test/js/no-process-chdir.mjs`
