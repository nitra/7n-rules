---
type: ADR
title: "Жорсткий fail-fast preflight для worktree-only skills"
---

# Жорсткий fail-fast preflight для worktree-only skills

**Status:** Accepted
**Date:** 2026-06-01

## Context and Problem Statement

Скіли з `"worktree": true` (`n-fix`, `n-coverage-fix`, `n-fix-tests`, `n-taze`, `n-adr-normalize`) вшивали в `SKILL.md` лише прозовий банер-пораду. Агент двічі трактував його як рекомендацію і запускав скіл у основному дереві. Помилка системна.

## Considered Options

* Жорсткіший текст у SKILL.md з явним STOP/ABORT і runnable preflight-командою
* PreToolUse/Stop-хук у `.claude/settings.json`
* Правило в CLAUDE.md (додатковий текстовий шар)

## Decision Outcome

Chosen option: "Жорсткіший текст у SKILL.md з явним STOP/ABORT і runnable preflight" (основний) + "Правило в CLAUDE.md" (додатковий шар), because PreToolUse-хук бачить session cwd (корінь), а не bash-cwd агента після `cd .worktrees/...`, тому блокував би навіть коректний запуск.

### Consequences

* Good, because агент отримує Крок 0 preflight, що завершується `exit 1` з `ABORT` — без можливості «прочитати й проігнорувати».
* Good, because зміна централізована в `worktree-notice.mjs` → всі 5 скілів синхронно.
* Bad, because гейт спрацьовує лише якщо агент виконує Крок 0 як bash-команду, а не читає SKILL.md як документацію.

## More Information

- `npm/scripts/lib/worktree-notice.mjs` — `NOTICE_BODY`: `[!IMPORTANT]` callout + Крок 0 (`git rev-parse --show-toplevel | grep -q '/\.worktrees/' || { echo "ABORT"; exit 1; }`)
- Оновлено: `.cursor/skills/n-fix/SKILL.md`, `n-coverage-fix`, `n-fix-tests`, `n-taze`, `n-adr-normalize`
- `npm/bin/n-cursor.js` — `buildClaudeWorktreeEnforcementSectionLines()` + вставка після «Лінт і ESLint» у генераторі CLAUDE.md
- Тести: `worktree-notice.test.mjs` + `generated-markdown.test.mjs` → 11/11
- Change-файл: `npm/.changes/1780285755419-9af9c4.md` (minor / Changed)

## Update 2026-06-04

Підтверджено на практиці для `n-fix`: виклик `/n-fix` у основному дереві (`main`, `/Users/vitaliytv/www/nitra/cursor`) — preflight автоматично створив worktree `main-fix` командою `npx @nitra/cursor worktree add "main-fix" "n-fix: worktree-only skill"`, встановив залежності (`bun install`, 875 пакетів) і запустив `npx @nitra/cursor fix`. Результат: exit=0, 19 успішних перевірок, `git status --short` порожній.
