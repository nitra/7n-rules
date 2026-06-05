# changed-files.mjs

## Огляд

Модуль `changed-files.mjs` — допоміжна бібліотека для збору переліку змінених файлів у робочому дереві git-репозиторію. Використовується lint-оркестратором у quick-режимі та `coverage --changed` для визначення scope-у файлів, на яких потрібно прогнати перевірки.

Логіка модуля:

- збирає tracked-modified та staged файли через `git diff` (з `--diff-filter=ACMR`, тобто Added/Copied/Modified/Renamed — без Deleted);
- додає untracked файли через `git ls-files --others --exclude-standard` (з повагою до `.gitignore`);
- дедуплікує об'єднаний список через `Set`;
- повертає relative-posix шляхи відносно `cwd`;
- поза git-репо або при помилці git мовчки повертає порожній список (для `gitLines`);
- для режиму "since base" — fail-closed: якщо базовий комміт недосяжний, кидає явну помилку, щоб gate не пройшов мовчки.

Видалені файли свідомо не включаються — лінтити неіснуючий файл немає сенсу.

## Експорти / API

Модуль експортує дві функції:

| Експорт                    | Тип                                                | Призначення                                                                                                                  |
| -------------------------- | -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `collectChangedFiles`      | `(cwd?: string) => string[]`                       | Список змінених + untracked файлів робочого дерева відносно `HEAD`.                                                          |
| `collectChangedFilesSince` | `(base: string \| null, cwd?: string) => string[]` | Список змінених + untracked файлів **відносно довільного базового комміту**. Без `base` — fallback на `collectChangedFiles`. |

Внутрішня (неекспортована) функція:

| Внутрішнє  | Тип                                         | Призначення                                                                                    |
| ---------- | ------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `gitLines` | `(args: string[], cwd: string) => string[]` | Виконує `git <args>` у `cwd` і повертає непорожні trim-нуті рядки stdout або `[]` при помилці. |

## Функції

### `gitLines(args, cwd)` (internal)

Виклик git-команди з парсингом stdout у масив рядків.

- **Сигнатура:** `function gitLines(args: string[], cwd: string): string[]`
- **Параметри:**
  - `args` — масив аргументів для `git` (наприклад `['diff', 'HEAD', '--name-only']`).
  - `cwd` — робоча директорія для процесу `git`.
- **Повертає:** масив непорожніх рядків stdout (після `trim`). Якщо `r.status !== 0` або є `r.error` — повертає `[]`.
- **Side effects:**
  - Синхронно спавнить процес `git` через `spawnSync` з `node:child_process`;
  - не пише в stdout/stderr батьківського процесу (всі потоки збираються через `encoding: 'utf8'`);
  - не кидає винятків — fail-silent.

### `collectChangedFiles(cwd?)`

Збирає список змінених + untracked файлів робочого дерева відносно `HEAD`.

- **Сигнатура:** `function collectChangedFiles(cwd?: string): string[]`
- **Параметри:**
  - `cwd` (опційно, дефолт `process.cwd()`) — корінь git-репо.
- **Алгоритм:**
  1. `git diff HEAD --name-only --diff-filter=ACMR` — повертає всі tracked файли, які відрізняються від `HEAD` (staged + unstaged), фільтр `ACMR` відсікає Deleted.
  2. `git ls-files --others --exclude-standard` — повертає untracked файли, які не ігноруються `.gitignore`.
  3. Об'єднання обох списків через `new Set([...modified, ...untracked])` для дедуплікації.
- **Повертає:** `string[]` — унікальні relative-posix шляхи без видалених файлів.
- **Поведінка поза git-репо / при помилці:** `gitLines` мовчки повертає `[]` для обох викликів, тож результат — порожній масив.

### `collectChangedFilesSince(base, cwd?)`

Збирає список змінених + untracked файлів відносно довільного базового комміту. Призначено для сценаріїв, де базовий комміт зафіксовано у стані flow-турнікета (executor комітить кожен крок, тож потрібно ловити зміни «від base», а не «від HEAD»).

- **Сигнатура:** `function collectChangedFilesSince(base: string | null, cwd?: string): string[]`
- **Параметри:**
  - `base` — SHA/ref базового комміту (типово `metadata.base_commit` зі стану flow). Якщо `null`/`undefined`/порожній — fallback на `collectChangedFiles(cwd)`.
  - `cwd` (опційно, дефолт `process.cwd()`) — корінь git-репо.
