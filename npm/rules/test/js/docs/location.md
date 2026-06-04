# location.mjs

## Огляд

Модуль реалізує перевірку правила `test.mdc` щодо **розміщення тестових файлів** у JS-кодовій базі.

Конвенція: усі файли з суфіксом `.test.mjs` повинні лежати у каталозі `tests/`, що розташований поряд із джерельним файлом. Тобто для джерела `dir/foo.mjs` правильне розташування тесту — `dir/tests/foo.test.mjs`, а не `dir/foo.test.mjs`.

Особливості:

- Виключено `*_test.rego` — Rego unit-тести, за конвенцією OPA community, лежать поряд із полісі.
- Обхід дерева через `walkDir` автоматично пропускає `node_modules`, `.git`, `dist`, `build`, `.venv`, `venv`.
- Додатково ігноруються шляхи з `.n-cursor.json:ignore` (через `loadCursorIgnorePaths`).

Файл експортує асинхронну функцію `check`, яка призначена для запуску з кореня репозиторію (зазвичай через runner правил у `npm/rules/`). Повертає exit-код (0 — успіх, 1 — порушення), формуючи звіт через `createCheckReporter`.

## Експорти / API

| Експорт | Тип | Опис |
|---|---|---|
| `check` | `(cwdParam?: string) => Promise<number>` | Запуск перевірки розміщення `*.test.mjs`. Повертає exit-код. |

Внутрішні (не експортовані) допоміжні функції:

- `isTestFile(absPath: string): boolean`
- `isInsideTestsDir(absPath: string): boolean`

Внутрішня константа:

- `TESTS_DIR_NAME = 'tests'` — канонічна назва каталогу для тестів.

## Функції

### `isTestFile(absPath)`

- **Сигнатура:** `function isTestFile(absPath: string): boolean`
- **Параметри:**
  - `absPath` — абсолютний (або відносний — функція не залежить від форми) шлях до файла.
- **Повертає:** `true`, якщо `basename(absPath)` закінчується на `.test.mjs`, інакше `false`.
- **Side effects:** немає; функція чиста.
- **Використання:** фільтрує лише JS-тести; інші розширення (`.test.ts`, `_test.rego` тощо) ігноруються.

### `isInsideTestsDir(absPath)`

- **Сигнатура:** `function isInsideTestsDir(absPath: string): boolean`
- **Параметри:**
  - `absPath` — шлях до тестового файла.
- **Повертає:** `true`, якщо басенейм безпосередньої батьківської директорії дорівнює `tests` (значення `TESTS_DIR_NAME`).
- **Side effects:** немає; функція чиста.
- **Зауваження:** перевіряється саме безпосередній батько (`basename(dirname(absPath))`), а не наявність `tests/` будь-де у шляху. Тобто `pkg/tests/sub/foo.test.mjs` буде вважатися **поза** `tests/` (батько — `sub`, а не `tests`).

### `check(cwdParam = process.cwd())`

- **Сигнатура:** `export async function check(cwdParam?: string): Promise<number>`
- **Параметри:**
  - `cwdParam` *(опціонально)* — корінь репозиторію, з якого починається обхід. За замовчуванням — `process.cwd()`.
- **Повертає:** `Promise<number>` — exit-код від `reporter.getExitCode()`. За домовленістю з `createCheckReporter`: `0` — порушень немає, `1` — є порушення.
- **Side effects:**
  - Читання файлової системи: обхід дерева від `cwd` через `walkDir`.
  - Читання конфігурації: `.n-cursor.json` через `loadCursorIgnorePaths`.
  - Запис у `stdout` / `stderr`: повідомлення про `pass` / `fail` через `createCheckReporter` (формат повідомлень визначається репортером).
