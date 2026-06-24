---
name: n-coverage-fix
description: >-
  Автономна команда: запускає n-cursor coverage → читає вцілілих мутантів → ітеративно пише тести до конвергенції (max 3 ітерації)
version: '1.0'
---

<!-- n-cursor:worktree:start -->
> [!IMPORTANT]
> **Worktree-only skill.** Виконується **виключно** в окремому git-worktree (`.worktrees/<current-branch>-coverage-f/`) і **не** паралелиться — один інстанс за раз.

**Крок 0 — preflight (обовʼязковий, перед будь-якими іншими діями).** Якщо перевірка падає — **STOP**: не питай користувача про назву гілки, а сам створи worktree від поточної гілки за конвенцією `<current-branch>-coverage-f`. Суфікс `coverage-f` — коротка (до 10 символів) транслітерація задачі. Не виконуй **жоден** наступний крок скіла, поки preflight не завершився успіхом.

```bash
pwd
git rev-parse --show-toplevel
git branch --show-current
```

**Root-assert.** Якщо `pwd` **не** збігається з виводом `git rev-parse --show-toplevel` — ти в **піддиректорії** робочого дерева (worktree-шляхи нижче відносні до кореня репо). Спершу перейди в корінь: `cd <toplevel>` (literal-шлях із виводу), і лише тоді продовжуй preflight. Не створюй worktree з піддиректорії — `cd .worktrees/<…>` звідти впаде.

Якщо `git rev-parse --show-toplevel` показав, що ти **не** в `.worktrees/`, візьми вивід `git branch --show-current` як `<current-branch>` і виконай **literal-команди без shell expansion** (без command substitution, variable expansion чи backticks). Наприклад, якщо поточна гілка `feature/x`:

```bash
npx @7n/mt worktree create "feature/x-coverage-f" "n-coverage-f: worktree-only skill"
cd ".worktrees/feature-x-coverage-f"
```

Тобто branch-argument лишає slash як у git-гілці, а шлях для `cd` бере sanitized форму: slash → `-`.

**Крок 0.1 — bootstrap у новому дереві (після `cd`).** Дерево щойно створене й **без** `node_modules`. Постав залежності локально — тоді `npx @nitra/cursor <cmd>` бере локальну копію без походу в реєстр:

```bash
bun install
```
<!-- n-cursor:worktree:end -->

# n-coverage-fix — підвищення mutation score

## Мета

Автоматично підвищити mutation score: запускає coverage, знаходить survived mutants, пише тести, повторює до конвергенції.

## ⚠️ Не запускати паралельно

Цей скіл **не можна** запускати паралельно в різних агентах або Bash-задачах.

`n-cursor coverage` всередині серіалізований через `withLock('coverage')` — другий виклик чекатиме. Але Stryker пише `mutation.json` і `incremental.json` в одну директорію: паралельний запуск **зіпсує обидва файли**. Запускай тільки один `/n-coverage-fix` одночасно.

## Передумови

- Поточна директорія — корінь проєкту (де `.n-cursor.json` і `COVERAGE.md`)
- `n-cursor coverage` доступний (`npx @nitra/cursor coverage` або `bun run coverage`)
- Залежності встановлені (`bun i`)

## Workflow

### Крок 0: Визнач команди (з `package.json#scripts`)

Прочитай кореневий `package.json` і зафіксуй дві команди (перша що існує):

- **coverage-команда**: `scripts["coverage"]` → виклик `bun run coverage`; fallback `n-cursor coverage`
- **test-команда**: `scripts["test"]` → виклик `bun run test` (або те, що в скрипті); fallback `bun test`

Далі по тексту «coverage-команда» / «test-команда» = знайдені тут значення.

### Крок 1: Згенеруй або переви́користай `COVERAGE.md`

**Early-skip.** Якщо `COVERAGE.md` уже існує, свіжий (новіший за останню зміну source/тестів) і має секцію `## Вцілілі мутанти` — можеш одразу перейти до Кроку 2 без повторної генерації. Інакше — згенеруй звіт:

