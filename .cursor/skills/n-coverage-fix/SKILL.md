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