- **Алгоритм:**
  1. Якщо `base` falsy — повертає результат `collectChangedFiles(cwd)`.
  2. Перевіряє досяжність base через `git rev-parse --verify --quiet <base>^{commit}`.
  3. Якщо verify не успішний (`status !== 0` або `error`) — **кидає `Error`** з повідомленням: `collectChangedFilesSince: base-комміт «<base>» недосяжний у <cwd> (rebase/force-update?) — coverage --changed не може визначити scope`.
  4. `git diff <base> --name-only --diff-filter=ACMR` — **без** `..`/`...`, **без** `HEAD`. Така форма порівнює base-комміт із поточним **робочим деревом**, тобто ловить одночасно: закомічене від base, staged та незакомічені модифікації.
  5. `git ls-files --others --exclude-standard` — untracked файли (як у `collectChangedFiles`).
  6. Дедуплікація через `Set`.
- **Повертає:** `string[]` — унікальні relative-posix шляхи без видалених файлів.
- **Контракт fail-closed:** на відміну від `collectChangedFiles`, ця функція **навмисно** не маскує помилку недосяжного base. Інакше `git diff` повернув би exit 128, `gitLines` дав би `[]`, і gate мовчки пройшов би без перевірки — це порушує безпеку coverage-перевірки.
- **Side effects:**
  - спавнить два-три git-процеси (один verify + два data-збори, або один fallback);
  - може кинути `Error` (єдина точка throw у модулі).

## Залежності

### Зовнішні (built-in Node.js)

- `node:child_process` — імпорт `spawnSync` для синхронного виклику git-команд із захопленням stdout.

### Системні (runtime)

- `git` — має бути доступний у `PATH` процесу. За відсутності `gitLines` поверне `[]` (через `r.error`/ненульовий статус).

### Внутрішні модулі

Файл не імпортує жодного локального модуля проєкту (zero-dependency бібліотечний листок).

## Потік виконання / Використання

### Quick-lint (lint-оркестратор)

```js
import { collectChangedFiles } from './changed-files.mjs'

const files = collectChangedFiles()
// → лінт тільки цих файлів, замість обходу всього монорепо
```

Quick-режим прагне мінімізувати IO: лінтить лише те, що користувач щойно змінив у дереві (modified + staged + untracked), ігноруючи решту репо.

### Coverage / flow-турнікет

```js
import { collectChangedFilesSince } from './changed-files.mjs'

const base = metadata.base_commit // SHA, зафіксований при старті flow-кроку
const scope = collectChangedFilesSince(base, repoRoot)
// → файли, які змінилися з моменту base, незалежно від того,
//   чи їх вже закомічено в проміжних кроках executor-а
```

Чому саме `git diff <base>` без `..`/`...`:

- `git diff A..B` — порівнює дерева A та B, **ігнорує** робоче дерево;
- `git diff A...B` — порівнює B з merge-base(A,B), теж ігнорує робоче дерево;
- `git diff <base>` (один аргумент) — порівнює `<base>` із **робочим деревом** (включно з unstaged змінами).

Це критично для flow-турнікета, де executor може як комітити проміжні зміни, так і залишати їх unstaged — gate повинен побачити всі зміни від `base` однаково.

### Поведінка при недосяжному base

Якщо у репозиторії стався rebase, force-push або shallow clone обрізав історію — `<base>` може стати недосяжним. У такому разі:

- `collectChangedFiles` (без base) — поведінка незмінна, працює від `HEAD`;
- `collectChangedFilesSince(base, cwd)` — **кидає Error** до того, як викликати `git diff`, щоб coverage-gate явно впав, а не пройшов на порожньому scope.

### Формат шляхів

Усі повернені шляхи — POSIX-style relative до `cwd` (як їх віддає git за замовчуванням). На Windows git також віддає forward slashes, тож додаткової нормалізації немає.

### Точки помилок (summary)

| Сценарій                                      | Поведінка                                                                                                                          |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Поза git-репо                                 | `collectChangedFiles` → `[]`; `collectChangedFilesSince(null)` → `[]`; `collectChangedFilesSince('SHA')` → `Error` (verify впаде). |
| `git` відсутній у PATH                        | Усі виклики `gitLines` → `[]`; `collectChangedFilesSince` із `base` → `Error` (verify впаде).                                      |
| `base` досяжний                               | `collectChangedFilesSince` повертає список (можливо порожній).                                                                     |
| `base` недосяжний (rebase/force-push/shallow) | `collectChangedFilesSince` кидає `Error`.                                                                                          |
| `base` falsy (`null`/`undefined`/`''`/`0`)    | `collectChangedFilesSince` → результат `collectChangedFiles(cwd)`.                                                                 |
