---
session: 09dcb1bc-929b-4d88-90b0-c0611bed3d2f
captured: 2026-05-31T07:09:36+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/09dcb1bc-929b-4d88-90b0-c0611bed3d2f.jsonl
---

## ADR: `auto.md` → `meta.json` у npm-скілах з обовʼязковим полем `worktree`

## Context and Problem Statement
Скіли в `npm/skills/<id>/` мали плоский файл `auto.md` для умови автоактивації. З появою потреби додати поле `worktree` (чи скіл запускається в ізольованому worktree) однопольовий текстовий формат виявився непридатним для розширення. Паралельні сесії створили два конкуруючих spec і два плани з несумісними варіантами.

## Considered Options
* `meta.json` замість `auto.md` (JSON-файл з полями `auto` і `worktree`)
* Зберегти `auto.md` + додати окремий `worktree.json`
* Зберегти `auto.md` з fallback і додати `meta.json` як нову форму (deprecation-period)

## Decision Outcome
Chosen option: "`meta.json` замість `auto.md`, без fallback", because поле `auto` зберігає той самий літерал (`"завжди"` або масив правил) — сумісність з `auto-skills.mjs` без додаткової міграції; поле `worktree: boolean` натурально розширює формат; два джерела правди (одночасно `auto.md` і `meta.json`) були б небезпечнішими за чистий розрив.

### Consequences
* Good, because `auto-skills.mjs` продовжує читати літерал `"завжди"` — жодного рефакторингу парсера.
* Good, because transcript фіксує очікувану користь: `coverage-fix` і `fix-tests` отримали коректне значення `auto: ["js-lint"]` (відповідає реальному вмісту попередніх `auto.md`), а не помилкове `"always"` з чернетки паралельної сесії.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Канонічний spec: `docs/superpowers/specs/2026-05-31-skill-meta-json-worktree-design.md` (commit `79e38d1`). План реалізації: `docs/superpowers/plans/2026-05-31-skill-meta-json-worktree.md` (commit `f53b097`, розширено `4977ec5`). Парсер auto: `npm/scripts/auto-skills.mjs`. Константа: `ALWAYS_LITERAL = 'завжди'`. Видалено: дубль-spec `2026-05-31-meta-json-skill-worktree-design.md` і обидва конкуруючих плани.

---

## ADR: CLI `n-cursor worktree` як крос-платформний виконавець worktree-конвенції

## Context and Problem Statement
Інструмент `EnterWorktree` — вбудований у Claude Code харнес, недоступний у Cursor. Існуюча конвенція `n-worktrees.mdc` описувала ручні кроки (`git worktree add` + вручну створити `.md`-файл), залежні від дисципліни агента. Потреба: операції з worktree мають поводитись **однаково** в Claude Code і Cursor без покладання на харнес-специфічні інструменти.

## Considered Options
* Підкоманда CLI `n-cursor worktree` (форма A — лише CLI)
* Skill `n-worktree` (markdown-інструкція для агента, форма B)
* CLI-команда + тонкий skill-вказівник (форма C)
* CLI-команда + оновити `n-worktrees.mdc` без окремого skill (форма I2)

## Decision Outcome
Chosen option: "CLI `n-cursor worktree` + оновити `n-worktrees.mdc` (без окремого skill)", because CLI-команда є єдиною формою, що дає **ідентичну поведінку** в будь-якому середовищі без залежності від харнесу; оновлення `n-worktrees.mdc` замість ручного рецепту усуває розсинхрон між правилом і реальним виконавцем.

### Consequences
* Good, because transcript фіксує очікувану користь: Bootstrap-проблему вирішено — tool можна викликати з терміналу, в Claude Code і Cursor однаково через `npx @nitra/cursor worktree`.
* Good, because логіка генерації інвентарного `.md`-файлу перенесена в CLI (атомарна операція), агент більше не несе відповідальності за дотримання формату вручну.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Файли: `npm/scripts/lib/worktree-cli.mjs` (нова логіка), `npm/bin/n-cursor.js` (новий `case 'worktree':`), `.cursor/rules/n-worktrees.mdc` (оновити). Реалізується в `main`-гілці безпосередньо (bootstrap-рішення — окремий ADR нижче).

