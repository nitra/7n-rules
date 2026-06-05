---
kind: nitra-spec
status: draft
adr: null
plan: ../plans/2026-06-01-flow-cwd-state-resolution.md
risk: low
---

# cwd-незалежний резолвинг стану flow — дизайн

Дата: 2026-06-01
Власник: @vitaliytv
Статус: Draft (очікує апруву)
Беклог: [flow-adaptation-backlog #1](../plans/2026-06-01-flow-adaptation-backlog.md)

## Проблема

Команди `flow spec/plan/verify/review/gate/release` обчислюють шлях стану як
`flowStatePath(cwd)` — припускаючи, що `cwd` дорівнює теці worktree
(`.worktrees/<branch>`). Якщо команду запущено з головного дерева (або з підтеки
worktree), шлях обчислюється хибно → «стану нема — спершу `flow init`», хоча flow
активний. Підтверджено на практиці: shell-сесії, що скидають cwd у корінь репо,
ловлять цю помилку повторно. `git rev-parse --show-toplevel` сам по собі не рятує:
з головного дерева він повертає корінь main, а flow-гілка зачекаутена у worktree.

## Рішення (Q1=A): багаторівневий резолвер

Новий резолвер `resolveActiveFlowState({ cwd, branch })` повертає `{ statePath, worktreeDir, label }`
або кидає помилку з actionable-повідомленням. Порядок:

1. **`--branch <b>` (явний)** — завжди перемагає. Шлях:
   `<repoRoot>/.worktrees/<sanitized-b>.flow.json` (через `git rev-parse --git-common-dir` → `dirname` = `<repoRoot>`).
2. **toplevel-резолвинг** — `git rev-parse --show-toplevel` від `cwd`. Якщо toplevel
   лежить під `<repoRoot>/.worktrees/` і для нього існує `flowStatePath(toplevel)` →
   беремо його (працює з будь-якої підтеки worktree).
3. **скан активних flow** — інакше перебираємо `<repoRoot>/.worktrees/*.flow.json`
   зі `status: in_progress`:
   - рівно **один** → беремо його + інфо-лог «авторезолвлено flow `<label>` (cwd поза worktree)»;
   - **кілька** → fail зі списком активних flow + підказка «`cd <worktree>` або `--branch <b>`»;
   - **нуль** → звичне «стану нема — спершу `flow init`».

`git`-виклики — через `execFileSync` (без shell), всі шляхи абсолютні
(`no-relative-fs-path`). Резолвер не пише на диск.

## Зміни секціями

### A. `state-store.mjs` (або новий `flow-resolve.mjs`)

- Додати `resolveActiveFlowState({ cwd, branch, ... })` з логікою вище.
- Лишити чистий `flowStatePath(worktreeDir)` без змін (його використовує `init`, що
  ЗНАЄ свою теку worktree — там резолвер не потрібен).
- Git-доступ ін'єктований (як у `consistency.mjs`/`trace`) → тестується без диска.

### B. Командні call-sites (`commands.mjs`, `plan.mjs`, `gate.mjs`, `review.mjs`, `active.mjs`)

- Замінити `flowStatePath(cwd)` на `resolveActiveFlowState({ cwd, branch })` у
  `spec`/`plan`/`verify`/`review`/`gate`/`release`.
- `init` НЕ чіпати (він створює worktree і знає теку).

### C. CLI-парсинг `--branch`

- Прокинути `--branch <b>` у dispatcher для перелічених підкоманд (опційний).

### D. Повідомлення

- Інфо-лог при авторезолві single-active.
- Fail-список при multi-active: рядок на кожен активний flow (`<branch> [<status>]`)
  - підказка.

## Тести

- `resolveActiveFlowState` (FS+git ін'єкція): (1) toplevel у worktree; (2) toplevel
  поза worktree + один активний → авторезолв; (3) кілька активних → throw зі списком;
  (4) нуль → throw «стану нема»; (5) `--branch` override; (6) підтека worktree.
- Sanity: команди з head-tree знаходять стан (інтеграційно, якщо дешево).

## Не-цілі

- Не міняємо локацію/формат `.flow.json` (sibling-файл лишається).
- Не чіпаємо `init`.
- Не вводимо персистентний «активний flow» pointer — резолв обчислюваний.

## Як перевірити

- `bun test` у `npm/` зелений; нові кейси резолвера проходять.
- Запуск `flow verify` з кореня репо (cwd = head tree) при одному активному flow →
  знаходить стан, не «стану нема».
- Кілька активних worktree → `flow verify` з кореня дає список + підказку.

## Ризики

Low. Адитивний резолвер + заміна call-sites; запуск із кореня worktree працює як
раніше (рівень 2 резолвера). Зворотна сумісність повідомлень CLI не критична.
