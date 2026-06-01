---
name: n-coverage-fix
description: >-
  Автономна команда: запускає n-cursor coverage → читає вцілілих мутантів → ітеративно пише тести до конвергенції (max 3 ітерації)
---

<!-- n-cursor:worktree:start -->
> [!IMPORTANT]
> **Worktree-only skill.** Виконується **виключно** в окремому git-worktree (`.worktrees/<current-branch>-coverage-f/`) і **не** паралелиться — один інстанс за раз.

**Крок 0 — preflight (обовʼязковий, перед будь-якими іншими діями).** Якщо перевірка падає — **STOP**: не питай користувача про назву гілки, а сам створи worktree від поточної гілки за конвенцією `<current-branch>-coverage-f`. Суфікс `coverage-f` — коротка (до 10 символів) транслітерація задачі. Не виконуй **жоден** наступний крок скіла, поки preflight не завершився успіхом.

```bash
git rev-parse --show-toplevel
git branch --show-current
```

Якщо перша команда показала, що ти **не** в `.worktrees/`, візьми вивід другої команди як `<current-branch>` і виконай **literal-команди без shell expansion** (без command substitution, variable expansion чи backticks). Наприклад, якщо поточна гілка `feature/x`:

```bash
npx @nitra/cursor worktree add "feature/x-coverage-f" "n-coverage-f: worktree-only skill"
cd ".worktrees/feature-x-coverage-f"
```

Тобто branch-argument лишає slash як у git-гілці, а шлях для `cd` бере sanitized форму: slash → `-`.
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

### Крок 1: Запусти coverage

```bash
n-cursor coverage
```

Або якщо є у `package.json#scripts`:

```bash
bun run coverage
```

Ця команда генерує `COVERAGE.md`. Якщо є survived mutants — COVERAGE.md матиме секцію `## Вцілілі мутанти` з JSON-блоком.

### Крок 2: Перевір вцілілих

Прочитай `COVERAGE.md`. Знайди секцію `## Вцілілі мутанти`. Знайди огороджений блок ` ```json ` і розбери JSON-масив.

Якщо секція відсутня або масив порожній — зупинись:

```
✓ Жодних вцілілих мутантів — mutation score повний. Coverage завершено.
```

Запам'ятай `prevCount = масив.length`.

### Крок 3: Для кожного файлу — запускає Agent

Згрупуй мутанти по полю `file`. Для кожної групи:

**3a. Визнач test файл (завжди у `tests/` директорії):**

Цільовий: `<dir>/tests/<basename>.test.mjs`
(де `<dir>` — директорія source-файлу, `<basename>` — ім'я source без розширення)

1. Якщо `<dir>/tests/<basename>.test.mjs` існує → використай
2. Якщо `<dir>/<basename>.test.js` або `<dir>/<basename>.test.mjs` існує (co-located) →
   - Перенеси до `<dir>/tests/<basename>.test.mjs`
   - Оновити відносні imports (тепер `../` рівень вгору до source)
3. Жоден не знайдено → буде створено `<dir>/tests/<basename>.test.mjs`

**3b. Сформуй промпт для Agent:**

```
Тобі дані вцілілі мутанти зі Stryker для файлу `<file>`.
Ці мутанти вціліли, бо наявні тести НЕ вловили конкретні зміни коду.

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
- Рядок <line>, колонка <col>: `<original>` → `<replacement>` (тип: <mutantType>)

**Завдання:**
Допиши мінімальні test-cases у файл `<test-file>` які вловлять кожен мутант.
Правила:
- НЕ видаляй і НЕ змінюй наявні тести
- Стиль тестів — відповідно до наявного файлу (той самий фреймворк, describe/test)
- Якщо файл ще не існує — створи `<dir>/tests/<basename>.test.mjs` з правильними імпортами.
  Приклад: source `src/services/auth-store.js` → import `import { ... } from '../auth-store.js'`
- Після написання запусти: `bun test <test-file>` і переконайся що тести проходять (виправ якщо падають, 1-2 спроби)
```

**3c. Запусти Agent** з цим промптом. Дочекайся завершення.

### Крок 4: Перевір що всі тести проходять

```bash
bun test
```

Якщо падають — поверни відповідний Agent з помилкою і попроси виправити.

### Крок 5: Запусти coverage і порівняй

```bash
n-cursor coverage
```

Прочитай новий `COVERAGE.md`. Розбери JSON-масив вцілілих.
`newCount = новий масив.length`

**Рішення:**

- `newCount < prevCount` AND iterations < 3 → повтор з Кроку 2 з оновленим масивом
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
