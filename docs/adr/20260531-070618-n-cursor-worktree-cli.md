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

## Update 2026-05-31

Деталі семантики `worktree add`: санітизація `/`→`-` (E-slash-a) зберігає пласку структуру `.worktrees/`, `cat .worktrees/*.md` без рекурсії. База нового worktree — завжди поточний HEAD (F1); усуває пастку `EnterWorktree`, де дефолт від `origin/main` тихо губив локальні коміти. Опис — обовʼязковий позиційний аргумент (G1): без нього `worktree add` падає з підказкою, інвентаризація беззмістовна. Spec-посилання: `docs/superpowers/specs/2026-05-31-worktree-cli-skill-design.md` (коміт `5002c94`), конвенція `n-worktrees.mdc` (коміт `1838e44`).

## Update 2026-05-31

Консолідована таблиця суб-рішень дизайну: D3 (`add/remove/list/prune`); E-slash-a (слеш→дефіс для пласкої структури); F1 (база від HEAD); G1 (опис обовʼязковий); H2 (`remove` безпечний дефолт + `--force`); H-prune-b (`prune` агресивний). Spec: `docs/superpowers/specs/2026-05-31-worktree-cli-design.md` (коміт `c5ec0e9`). Дублі spec (`2026-05-31-n-cursor-worktree-cli-design.md`, `2026-05-31-worktree-cli-skill-design.md`) видалені в коміті `417a0de`.

## Update 2026-05-31

Додаткове рішення: для worktree-конвенції потрібен лише **rule** (pure-doc), без окремого skill. Аргумент: `n-cursor worktree add` — одна команда без складного покрокового сценарію (на відміну від `n-fix`); окремий skill і rule говорили б ідентичне. Нормалізація сироти `n-worktrees.mdc`: перенести у `npm/rules/worktree/worktree.mdc` як канонічне джерело пакету, перейменувати на `n-worktree.mdc` через sync. Spec: `docs/superpowers/specs/2026-05-31-worktree-cli-design.md` (коміт `398e836`), план `docs/superpowers/plans/2026-05-31-worktree-cli.md` (коміт `3bb5547`).

## Update 2026-05-31

Інвентарний файл: `.worktrees/<b>.md` **поруч** із checkout (не всередині worktree-каталогу) — забезпечує `cat .worktrees/*.md` без рекурсії. Авто-поля, які генерує CLI: дата (`new Date().toISOString().slice(0,10)`), база-коміт (`git rev-parse --short HEAD`), гілка, шлях, рядок «Прибрати: `npx @nitra/cursor worktree remove <branch>`». Прапорець `--from <ref>` визначено поза скопом (YAGNI).

## Update 2026-05-31

Підтвердження реалізації: `npm/scripts/worktree-cli.mjs` (оркестратор), `npm/scripts/lib/worktree.mjs` (чиста логіка: `sanitizeBranch`, `worktreePaths`, `buildDescription`, `findOrphanDescFiles`), тести `npm/scripts/lib/tests/worktree.test.mjs` (9 юніт-тестів), `npm/scripts/tests/worktree-cli.test.mjs` (6 тестів). Skill: `npm/skills/worktree/SKILL.md` + `meta.json` з `{ "worktree": false }`. Нормалізація правила (J1 pure-doc): `npm/rules/worktree/worktree.mdc` — канонічне джерело; сирота `.cursor/rules/n-worktrees.mdc` видалена; sync генерує `.cursor/rules/n-worktree.mdc`. `worktree` додано до `.n-cursor.json` rules. `CLAUDE.md` посилається на `@.cursor/rules/n-worktree.mdc`. Коміти: `f0c3e6c` (видалення сироти), `d443126` (sync).

## Update 2026-05-31

Фінальна реалізація зрелізована в `@nitra/cursor@1.38.0` (коміт `b4d50d6`). Підтверджено всі суб-рішення: D3, E-slash-a, F1, G1, H2, H-prune-b, J1. Нова дискусія наприкінці сесії: поле `auto` у `meta.json` правил перейменувати на `suggest` — точніше відображає семантику («запропонувати при sync», не «завжди виконувати перевірку»). Рішення прийнято, реалізація відкладена (потребує оновлення всіх `meta.json` скілів та парсера `auto-skills.mjs`).
