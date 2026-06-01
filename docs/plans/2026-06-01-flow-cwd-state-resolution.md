---
kind: nitra-plan
spec: ../specs/2026-06-01-flow-cwd-state-resolution.md
flow: ../../.worktrees/flow-cwd-state-resolution.flow.json
status: draft
---

# План: cwd-незалежний резолвинг стану flow

Дата: 2026-06-01
Spec: [2026-06-01-flow-cwd-state-resolution](../specs/2026-06-01-flow-cwd-state-resolution.md)

## Кроки

1. Написати падаючі тести для `resolveActiveFlowState` (git+FS ін'єкція): toplevel-у-worktree,
   single-active-авторезолв, multi-active-throw-зі-списком, zero-throw, `--branch`-override, підтека worktree —
   acceptance: тести існують і падають (функції ще нема).
2. Реалізувати `resolveActiveFlowState({ cwd, branch }, deps)` у dispatcher-lib з ін'єкованим git-доступом —
   acceptance: усі кейси кроку 1 зелені; `flowStatePath` лишається незмінним.
3. Замінити `flowStatePath(cwd)` на резолвер у call-sites `spec/plan/verify/review/gate/release`; `init` не чіпати —
   acceptance: команди беруть стан через резолвер; grep `flowStatePath(cwd)` у цих командах порожній.
4. Прокинути опційний `--branch <b>` у CLI-dispatcher для цих підкоманд —
   acceptance: `flow verify --branch <b>` резолвить стан зазначеної гілки.
5. Покласти change-файл (`--ws npm`) і прогнати локальні тести/lint —
   acceptance: `bun test` змінених модулів зелений; eslint змінених файлів exit 0; change-файл у `npm/.changes/`.
