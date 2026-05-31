# Дизайн: кросплатформний worktree-tool `n-cursor worktree`

**Date:** 2026-05-31
**Status:** Узгоджено (brainstorming)
**Scope:** нова CLI-підкоманда `worktree` у пакеті `@nitra/cursor` + тонкий skill `n-worktree` + оновлення конвенції `n-worktrees.mdc`.

## Контекст і проблема

Робота в ізольованому git-worktree потрібна і в Claude Code, і в Cursor. Зараз єдиний «нативний» інструмент — `EnterWorktree` — належить **лише** харнесу Claude Code: він недоступний у Cursor, кладе worktree у приватну `.claude/worktrees/` (заборонену `cursor/CLAUDE.md`) і за замовчуванням гілкується від `origin/<default>`, тихо втрачаючи локальні коміти.

Паралельно вже існує конвенція `.cursor/rules/n-worktrees.mdc`: worktree у `.worktrees/<branch>/` (gitignored) + інвентарний файл-опис `.worktrees/<branch>.md` поруч. Але це **ручний рецепт** (`git worktree add` + вручну створити `.md`) — працює лише поки агент дисциплінований, і неоднаково в різних середовищах.

Потрібен **виконавець конвенції у вигляді CLI** — однаковий скрізь (це звичайний Node-процес), що робить операції атомарно й сам генерує інвентарний `.md`.

## Рішення (узгоджені варіанти)

| Питання | Вибір | Суть |
|---|---|---|
| Форма | **C** | CLI-команда (виконавець) + тонкий skill (вказівник). |
| Набір підкоманд | **D3** | `add`, `remove`, `list`, `prune`. |
| Інтерфейс гілки | **E1 + санітизація** | один аргумент `<branch>`; слеш → дефіс для пласких `.worktrees/`. |
| База гілки | **F1** | завжди від поточного HEAD (без флагів). |
| Інвентарний `.md` | **G1** | tool генерує авто-поля; опис — обовʼязковий аргумент. |
| `remove` | **H2** | безпечний дефолт + `--force`. |
| `prune` | **H-prune-b** | агресивний: одразу прибирає осиротілі. |
| Skill + конвенція | **I1 + I2** | тонкий skill + переписати `n-worktrees.mdc` під CLI. |

## Підкоманди

```
npx @nitra/cursor worktree add <branch> "<опис>"   # створити
npx @nitra/cursor worktree remove <branch> [--force]
npx @nitra/cursor worktree list
npx @nitra/cursor worktree prune
```

### `add <branch> "<опис>"`

1. Санітизує `<branch>` у імʼя шляху: слеш → дефіс. `feat/skill-meta` → `feat-skill-meta`. Git-гілка лишається оригінальною (`feat/skill-meta`).
2. `git worktree add .worktrees/<санітизована> -b <branch>` — від **поточного HEAD** (F1; без ref → HEAD).
3. Генерує `.worktrees/<санітизована>.md` (поруч із checkout — gitignored через `.worktrees/`).
4. Друкує фактичний шлях checkout і шлях `.md` (агент не вгадує).

**Опис обовʼязковий** (G1): без нього команда виходить з кодом 1 і підказкою — щоб не плодити безіменні worktree (інвентаризація без опису безсенсова).

**Помилки:** гілка вже існує / каталог `.worktrees/<санітизована>` зайнятий → exit 1 з поясненням, нічого не створює.

### `remove <branch> [--force]`

1. Санітизує `<branch>` так само.
2. `git worktree remove .worktrees/<санітизована>` (без `--force` git сам відмовиться на брудному/незакоміченому дереві — H2).
3. З `--force` → `git worktree remove --force …` (свідоме викидання брудного worktree).
4. Видаляє `.worktrees/<санітизована>.md`.
5. Гілку git **не** видаляє (може мати незмерджену роботу).

### `list`

