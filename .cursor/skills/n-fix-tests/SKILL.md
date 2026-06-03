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

**Крок 0.1 — bootstrap у новому дереві (після `cd`, окремий крок — поза «без-expansion» блоком вище).** Дерево щойно створене й **без** `node_modules`. Спершу постав залежності локально: тоді `npx` бере локальну копію `@nitra/cursor` і гонки з CDN немає взагалі. Retry-обгортка нижче — safety-net на випадок, коли версію щойно опубліковано, але edge-кеш CDN ще її не має: `npm` тоді падає з `ETARGET`/`notarget` **до** запуску бінарника (внутрішній JS-retry у `n-cursor` для цього кейсу марний — бінарник ще не стартував).

```bash
# Локальна копія @nitra/cursor (девзалежність споживача) — npx бере її, без походу в реєстр.
bun install

# n_cursor_npx <args> — обгортка bootstrap-виклику "npx @nitra/cursor <args>".
# Ретраїмо ЛИШЕ транзитні помилки реєстру/мережі (CDN ще не пропагував щойно
# опубліковану версію). Реальний nonzero від CLI (fix повернув ❌, lint-помилка) —
# віддаємо одразу, без ретраю. Інтервал 30с; дефолт-ліміт 5 хв
# (env N_CURSOR_NPX_RETRY_MAX_MIN), hard-ceiling 10 хв.
# Чому 5 хв: CDN-пропагація npm зазвичай < 2 хв, 5 хв — запас; довше → ймовірно
# реальна проблема (невірна версія / аутейдж), краще віддати помилку, ніж висіти.
n_cursor_npx() {
  max_min="${N_CURSOR_NPX_RETRY_MAX_MIN:-5}"
  case "$max_min" in '' | *[!0-9]*) max_min=5 ;; esac
  [ "$max_min" -gt 10 ] && max_min=10
  deadline=$(( $(date +%s) + max_min * 60 ))
  attempt=1
  transient='ETARGET|notarget|No matching version|ENOTFOUND|ETIMEDOUT|EAI_AGAIN|ECONNRESET|50[0-9] |502 Bad Gateway|503 Service Unavailable|504 Gateway'
  while :; do
    err=$(mktemp)
    npx @nitra/cursor "$@" 2>"$err"
    code=$?
    cat "$err" >&2
    [ "$code" -eq 0 ] && { rm -f "$err"; return 0; }
    if grep -Eq "$transient" "$err" && [ "$(date +%s)" -lt "$deadline" ]; then
      rm -f "$err"
      echo "n-cursor: очікую пропагації версії по CDN… спроба $attempt, повтор через 30с" >&2
      attempt=$((attempt + 1))
      sleep 30
    else
      rm -f "$err"
      return "$code"
    fi
  done
}
```

Усі подальші bootstrap-виклики `npx @nitra/cursor <cmd>` у цій сесії роби через `n_cursor_npx <cmd>`. Якщо опинився у свіжому shell без цієї функції — спершу повтори блок вище (`bun install` + визначення `n_cursor_npx`).
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
