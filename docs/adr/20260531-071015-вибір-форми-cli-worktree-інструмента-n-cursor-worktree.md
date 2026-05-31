---
session: 09dcb1bc-929b-4d88-90b0-c0611bed3d2f
captured: 2026-05-31T07:10:15+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/09dcb1bc-929b-4d88-90b0-c0611bed3d2f.jsonl
---

Усі дизайн-рішення зафіксовані. Я використовую brainstorming skill для написання spec-документу, перш ніж переходити до плану.

Ось підсумковий дизайн для погодження — складаю, а потім запишу у файл.

---

## Дизайн: `n-cursor worktree` CLI + skill `n-worktree`

### Scope
Новий підрозділ у `npm/bin/n-cursor.js` (dispatcher `case 'worktree'`) + реалізація у `npm/scripts/lib/worktree-cmd.mjs`. Новий skill `npm/skills/worktree/`. Оновлення `.cursor/rules/n-worktrees.mdc`.

### Підкоманди CLI

```
n-cursor worktree add <branch> "<опис задачі>"
n-cursor worktree remove <branch> [--force]
n-cursor worktree list
n-cursor worktree prune
```

### `add <branch> "<description>"`
1. Санітизує `branch`: слеші → дефіси → ім'я файлу/каталогу (гілка у git — з оригінальними слешами).
2. `git worktree add .worktrees/<sanitized> -b <branch>` від HEAD.
3. Записує `.worktrees/<sanitized>.md` (пласко, gitignored через `.gitignore`):
```
# <branch>
**Задача:** <description>
**Дата:** YYYY-MM-DD
**База:** <short sha>
**Прибрати:** n-cursor worktree remove <branch>
```
4. Виводить: `✅ worktree .worktrees/<sanitized>/ на гілці <branch> (від <sha>)`.

### `remove <branch> [--force]`
- Санітизує branch → шлях.
- `git worktree remove [--force] .worktrees/<sanitized>`.
- Видаляє `.worktrees/<sanitized>.md`.
- Виводить: `✅ видалено` або помилку з порадою `--force` якщо брудний.

### `list`
- `git worktree list` → для кожного шляху в `.worktrees/<sanitized>/` читає `.worktrees/<sanitized>.md` (якщо є).
- Виводить таблицю: `<branch> | <path> | <sha> | <перший рядок опису>`.

### `prune`
- `git worktree prune` (очищає мертві git-метадані).
- Сканує `.worktrees/*.md` → видаляє `.md`, якщо відповідного worktree немає на диску.
- Сканує `git worktree list` → виводить попередження для worktree без `.md`.
- Виводить звіт: що видалено, що попереджено.

### Skill `npm/skills/worktree/`
- `meta.json`: `{ "auto": null, "worktree": false }` (скіл не автоактивується, не потребує ізоляції).
- `SKILL.md`: "Для роботи з git-worktree використовуй `n-cursor worktree <sub> …`" + приклади.

### Оновлення `n-worktrees.mdc`
- Ручний рецепт `git worktree add` + ручне `mkdir/.md` → замінити на `n-cursor worktree add <branch> "<опис>"`.
- Решта конвенції (де зберігаємо, gitignore, заборони) лишається.

### Тести
- Юніт: `npm/scripts/lib/tests/worktree-cmd.test.mjs` — через `withTmpDir` + `git init`, перевіряє: add/remove/list/prune, санітизацію слеша, відмову `remove` на брудному (без `--force`), запис `.md`.
- Інтеграційний реєстр: `npm/tests/integration-repo-checks.test.mjs` — якщо там є перевірки нових команд.

---

Чи відображає це все, що обговорили? Якщо ок — запишу у spec-файл і закомічу.

---
TRANSCRIPT END

## ADR Вибір форми CLI-worktree-інструмента (`n-cursor worktree`)

## Context and Problem Statement
Агент у сесії Claude Code зіткнувся з тим, що нативний інструмент харнесу `EnterWorktree` жорстко прив'язаний до Anthropic-специфічного шляху `.claude/worktrees/` і не підходить для роботи в Cursor IDE. Користувач захотів власний кросплатформний worktree-інструмент, що однаково працює в Claude і Cursor.

## Considered Options
* CLI-підкоманда `n-cursor worktree` (форма A) — без skill
* Skill `n-worktree` (markdown-інструкція для агента, форма B)
* CLI-команда + тонкий skill (форма C)

