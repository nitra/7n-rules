---
session: beb8b049-be24-4771-bf14-8f37df4e65d6
captured: 2026-06-01T10:54:27+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-cursor/beb8b049-be24-4771-bf14-8f37df4e65d6.jsonl
---

## ADR Rebase `main-fix` на `origin/main` для усунення розбіжності версій

## Context and Problem Statement
Гілка `main-fix` розійшлася з `origin/main`, де CI вже виконав реліз `@nitra/cursor@3.2.0`. Локальний `npm/package.json` мав `version: 3.1.0`, тоді як `npm view @nitra/cursor version` повертав `3.2.0`. Правило `changelog` блокувало виконання `npx @nitra/cursor fix`.

## Considered Options
* Rebase `main-fix` на `origin/main`
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Rebase `main-fix` на `origin/main`", because це дозволило отримати реліз-коміт `98fc6dd` (що містить `npm/package.json: 3.2.0`) без ручного правлення `version`, яке заборонено правилом `n-changelog.mdc`.

### Consequences
* Good, because transcript фіксує очікувану користь: після rebase `changelog`-перевірка перейшла у `✅ npm: @nitra/cursor@3.2.0 збігається з реєстром`.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- Команда: `git rebase origin/main` з директорії `.worktrees/main-fix`
- Перевірка: `npm view @nitra/cursor version` → `3.2.0`
- Правило, що забороняє ручний bump: `npm/rules/changelog/js/consistency.mjs:371`

---

## ADR Розширення `.oxlintrc.json` правилами `e18e/*` та канонічними `ignorePatterns`

## Context and Problem Statement
Правило `js-lint` перевіряє, чи `.oxlintrc.json` збігається з каноном `oxlint (@nitra/cursor)`. У поточному стані файл не містив `deny`-правил `e18e/*` та канонічних `ignorePatterns` для `npm/types/**` і `demo/`.

## Considered Options
* Додати `e18e/prefer-array-fill: "deny"`, `e18e/prefer-array-to-reversed: "deny"` та розширені `ignorePatterns`
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Додати `e18e/*` deny-правила та канонічні `ignorePatterns` у `.oxlintrc.json`", because це вимагала перевірка `npx @nitra/cursor fix js-lint` (правило порівнює файл із каноном пакету).

### Consequences
* Good, because transcript фіксує очікувану користь: після змін `fix js-lint` повернув `✅ .oxlintrc.json збігається з каноном oxlint (@nitra/cursor)`.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- Змінений файл: `.oxlintrc.json`
- Change-файл для npm: `npm/.changes/1780300299314-c5d303.md` (bump: patch, section: Changed)
- Команда перевірки: `npx @nitra/cursor fix js-lint`