Обʼєднаний вивід в одному форматі:
- рядки `git worktree list` (path, HEAD, branch);
- під кожним — вміст відповідного `.worktrees/<name>.md` (задача, дата, база), якщо існує;
- worktree без `.md` — позначити `(без опису)`.

### `prune` (агресивний — H-prune-b)

1. `git worktree prune` — прибирає метадані worktree, чий checkout зник з диска.
2. Видаляє осиротілі `.worktrees/*.md`, для яких немає відповідного зареєстрованого worktree.
3. worktree без `.md` — **не** чіпає, лише попереджає в звіті.
4. Друкує, що саме прибрано (не «мовчазне» прибирання — лог для прозорості).

## Файлова структура (пакет)

```
npm/scripts/worktree-cli.mjs          ← диспетчер підкоманд + парсинг argv (тонкий)
npm/scripts/lib/worktree.mjs          ← чиста логіка (тестована юнітами)
npm/scripts/lib/tests/worktree.test.mjs
npm/scripts/tests/worktree-cli.test.mjs
npm/bin/n-cursor.js                    ← новий case 'worktree' (поряд з 'skill', 'change')
npm/skills/worktree/SKILL.md           ← тонкий skill
npm/skills/worktree/meta.json          ← { "worktree": false }  (auto відсутнє = opt-in)
npm/rules/worktree/worktree.mdc        ← канонічне джерело pure-doc правила (нормалізація)
```

### `npm/scripts/lib/worktree.mjs` — чисті, тестовані функції

- `sanitizeBranch(branch) → string` — слеш у дефіс (і будь-які небезпечні для шляху символи); основа імені каталогу/`.md`.
- `worktreePaths(repoRoot, branch) → { checkout, descFile }` — детерміновані шляхи (`.worktrees/<s>/`, `.worktrees/<s>.md`).
- `buildDescription({ branch, task, baseCommit, date }) → string` — текст `.md` за шаблоном `n-worktrees.mdc` (заголовок, **Задача**, **Дата**, **База (коміт)**, гілка, рядок «Прибрати: `npx @nitra/cursor worktree remove <branch>`»).
- `findOrphanDescFiles(worktreesDir, registeredCheckouts) → string[]` — `.md` без відповідного worktree (для `prune`).
- `findWorktreesWithoutDesc(...) → string[]` — worktree без `.md` (для `prune`/`list` попереджень).

`worktree-cli.mjs` — лише оркестрація: парсить argv, викликає `git` (через `execFileSync`/`spawnSync`), використовує чисті функції, пише файли, друкує звіт, повертає exit-code.

### Дата в `.md`

Tool — звичайний CLI-процес (не workflow-скрипт), тож `new Date()` доступний. Канон `scripts.mdc`/`n-test.mdc` забороняє `Date.now()`/`new Date()` саме у **workflow-скриптах** (детермінізм resume) і в тестах — не в продакшн-CLI. Перевірено: у `.cursor/rules/` немає глобальної заборони `new Date()` для CLI. Дату беремо `new Date().toISOString().slice(0,10)` (YYYY-MM-DD). У тестах `buildDescription` дата подається як **параметр** (детермінізм тесту), не читається з годинника всередині чистої функції.

## Skill + конвенція (I1 + I2)

### Новий skill `npm/skills/worktree/`

- `SKILL.md` — **тонкий**: коротко пояснює, що для роботи з worktree треба викликати `npx @nitra/cursor worktree add/remove/list/prune`, з 2-3 прикладами. Уся логіка — в CLI; skill лише спрямовує агента до команди.
- `meta.json`: `{ "worktree": false }` — `auto` відсутнє (opt-in; skill керування worktree не має сам запускатись в ізольованому worktree — уникаємо рекурсії).

### Нормалізувати правило `worktree` (канонічне джерело в пакеті)