## Decision Outcome
Chosen option: "CLI-команда + тонкий skill (форма C)", because CLI-команда гарантує ідентичну поведінку в будь-якому середовищі (Claude, Cursor, термінал) без залежності від харнесових інструментів, а тонкий skill `n-worktree` спрямовує агентів до цієї команди.

### Consequences
* Good, because transcript фіксує очікувану користь: однакова поведінка в Claude і Cursor без залежності від `EnterWorktree`.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- Нативний `EnterWorktree` — deferred tool харнесу Claude Code; кладе worktree у `.claude/worktrees/` (захищена директорія за `cursor/CLAUDE.md`).
- Конвенція `.worktrees/` зафіксована в `.cursor/rules/n-worktrees.mdc` (коміт `1838e44`).
- Dispatcher CLI: `npm/bin/n-cursor.js` (`case 'worktree'`); реалізація: `npm/scripts/lib/worktree-cmd.mjs`.
- Skill: `npm/skills/worktree/` з `meta.json` і `SKILL.md`.

---

## ADR Набір підкоманд CLI `n-cursor worktree`

## Context and Problem Statement
При проєктуванні нового CLI-інструмента `n-cursor worktree` постало питання, який мінімальний набір підкоманд закласти: лише мутуючі (`add`/`remove`) чи додати інвентаризацію (`list`) та прибирання (`prune`).

## Considered Options
* D1: `add` + `remove` (YAGNI-мінімум)
* D2: `add` + `remove` + `list`
* D3: `add` + `remove` + `list` + `prune`

## Decision Outcome
Chosen option: "D3 — `add` + `remove` + `list` + `prune`", because користувач обрав D3 з метою покрити повний цикл роботи з worktree: створення, видалення, інвентаризацію та прибирання осиротілих елементів.

### Consequences
* Good, because `prune` усуває розсинхрон між git-метаданими і `.md`-описами, не покладаючись на ручне прибирання.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- `list` об'єднує `git worktree list` і вміст `.worktrees/*.md` в один вивід.
- `prune` = `git worktree prune` + видалення осиротілих `.md` + попередження для worktree без `.md`.
- Конвенція зберігання: `.worktrees/<sanitized-branch>/` + `.worktrees/<sanitized-branch>.md`.

---

## ADR Семантика `remove` і `prune` у `n-cursor worktree`

## Context and Problem Statement
При проєктуванні підкоманд `remove` і `prune` виникло питання про рівень агресивності дій за замовчуванням, зокрема що робити з брудними worktree та осиротілими `.md`-файлами.

## Considered Options
* `remove` без `--force`, `prune` — dry-run за замовчуванням (H1 + H-prune-a)
* `remove` з опційним `--force`, `prune` — агресивний одразу (H2 + H-prune-b)

## Decision Outcome
Chosen option: "`remove` = H2 (безпечний дефолт + `--force`), `prune` = H-prune-b (агресивний)"", because `remove` без `--force` захищає від випадкової втрати незакомічених змін, а `prune` агресивний, бо осиротілі `.md` є сміттям, що не потребує підтвердження.

### Consequences
* Good, because transcript фіксує очікувану користь: `remove` безпечний за замовчуванням (git відмовляється сам), `prune` прибирає сміття автоматично.
* Bad, because агресивний `prune` може видалити `.md` без підтвердження, якщо worktree зник некоректно — але transcript цей ризик не розглядав.

## More Information
- `remove` передає `--force` у `git worktree remove --force .worktrees/<sanitized>` і потім видаляє `.md`.
- `prune` виконує `git worktree prune` + сканує `.worktrees/*.md` і видаляє осиротілі одразу.
- Файл реалізації: `npm/scripts/lib/worktree-cmd.mjs`.

---

## ADR База гілки при `n-cursor worktree add` — завжди від HEAD

## Context and Problem Statement
При `n-cursor worktree add <branch>` потрібно визначити, від якого ref відгалужується новий worktree. Нативний `EnterWorktree` харнесу за замовчуванням використовує `origin/<default>`, що відкидало б локальні незапушені коміти — саме та проблема, через яку `EnterWorktree` виявився непридатним.

## Considered Options
* F1: завжди від поточного HEAD, без флагів
* F2: дефолт HEAD + опційний `--from <ref>`
* F3: дефолт від `origin/<default>` (як `EnterWorktree`)

## Decision Outcome
Chosen option: "F1 — завжди від HEAD, без флагів", because YAGNI: флаг `--from` не потрібен на старті, а HEAD-дефолт усуває пастку `EnterWorktree`, де локальні коміти губились.

