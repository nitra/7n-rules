---
session: 09dcb1bc-929b-4d88-90b0-c0611bed3d2f
captured: 2026-05-31T07:21:11+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/09dcb1bc-929b-4d88-90b0-c0611bed3d2f.jsonl
---

[assistant]
Using `writing-plans` to create the implementation plan.
---

The transcript ends here.

## ADR Кросплатформний CLI-інструмент `n-cursor worktree` замість харнес-специфічного `EnterWorktree`

## Context and Problem Statement

Anthropic-специфічний інструмент харнесу `EnterWorktree` завжди кладе worktree в `.claude/worktrees/` (захищена директорія за `cursor/CLAUDE.md`) і за замовчуванням гілкується від `origin/main`, що тихо губить локальні незапушені коміти. Крім того, він недоступний в Cursor та у звичайному терміналі, тому агент у різних середовищах поводився б по-різному. Потрібен єдиний інструмент, що працює ідентично в Claude Code, Cursor і терміналі.

## Considered Options

* Нативний `EnterWorktree` (Anthropic-специфічний harness tool)
* Ручний `git worktree add` у sibling-каталог (fallback без tool)
* Нова CLI-підкоманда `n-cursor worktree` (виконавець конвенції) + тонкий skill `n-worktree`

## Decision Outcome

Chosen option: "Нова CLI-підкоманда `n-cursor worktree` + тонкий skill `n-worktree`", because лише CLI є ідентичним у Claude Code, Cursor і терміналі без залежності від харнесу; логіка інвентарного `.md`-опису інкапсульована в tool, а не покладається на дисципліну агента.

### Decisions within chosen option

| Аспект | Рішення | Обґрунтування з transcript |
|---|---|---|
| Підкоманди | `add` + `remove` + `list` + `prune` (D3) | Повний набір обрано явно |
| Розташування worktree | `.worktrees/<sanitized>/` від кореня репо | Відповідно до конвенції `n-worktrees.mdc` |
| Санітизація гілки | Слеш → дефіс (`feat/skill-meta` → `feat-skill-meta`) | Зберігає пласку структуру `.worktrees/`, щоб `cat .worktrees/*.md` завжди знаходив описи |
| База гілки | Завжди від поточного HEAD (F1) | Уникає пастки `EnterWorktree` (дефолт від `origin` губить локальні коміти) |
| Інвентарний `.md` | Опис обовʼязковий; авто-поля: дата, base-commit, гілка, шлях, рядок «Прибрати» (G1) | Без опису інвентаризація безглузда |
| `remove` | Безпечний дефолт + опційний `--force` (H2) | Незворотні дії — лише за явним наміром |
| `prune` | Агресивний (H-prune-b): одразу прибирає осиротілі `.md` + `git worktree prune` | Явний вибір із двох варіантів; осиротілі `.md` — безпечно видаляти |
| Skill `n-worktree` | Тонкий (вказує агенту на CLI) + `meta.json` з `worktree: false` | YAGNI; сам worktree-tool не потребує ізоляції |
| `n-worktrees.mdc` | Ручний рецепт `git worktree add + вручну .md` замінити на виклики `n-cursor worktree …` | Єдине джерело істини — CLI |

### Consequences

* Good, because CLI-команда однакова в Claude Code, Cursor і терміналі — усуває головну проблему (`EnterWorktree` є лише в Claude Code harness).
* Good, because логіка інвентарного `.md` інкапсульована: агент не може "забути" формат або пропустити файл.
* Good, because `prune` (D3) прибирає розсинхрон між git-метаданими і `.md`-файлами — transcript фіксує очікувану користь.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information

- Spec: `docs/superpowers/specs/2026-05-31-worktree-cli-design.md` (коміт `c5ec0e9`)
- Конвенція: `.cursor/rules/n-worktrees.mdc`
- Заплановані файли: `npm/scripts/worktree-cli.mjs`, `npm/scripts/lib/worktree.mjs`, тести під `npm/scripts/lib/tests/` та `npm/scripts/tests/`, новий `case 'worktree'` у `npm/bin/n-cursor.js`
- Новий skill: `npm/skills/worktree/SKILL.md` + `meta.json` (`worktree: false`)
- Дублі spec (`2026-05-31-n-cursor-worktree-cli-design.md`, `2026-05-31-worktree-cli-skill-design.md`) видалені в коміті `417a0de`
