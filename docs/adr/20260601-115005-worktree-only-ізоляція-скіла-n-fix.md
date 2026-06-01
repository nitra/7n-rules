---
session: c93a5a0c-e04e-4d72-a279-6d253229dc5c
captured: 2026-06-01T11:50:05+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-cursor/c93a5a0c-e04e-4d72-a279-6d253229dc5c.jsonl
---

## ADR Worktree-only ізоляція скіла n-fix

## Context and Problem Statement
Скіл `/n-fix` виконує проєктоширокі виправлення. Щоб уникнути забруднення основного робочого дерева, правило `SKILL.md` вимагає запуску виключно в окремому git-worktree. У сесії `git rev-parse --show-toplevel` повернув `/Users/vitalii/www/nitra/cursor` (основний репо), тому скіл зупинився та ініціював preflight.

## Considered Options
* Виконати n-fix безпосередньо в основному дереві
* Створити / використати існуючий git-worktree `.worktrees/main-fix/` і продовжити там

## Decision Outcome
Chosen option: "Використати існуючий git-worktree `.worktrees/main-fix/`", because `SKILL.md` містить явну блокуючу директиву: якщо `git rev-parse --show-toplevel` не вказує під `.worktrees/`, — STOP та створити worktree за конвенцією `<current-branch>-fix`. Worktree вже існував (`git worktree list` підтвердив), тому агент перейшов у нього.

### Consequences
* Good, because зміни ізольовані від основного дерева і не ламають незакінчену роботу в `main`.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- Preflight-команда: `git rev-parse --show-toplevel && git branch --show-current`
- Worktree-список: `git worktree list`
- Конвенція шляху: `.worktrees/<current-branch>-fix/`
- Інвентарний файл: `.worktrees/main-fix.md`
- Правило: `CLAUDE.md` → секція «Worktree-only skills (`meta.json` → `worktree: true`)»

---

## ADR Заборона ручного bump версії при розходженні local vs npm registry

## Context and Problem Statement
`npx @nitra/cursor fix changelog` виявив, що `npm/package.json` має версію `3.2.0`, тоді як опублікована в npm-реєстрі — `3.2.3`. Агент спробував виправити вручну (bump → `3.2.3`), потім підтягнути `main` (де версія `3.2.2`), але отримав merge-конфлікти.

## Considered Options
* Ручний bump `npm/package.json` до `3.2.3` (збіг із registry)
* Влити `main` (де `3.2.2`) в `main-fix` для усунення drift
* Відкотити ручну зміну і залишити `3.2.0` (стан до сесії)
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Відкотити ручну зміну і залишити `3.2.0`", because правило `n-changelog.mdc` прямо забороняє ручний bump: «Локальна `version` ≠ опублікованій (npm / PyPI): drift поза CI → **fail** (ручний bump заборонений)». Спроба merge `main` була скасована через конфлікти в `npm/scripts/dispatcher/lib/commands.mjs` — розв'язання конфліктів виходило за межі скопу `/n-fix`.

### Consequences
* Good, because дотримано правило `n-changelog.mdc`; репо залишилося в чистому стані (`nothing to commit, working tree clean`).
* Bad, because версія в `npm/package.json` (`3.2.0`) і надалі розходиться з опублікованою (`3.2.3`), а `fix changelog` повертатиме `❌` до повноцінного release-flow через CI.

## More Information
- Правило: `.cursor/rules/n-changelog.mdc` → підсекція «registry-published (npm / PyPI)»
- Файли змін: `npm/.changes/1780300299314-c5d303.md` (bump: patch, js-lint e18e правила)
- Конфліктний файл при merge: `npm/scripts/dispatcher/lib/commands.mjs`
- Команди: `git merge main --no-edit`, `git merge --abort`