- **Алгоритм:**
  1. Створити репортер: `const reporter = createCheckReporter()`, дістати `pass` і `fail`.
  2. Завантажити список ігнорованих шляхів: `ignorePaths = await loadCursorIgnorePaths(cwd)`.
  3. Ініціалізувати лічильник `totalTests = 0` та масив `offenders: string[]`.
  4. Обійти дерево `walkDir(cwd, visitor, ignorePaths)`. Для кожного файла:
     - Якщо `!isTestFile(absPath)` — пропустити.
     - Інакше `totalTests++`.
     - Якщо `!isInsideTestsDir(absPath)` — додати **відносний** до `cwd` шлях у `offenders` (через `relative(cwd, absPath)`).
  5. Якщо `offenders.length === 0` — викликати `pass('Всі ${totalTests} файлів *.test.mjs у каталозі tests/ (test.mdc)')` і повернути `reporter.getExitCode()`.
  6. Інакше — для кожного `offenderPath`:
     - Обчислити `parentDir = dirname(offenderPath)` і `base = basename(offenderPath)`.
     - Викликати `fail` з повідомленням-підказкою: тест має лежати у `tests/` — рекомендований шлях `${parentDir}/tests/${base}` (з посиланням на правило `test.mdc`).
  7. Повернути `reporter.getExitCode()`.

## Залежності

### Стандартна бібліотека Node.js

- `node:path` — функції `basename`, `dirname`, `relative`.

### Внутрішні модулі репозиторію (відносні шляхи від `npm/rules/test/js/location.mjs`)

- `../../../scripts/lib/check-reporter.mjs` — фабрика репортерів `createCheckReporter()`, що повертає об'єкт з методами `pass(msg)`, `fail(msg)` та `getExitCode()`.
- `../../../scripts/lib/load-cursor-config.mjs` — `loadCursorIgnorePaths(cwd)`: повертає список глобів/шляхів, які слід пропустити при обході (зчитується з `.n-cursor.json`, ключ `ignore`).
- `../../../scripts/utils/walkDir.mjs` — асинхронний рекурсивний обхід дерева: `walkDir(rootDir, visitor, ignorePaths)`; за замовчуванням пропускає `node_modules`, `.git`, `dist`, `build`, `.venv`, `venv`.

### Зовнішні правила (концептуальні залежності)

- `test.mdc` — правило, що формалізує конвенцію розміщення тестів і на яке посилаються повідомлення `pass`/`fail`.

## Потік виконання / Використання

### Типове використання як перевірка правила

Файл є частиною системи перевірок (`npm/rules/test/js/`). Зазвичай викликається runner'ом, який знає про expor `check`:

```js
import { check } from './location.mjs'

process.exit(await check())
```

або з явним коренем:

```js
const code = await check('/path/to/repo')
```

### Послідовність виконання

1. Виклик `check()` (опційно з `cwdParam`).
2. Створення репортера → завантаження `ignorePaths`.
3. Однопрохідний обхід дерева від `cwd`:
   - на кожному кроці фільтр `isTestFile`,
   - інкремент `totalTests`,
   - перевірка `isInsideTestsDir`, накопичення `offenders`.
4. Звіт:
   - якщо `offenders.length === 0` — один `pass` з підсумком `totalTests`;
   - інакше — `fail` для кожного порушника з підказкою куди перенести.
5. Повернення exit-коду (`0` або `1`).

### Граничні випадки

- **Немає жодного `*.test.mjs`:** `totalTests === 0`, `offenders === []` — буде успішний `pass('Всі 0 файлів *.test.mjs у каталозі tests/ (test.mdc)')`.
- **Тест у вкладеному каталозі `tests/`:** наприклад, `dir/tests/sub/foo.test.mjs` — буде вважатися порушенням, бо безпосередній батько — `sub`, а не `tests`.
- **Файли з частковим суфіксом:** `foo.test.mjs.bak` — не вважається тестом (не закінчується на `.test.mjs`).
- **Шляхи з `.n-cursor.json:ignore`** не відвідуються `walkDir` і не впливають на лічильники.

### Rebuild Test

Для верифікації коректності документації — мисленний rebuild:

- Дано: дерево з файлами `a/foo.test.mjs`, `a/tests/bar.test.mjs`, `b/baz.test.mjs`.
- Очікувано: `totalTests === 3`; `offenders === ['a/foo.test.mjs', 'b/baz.test.mjs']`; два виклики `fail`; exit-код `1`.
- Повідомлення `fail` для `a/foo.test.mjs` міститимуть підказку: `a/foo.test.mjs: тест має лежати у tests/ — перенеси у a/tests/foo.test.mjs (test.mdc)`.
