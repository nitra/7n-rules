---
session: 09dcb1bc-929b-4d88-90b0-c0611bed3d2f
captured: 2026-05-31T07:07:10+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/09dcb1bc-929b-4d88-90b0-c0611bed3d2f.jsonl
---

## ADR Worktree-інструмент: CLI + skill замість LLM-специфічного EnterWorktree

## Context and Problem Statement
`EnterWorktree` — вбудований інструмент харнесу Claude Code — кладе worktree в `.claude/worktrees/` (захищена директорія проєкту) і за замовчуванням гілкується від `origin/<default>`, тихо гублячи локальні незапушені коміти. У Cursor аналогічного нативного інструмента немає, тому поведінка агентів при ізоляції роботи різниться між IDE.

## Considered Options
* LLM-специфічний `EnterWorktree` (лише Claude Code)
* Тонкий skill `n-worktree` без CLI (агент виконує git вручну за markdown-інструкцією)
* CLI-команда `n-cursor worktree` (виконавець) + тонкий skill `n-worktree` (інструкція агенту)

## Decision Outcome
Chosen option: "CLI-команда `n-cursor worktree` + тонкий skill `n-worktree`", because це єдиний варіант, що дає ідентичну поведінку в Claude Code і Cursor без залежності від харнус-специфічних інструментів; CLI-процес детерміновано виконує конвенцію `n-worktrees.mdc`, не покладаючись на дисциплін агента.

### Consequences
* Good, because `npx @nitra/cursor worktree add|remove|list|prune` однаково доступна в Claude Code, Cursor, терміналі — поведінка не залежить від того, який LLM-агент виконує задачу.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Spec: `docs/superpowers/specs/2026-05-31-worktree-cli-skill-design.md` (коміт `5002c94`). Конвенція розміщення: `n-worktrees.mdc` (коміт `1838e44`). Реалізація: `npm/scripts/lib/worktree-cli.mjs` (новий файл), `case 'worktree'` у `npm/bin/n-cursor.js`.

---

## ADR Семантика `n-cursor worktree add`: санітизація, база, обовʼязковий опис

## Context and Problem Statement
При додаванні git-worktree через CLI потрібно вирішити три незалежні питання: (1) як відображати git-гілки зі слешем у файловій системі зберігаючи пласку структуру `.worktrees/`; (2) від якого коміту гілкуватись (HEAD чи remote); (3) чи робити текстовий опис worktree обовʼязковим.

## Considered Options
* Санітизація: зберігати слеш у шляху (`.worktrees/feat/branch/`) з рекурсивним пошуком `.md`
* Санітизація: замінювати `/` → `-` (пласка структура `.worktrees/feat-branch.md`)
* База: завжди HEAD; або дефолт HEAD + `--from <ref>`; або дефолт від `origin/<default>`
* Опис: обовʼязковий аргумент; або опційний з плейсхолдером у `.md`

## Decision Outcome
Chosen option: "санітизація `/`→`-` + база HEAD + опис обовʼязковий", because санітизація зберігає пласку структуру і дозволяє `cat .worktrees/*.md` (конвенція `n-worktrees.mdc`) без рекурсивного glob; HEAD уникає тихої втрати локальних незапушених комітів (саме та пастка `EnterWorktree`); обовʼязковий опис гарантує осмисленість `list`-інвентаризації — без нього вся мета inventory-файлу втрачається.

### Consequences
* Good, because transcript фіксує очікувану користь: `n-cursor worktree list` завжди виводить осмислений опис для кожного активного worktree; `cat .worktrees/*.md` з конвенції гарантовано знаходить усі описи без рекурсії.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Шаблон `.md`-файлу (поля `Задача`, `Дата`, `База`, `Шлях`, `Прибрати`) зафіксовано у `docs/superpowers/specs/2026-05-31-worktree-cli-skill-design.md`. Дата береться через `new Date().toISOString().slice(0,10)` (CLI-процес, не workflow). Флаг `--from <ref>` визначено поза скопом (YAGNI) для можливого майбутнього додавання.