---

## ADR: Дизайн підкоманд `n-cursor worktree` (add/remove/list/prune)

## Context and Problem Statement
Потрібно визначити набір підкоманд, поведінку при конфліктах (брудне дерево, осиротілі файли), базову гілку worktree та формат інвентарного `.md`-файлу.

## Considered Options
* `add` + `remove` (мінімум, D1)
* `add` + `remove` + `list` (D2)
* `add` + `remove` + `list` + `prune` (D3) — обрано
* Зберігати слеш у назві каталогу (E-slash-b)
* Санітизувати слеш у дефіс для пласкої структури (E-slash-a) — обрано
* База worktree від `origin/<default>` (F3)
* База від HEAD з опційним `--from` (F2)
* База завжди від HEAD, без флагів (F1) — обрано
* Опис worktree — опційний (G2)
* Опис — обовʼязковий аргумент (G1) — обрано
* `prune` dry-run за замовчуванням (H-prune-a)
* `prune` агресивний (H-prune-b) — обрано

## Decision Outcome
Chosen option: "add/remove/list/prune (D3); слеш→дефіс (E-slash-a); база від HEAD (F1); опис обовʼязковий (G1); remove безпечний + `--force` (H2); prune агресивний (H-prune-b)", because кожен вибір мінімізує сюрпризи: пласка структура зберігає `cat .worktrees/*.md` робочим; HEAD-база усуває пастку `EnterWorktree` (втраченні локальні коміти); обовʼязковий опис гарантує осмисленість інвентарного файлу; агресивний prune зменшує накопичення сміття без додаткового підтвердження.

### Consequences
* Good, because transcript фіксує очікувану користь: `cat .worktrees/*.md` завжди знаходить усі описи (пласка структура), worktree успадковує локальні коміти що ще не в `origin`.
* Bad, because `prune` H-prune-b видаляє осиротілі `.md` без підтвердження — якщо `.md` видалено помилково, відновити можна лише з `git reflog` (самого файлу там немає, бо `.worktrees/` gitignored).

## More Information
Формат `.worktrees/<safe-branch>.md`: заголовок = назва гілки, поля Задача (з аргументу), База (git rev-parse --short HEAD + гілка + дата), Шлях, рядок «Прибрати: `n-cursor worktree remove <branch>`». Санітизація: `branch.replace(/\//g, '-')` → ім'я каталогу і `.md`.

---

## ADR: Bootstrap реалізації `n-cursor worktree` в `main`-гілці

## Context and Problem Statement
Конвенція вимагає реалізовувати нові фічі в ізольованому git-worktree. Але сам worktree-tool (`n-cursor worktree add`) ще не існує — немає виконавця, який міг би атомарно створити worktree з інвентарним файлом згідно з конвенцією.

## Considered Options
* Реалізувати tool в ізольованому worktree (через ручний `git worktree add` + вручну .md)
* Реалізувати tool безпосередньо в `main`-гілці (bootstrap-виняток)

## Decision Outcome
Chosen option: "реалізувати в `main`-гілці (bootstrap-виняток)", because bootstrap-проблема: інструмент, що має стати виконавцем конвенції, не можна реалізувати через власну ж конвенцію до свого існування. Ручний `git worktree add` без CLI є саме тим «ручним рецептом», який ця задача покликана усунути.

### Consequences
* Good, because transcript фіксує очікувану користь: після реалізації всі наступні фічі зможуть використовувати `n-cursor worktree add` за конвенцією.
* Bad, because `main`-гілка набуває незавершеної роботи без ізоляції — ризик конфліктів із паралельними сесіями (виявлений під час сесії: паралельна сесія реалізовувала Spec A в тих самих файлах).

## More Information
Паралельні агентські сесії (`/n-fix` PID 63488, `/n-coverage-fix` PID 69741, Zed-sdk `760ddcc2` PID 64311) були зупинені за явним запитом користувача перед початком реалізації, щоб усунути конкуруючі зміни в робочому дереві.