```bash
n-cursor coverage   # або coverage-команда з Кроку 0
```

Ця команда генерує `COVERAGE.md`. Якщо є survived mutants — COVERAGE.md матиме секцію `## Вцілілі мутанти` з JSON-блоком.

### Крок 2: Прочитай компактний index вцілілих

> **Не читай `COVERAGE.md` сам.** Файл може важити мегабайти (секція `## Вцілілі
мутанти` на сотні файлів) — його читання спалило б сотні тисяч токенів. Важкий
> парсинг несе CLI; ти отримуєш лише крихітний index.

```bash
n-cursor coverage-fix index
```

Друкує компактний JSON-масив `[{ "file": "<path>", "mutants": <N> }]` (кілобайти, не мегабайти). Якщо `[]` — зупинись:

```
✓ Жодних вцілілих мутантів — mutation score повний. Coverage завершено.
```

Запам'ятай `prevCount = сума всіх mutants` (загальна кількість вцілілих мутантів).

### Крок 3: Для кожного файлу — slice + Agent

Для кожного запису `{ file, mutants }` з index:

**3a. Визнач test файл (завжди у `tests/` директорії):**

Цільовий: `<dir>/tests/<basename>.test.mjs`
(де `<dir>` — директорія source-файлу, `<basename>` — ім'я source без розширення)

1. Якщо `<dir>/tests/<basename>.test.mjs` існує → використай
2. Якщо `<dir>/<basename>.test.js` або `<dir>/<basename>.test.mjs` існує (co-located) →
   - Перенеси до `<dir>/tests/<basename>.test.mjs`
   - Оновити відносні imports (тепер `../` рівень вгору до source)
3. Жоден не знайдено → буде створено `<dir>/tests/<basename>.test.mjs`

**3b. Отримай готовий зріз-промпт лише для цього файлу:**

```bash
n-cursor coverage-fix slice --file <file>
```

CLI друкує самодостатній промпт **рівно для одного файлу**: список вцілілих мутантів цього файлу (рядок/колонка/`original → replacement`/тип) з контекстом ±3 рядки навколо кожного та фіксовані правила. Це і є «порція під когнітивне навантаження» одного субагента — нічого зайвого.

**3c. Запусти Agent** з цим зрізом як промптом, дописавши один рядок про цільовий test-файл із 3a (`<dir>/tests/<basename>.test.mjs`, з правильними відносними imports). Дочекайся завершення.

### Крок 4: Перевір що всі тести проходять

```bash
bun test   # або test-команда з Кроку 0
```

Якщо падають — поверни відповідний Agent з помилкою і попроси виправити.

### Крок 5: Запусти coverage і порівняй

```bash
n-cursor coverage   # або coverage-команда з Кроку 0
n-cursor coverage-fix index
```

`newCount = сума mutants` зі свіжого index (знову — без читання `COVERAGE.md` вручну).

**Рішення:**

- `newCount < prevCount` AND iterations < 3 → повтор з Кроку 2 з оновленим index
- `newCount >= prevCount` → конвергенція:

  ```
  ✓ Конвергенція: mutation score більше не покращується.
  Було вцілілих: <prevCount>, стало: <newCount>.
  ```

- iterations == 3 → зупинись:

  ```
  ⚠️ Досягнуто максимум ітерацій (3).
  Вціліло: <newCount> мутантів. Деякі можуть бути стійкими (dead code, external state).
  ```

## Конвергенція — нормальний результат

Деякі мутанти неможливо вбити: захищений зовнішній стан, недетермінована логіка, еквівалентні мутації. Не намагайся виправити те що не змінилось після ітерації.

## Нотатки

- Stryker `incremental` (`incrementalFile`) зберігає прогрес між запусками — crash ≠ перезапуск з нуля
- Не комітити зміни автоматично — user вирішує коли комітити
