# CLI-інструмент `n-cursor worktree` для крос-платформної роботи з git-worktree

**Status:** Accepted
**Date:** 2026-05-31

## Context and Problem Statement

Anthropic-специфічний інструмент `EnterWorktree` захардкоджує шлях `.claude/worktrees/` і недоступний у Cursor IDE або терміналі. Конвенція `n-worktrees.mdc` описує правила вручну, але не гарантує однакову поведінку в різних LLM-середовищах. Потрібен єдиний інструмент: однаково доступний у Claude Code, Cursor і терміналі; реалізує конвенцію `.worktrees/`; атомарно створює інвентарний `.md`-файл без покладання на дисципліну агента.

## Considered Options

- `EnterWorktree` (нативний Anthropic-специфічний інструмент; захардкоджує `.claude/worktrees/`; недоступний у Cursor)
- Лише skill / markdown-правило (вже є `n-worktrees.mdc`, але залежить від дисципліни агента)
- Підкоманда CLI `n-cursor worktree` + тонкий skill (варіант C)

## Decision Outcome

Chosen option: "CLI-підкоманда + тонкий skill (варіант C)", because CLI-команда `npx @nitra/cursor worktree …` дає ідентичну поведінку в Claude, Cursor і терміналі без залежності від харнесу; тонкий skill лише направляє агента до CLI замість ручних кроків `git worktree add`. Логіка створення інвентарного файлу переноситься в CLI-tool, що виключає розбіжності через дисципліну агента.

### Consequences

- Good, because однакова поведінка у всіх LLM-середовищах; CLI атомарно виконує `git worktree add` + створює `.worktrees/<branch>.md` за конвенцією.
- Good, because `EnterWorktree` більше не потрібен; `.claude/worktrees/` залишається виключно для харнесу Anthropic.
- Bad, because харнес Claude Code не бачить worktree у `.worktrees/` і не керує ним; очищення — через `git worktree remove` або підкоманду `prune`.

## More Information

**Набір підкоманд (варіант D3):** `add <branch> <опис>`, `remove <branch>`, `list`, `prune`.
- `add` і `remove` — мутуючі операції (worktree + інвентарний `.md`).
- `list` — обʼєднує `git worktree list` з вмістом `.md`-описів у єдиний вивід.
- `prune` — прибирання «осиротілих» `.md`-файлів після видалення worktree, або навпаки.

**Конвенція `.worktrees/`:** `.worktrees/<branch>/` у корені репо, gitignored (`.worktrees/` у `.gitignore`). Інвентарний файл `.worktrees/<branch>.md` — поруч із checkout, не всередині; `cat .worktrees/*.md` дає огляд усіх активних worktree без рекурсивного пошуку. Заборона кластися в `.claude/worktrees/` і sibling-каталоги зафіксована в `n-worktrees.mdc`.

**Санітизація гілки (варіант E-slash-a):** слеш → дефіс для пласкої структури: `feat/skill-meta` → `.worktrees/feat-skill-meta/` + `.worktrees/feat-skill-meta.md`. Зберігає `cat .worktrees/*.md` робочим без рекурсії. Функція `sanitizeBranch` у `npm/scripts/lib/worktree.mjs`.

**База при `add` (варіант F1):** завжди від поточного HEAD (без `--from <ref>`); вирішує проблему `EnterWorktree`, де локальні коміти губились через гілкування від `origin/<default>`. Флаг `--from` відкладено як YAGNI.

**Опис worktree (варіант G1):** обовʼязковий позиційний аргумент; без нього команда завершується з exit 1. Решта полів (дата, база SHA, шлях) заповнюються автоматично. Обовʼязковість гарантує, що `list` завжди показує змістовний опис кожного worktree.

Spec: `docs/superpowers/specs/2026-05-31-n-cursor-worktree-cli-design.md` (коміт `bf1842f`). Реалізація: `npm/scripts/lib/worktree.mjs` + `case 'worktree'` у `npm/bin/n-cursor.js` + `.cursor/skills/n-worktree/SKILL.md`. Заборона `.claude/worktrees/` для ручних змін зафіксована в `cursor/CLAUDE.md`.
