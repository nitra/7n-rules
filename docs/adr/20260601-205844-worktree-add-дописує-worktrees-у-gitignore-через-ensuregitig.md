---
session: c984ee56-447e-46ac-9ece-9409fe55c979
captured: 2026-06-01T20:58:44+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-cursor/c984ee56-447e-46ac-9ece-9409fe55c979.jsonl
---

## ADR `worktree add` дописує `.worktrees/` у `.gitignore` через `ensureGitignoreEntries`

## Context and Problem Statement
`n-cursor worktree add` створює в корені репо директорію `.worktrees/<sanit>/` та сусідні артефакти (`.md`-опис, `.flow.json`, `.events.jsonl`, `.flow-lock-*`), але самостійно **не** гарантує їх ігнорування у git. У цьому репо рядок `.worktrees/` закомічено вручну, проте в новому або чужому репо всі ці файли вилізуть у `git status` як untracked і можуть випадково потрапити до коміту.

## Considered Options
* Інтегрувати виклик `ensureGitignoreEntries(repoRoot, ['.worktrees/'], …)` у `cmdAdd` у `worktree-cli.mjs`
* Залишити поточну поведінку (ручне додавання в `.gitignore`)

## Decision Outcome
Chosen option: "Інтегрувати `ensureGitignoreEntries` у `cmdAdd`", because принцип «хто створює — той і ігнорує»: саме команда `add` породжує артефакти, тому вона має гарантувати їх ігнорування; крім того, утиліта вже існує, є idempotent і append-only, тобто якщо рядок уже присутній — no-op без побічних ефектів.

### Consequences
* Good, because у будь-якому новому чи чужому репо `.worktrees/` буде автоматично ігноруватись одразу після першого `worktree add`, без ручних кроків.
* Bad, because `worktree add` отримує side-effect запис у `.gitignore` користувача поза «своїм» каталогом — хоча він і append-only, це мутація файлу, якого tool раніше не торкався.

## More Information
- Точка вмонтування: `worktree-cli.mjs` → `cmdAdd`, після `git worktree add .worktrees/<sanit>`, виклик `ensureGitignoreEntries(ctx.cwd, ['.worktrees/'], 'n-cursor worktree')`.
- Утиліта: `npm/scripts/utils/ensure-gitignore-entries.mjs` — idempotent append-only, з header-коментарем.
- `.claude/worktrees/` — окрема захищена директорія, яку `worktree add` не створює; до цього виклику не включати.
- Реалізація ведеться у worktree `.worktrees/feat-worktree-gitignore/` через `n-cursor flow` (flow-файл: `.worktrees/feat-worktree-gitignore.flow.json`).
- Spec-документ: `docs/specs/2026-06-01-worktree-add-gitignore.md` (status: spec, risk low).
