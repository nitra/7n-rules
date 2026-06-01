---
name: n-fix-tests
description: >-
  Ітеративно дописати тести щоб підвищити mutation score — читає вцілілі мутанти з COVERAGE.md і запускає агент до конвергенції
---

<!-- n-cursor:worktree:start -->
> [!IMPORTANT]
> **Worktree-only skill.** Виконується **виключно** в окремому git-worktree (`.worktrees/<current-branch>-fix-tests/`) і **не** паралелиться — один інстанс за раз.

**Крок 0 — preflight (обовʼязковий, перед будь-якими іншими діями).** Якщо перевірка падає — **STOP**: не питай користувача про назву гілки, а сам створи worktree від поточної гілки за конвенцією `<current-branch>-fix-tests`. Суфікс `fix-tests` — коротка (до 10 символів) транслітерація задачі. Не виконуй **жоден** наступний крок скіла, поки preflight не завершився успіхом.

```bash
git rev-parse --show-toplevel
git branch --show-current
```

Якщо перша команда показала, що ти **не** в `.worktrees/`, візьми вивід другої команди як `<current-branch>` і виконай **literal-команди без shell expansion** (без command substitution, variable expansion чи backticks). Наприклад, якщо поточна гілка `feature/x`:

```bash
npx @nitra/cursor worktree add "feature/x-fix-tests" "n-fix-tests: worktree-only skill"
cd ".worktrees/feature-x-fix-tests"
```

Тобто branch-argument лишає slash як у git-гілці, а шлях для `cd` бере sanitized форму: slash → `-`.
<!-- n-cursor:worktree:end -->

# n-fix-tests — підвищення mutation score

## Мета

Читає структурований JSON-блок вцілілих мутантів з `COVERAGE.md` і ітеративно дописує тести що їх вловлюють. Зупиняється коли score перестає покращуватись (конвергенція).

## Передумови

- У `COVERAGE.md` є секція `## Вцілілі мутанти` з JSON-блоком
- Залежності встановлені (`bun i`)
- `bun run coverage` (або `n-cursor coverage`) доступний

## Workflow

### Крок 1: Зчитай вцілілих мутантів

Прочитай `COVERAGE.md`. Знайди секцію `## Вцілілі мутанти`. Знайди огороджений блок ` ```json ` у цій секції і розбери JSON-масив.

Якщо секція відсутня або масив порожній — зупинись з повідомленням:
`✓ Жодних вцілілих мутантів — mutation score повний`

Запамʼятай поточну кількість вцілілих: `prevCount = масив.length`

### Крок 2: Знайди test-команду і coverage-команду

Прочитай `package.json` у кореневій директорії.

**test-команда** (перша що існує):

1. `scripts["test"]` з `package.json`
2. fallback: `bun test`

**coverage-команда** (перша що існує):

1. `scripts["coverage"]` з `package.json` → виклик: `bun run coverage`
2. fallback: `n-cursor coverage`

### Крок 3: Для кожного файлу — запускає Agent

Згрупуй мутанти по полю `file`. Для кожної групи виконай:

**3a. Знайди / визнач test файл (завжди у `tests/` директорії):**

Цільовий файл завжди: `<dir>/tests/<basename>.test.mjs`
(де `<dir>` — директорія source-файлу, `<basename>` — ім'я без розширення)

- Source: `<cwd>/<file>` (прочитай вміст)
- Test файл:
  1. Якщо `<dir>/tests/<basename>.test.mjs` існує → використай його
  2. Якщо `<dir>/<basename>.test.js` або `<dir>/<basename>.test.mjs` існує (co-located) →
     - Перенеси файл до `<dir>/tests/<basename>.test.mjs`
     - Оновити відносні `import` шляхи якщо є (тепер треба `../` рівень вгору)
  3. Якщо жоден не знайдено → буде створено `<dir>/tests/<basename>.test.mjs`

**3b. Сформуй промпт для Agent:**

```
Тобі дані вцілілі мутанти зі Stryker для файлу `<file>`.
Ці мутанти вціліли, тому що наявні тести НЕ вловили конкретні зміни коду.

**Вихідний код** (`<file>`):
\`\`\`
<зміст source-файлу>
\`\`\`

**Наявні тести** (`<test-file>`):
\`\`\`
<зміст test-файлу або "файл ще не існує">
\`\`\`

**Вцілілі мутанти** (кожен — зміна коду що НЕ вловлена):
<для кожного мутанта:>
- Рядок <line>, колонка <col>: `<original>` → `<replacement>` (тип мутації: <mutantType>)

**Завдання:**
Допиши мінімальні test-cases у файл `<test-file>` які б вловили кожен із перелічених мутантів.
Правила:
- НЕ видаляй і НЕ змінюй наявні тести
- Стиль тестів — відповідно до наявного файлу (той самий фреймворк, той самий стиль describe/test)
- Якщо файл ще не існує — створи `<dir>/tests/<basename>.test.mjs` з правильними імпортами.
  Приклад: source `src/services/auth-store.js` → test `src/services/tests/auth-store.test.mjs`,
  import: `import { ... } from '../auth-store.js'`
- Після написання запусти: `bun test <test-file>` і переконайся що всі тести проходять (виправ якщо падають)
```

**3c. Запусти Agent** з цим промптом і дочекайся завершення.

### Крок 4: Перевір що всі тести проходять

```bash
bun test  # або test-команда з кроку 2
```

Якщо тести падають — поверни конкретний Agent (для того файлу) з помилкою і попроси виправити.

### Крок 5: Запусти coverage і порівняй

```bash
bun run coverage  # або coverage-команда з кроку 2
```

Прочитай новий `COVERAGE.md`, знайди і розбери JSON-масив вцілілих.
`newCount = новий масив.length`

**Рішення:**

- Якщо `newCount < prevCount` → повтор з Кроку 1 з оновленим масивом
- Якщо `newCount >= prevCount` → зупинись:
  `✓ Конвергенція: mutation score більше не покращується. Вціліло: <newCount> мутантів.`

## Зупинка після конвергенції

Конвергенція — нормальний результат. Деякі мутанти не можна вбити (захищений зовнішнім станом, недетермінована логіка тощо). Не намагайся виправити те що не змінилось після ітерації.