### Consequences
* Good, because worktree успадковує всі локальні незапушені коміти — рівно та поведінка, якої бракувало `EnterWorktree`.
* Bad, because відсутній `--from <ref>` ускладнить кейс «чиста гілка від origin» в майбутньому, якщо така потреба виникне.

## More Information
- Команда: `git worktree add .worktrees/<sanitized> -b <branch>` (без явного ref → береться HEAD).
- Можливе розширення до F2 (`--from`) за потреби в майбутньому.

---

## ADR Санітизація слешів у назві гілки для шляхів worktree

## Context and Problem Statement
Git-гілки часто містять слеші (`feat/skill-meta`), але при відображенні у файловій системі `.worktrees/<branch>.md` слеш створює підкаталоги, що ламає `cat .worktrees/*.md` (glob не рекурсивний) та ускладнює інвентаризацію.

## Considered Options
* E-slash-a: санітизувати слеш у дефіс для імен файлів/каталогів worktree (гілка у git — з оригінальними слешами)
* E-slash-b: зберігати слеш-структуру в `.worktrees/`, `list`/`prune` шукають рекурсивно

## Decision Outcome
Chosen option: "E-slash-a — санітизувати слеш у дефіс", because пласка структура `.worktrees/` зберігає `cat .worktrees/*.md` робочим і відповідає прикладам у `n-worktrees.mdc` (`feat-skill-meta`).

### Consequences
* Good, because `cat .worktrees/*.md` і `ls .worktrees/` завжди дають повний інвентар без рекурсивного пошуку.
* Bad, because назва каталогу worktree відрізняється від назви гілки git, що може заплутати при ручному огляді.

## More Information
- Санітизація: `branch.replaceAll('/', '-')` → ім'я каталогу/файлу; гілка у `git worktree add -b <branch>` лишається оригінальною.
- Приклад у `n-worktrees.mdc`: `feat-skill-meta` (дефіс) відповідає цьому рішенню.

---

## ADR Обовʼязковість опису при `n-cursor worktree add`

## Context and Problem Statement
При `n-cursor worktree add <branch>` для інвентарного файлу `.n-worktree.md` потрібно вирішити: чи вимагати опис задачі як обовʼязковий аргумент, чи дозволяти створення з плейсхолдером, який доповнять пізніше.

## Considered Options
* G1: опис обовʼязковий — без нього команда падає з підказкою
* G2: опис опційний, без нього у файл вставляється плейсхолдер
* G3: структуровані прапорці `--task`, `--skill`, `--plan`

## Decision Outcome
Chosen option: "G1 — опис обовʼязковий", because без опису інвентаризація безсенсова (задекларована ціль — знати навіщо кожен worktree), а плейсхолдер (G2) легко забувають заповнити.

### Consequences
* Good, because `cat .worktrees/*.md` завжди дає осмислену картину, без порожніх або плейсхолдерних записів.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- Сигнатура: `n-cursor worktree add <branch> "<опис задачі>"`.
- Tool автоматично заповнює: дата (`new Date()`), база-коміт (`git rev-parse --short HEAD`), гілка, шлях, рядок «Прибрати».

---

## ADR Роль skill `n-worktree` і оновлення `n-worktrees.mdc`

## Context and Problem Statement
З появою CLI-команди `n-cursor worktree` конвенція `n-worktrees.mdc` містила ручні кроки (`git worktree add` + ручне створення `.md`), які ставали дублюванням логіки tool. Потрібно визначити роль skill та правила відносно одне одного.

## Considered Options
* I1: skill = тонкий вказівник на CLI; `n-worktrees.mdc` не змінюється
* I1+I2: skill = тонкий вказівник на CLI + оновити `n-worktrees.mdc` (замінити ручний рецепт на виклик команди)
* I3: лише оновити `n-worktrees.mdc`, без окремого skill

## Decision Outcome
Chosen option: "I1+I2 — тонкий skill + оновлення `n-worktrees.mdc`", because ручний рецепт у `n-worktrees.mdc` інакше суперечив би CLI: агент читав би два різних способи — вручну або через команду.

### Consequences
* Good, because єдине джерело істини — CLI; і skill, і правило вказують туди, без розсинхрону.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- `npm/skills/worktree/meta.json`: `{ "auto": null, "worktree": false }`.
- `npm/skills/worktree/SKILL.md`: вказівник на `n-cursor worktree <sub>` + приклади.
- `.cursor/rules/n-worktrees.mdc`: ручний рецепт замінюється на виклик CLI; решта конвенції лишається.

---