**Проблема:** наразі `n-worktrees.mdc` існує **лише** локально в `.cursor/rules/n-worktrees.mdc`, без пакетного джерела `npm/rules/<id>/<id>.mdc`. Це порушує інваріант репо (кожне правило має джерело в `npm/rules/`, звідки sync копіює в `.cursor/rules/n-<id>.mdc`). Як «сирота» цей файл не керується sync і за певних умов буде видалений як зайвий `n-*.mdc` (`n-cursor.js` чистить керовані `n-*.mdc` без джерела/конфігу).

**Рішення (pure-doc правило, J1 — без `fix.mjs`/programmatic check):**

- Створити канонічне джерело `npm/rules/worktree/worktree.mdc` (id у **однині** — збігається з підкомандою CLI `worktree` і каталогом скіла `skills/worktree`).
- Перенести в нього зміст конвенції, **переписаний під CLI**: замість ручного рецепта (`git worktree add … + вручну .md`) — виклики `npx @nitra/cursor worktree add/remove/list/prune`. Секції «Створити / Інвентаризація / Прибрати» → відповідні підкоманди. Конвенцію розташування (`.worktrees/`, gitignored, `.md` поруч) і заборони (`.claude/worktrees/`, `../cursor-*`) лишити — їх тепер **дотримується tool**, правило документує намір.
- Видалити старий локальний `.cursor/rules/n-worktrees.mdc` (множина). Після `npx @nitra/cursor` sync зʼявиться керований `.cursor/rules/n-worktree.mdc` (однина) з пакетного джерела.
- Оновити `CLAUDE.md`: посилання `@.cursor/rules/n-worktrees.mdc` → `@.cursor/rules/n-worktree.mdc`.
- Правило — **pure-doc**: без `fix.mjs` і без policy. Структуру worktree гарантує сам CLI; окремий `check` поки не потрібен (YAGNI; додамо, якщо worktree почнуть створювати повз tool).

> Примітка для плану: оскільки правило pure-doc (немає `js/<concern>.mjs` чи `policy/<concern>/target.json`), auto-discovery `npx @nitra/cursor fix` його не підхоплює як checkable — це очікувано. Sync-розповсюдження `.mdc` працює незалежно від наявності check.

## Тести

- `npm/scripts/lib/tests/worktree.test.mjs` — чисті функції: `sanitizeBranch` (слеш, кілька слешів, безпечні символи), `worktreePaths`, `buildDescription` (з фіксованою датою-параметром), `findOrphanDescFiles`, `findWorktreesWithoutDesc`.
- `npm/scripts/tests/worktree-cli.test.mjs` — інтеграційні на тимчасовому git-репо (`withTmpDir` + `git init`): `add` створює checkout+`.md` від HEAD; `add` без опису → exit 1; `remove` прибирає checkout+`.md`, лишає гілку; `remove` на брудному без `--force` → відмова, з `--force` → прибирає; `list` зливає git+опис; `prune` видаляє осиротілий `.md`. Git-залежні тести — за каноном `n-test.mdc` (sandbox-aware, `withTmpDir` + `git init`).
- Регресія: повний `npm` сюїт зелений.

## Реліз і документація

- `npm/bin/n-cursor.js` — новий `case 'worktree'` → `runWorktreeCli(process.argv.slice(3))`.
- `npm/README.md` — секція про `worktree`-команду.
- Change-файл `npm/.changes/<…>.md` (`bump: minor`, `section: Added`) — bump робить CI (n-changelog).
- `npm-module/js/skill_meta.mjs` (зі Spec A) автоматично провалідує новий `skills/worktree/meta.json`.

## Out of scope

- База гілки `--from <ref>` (F2/F3) — поки лише HEAD (F1).
- Рекурсивна slash-структура `.worktrees/feat/skill-meta/` — обрана пласка (санітизація).
- Інтеграція tool із самим *виконанням* скілів (tool лише керує worktree; запуск скіла всередині — рішення агента за інструкцією з `SKILL.md`/Spec A).
- Видалення git-гілки при `remove` (лишаємо — може мати незмерджену роботу).
