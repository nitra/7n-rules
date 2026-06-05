# state-store.mjs

## Огляд

Модуль `state-store.mjs` реалізує **crash-safe сховище runtime-стану `flow`** (відповідно до spec §4 та §4.1 правила `n-flow`). Він зберігає поточний стан виконання worktree-флоу у вигляді JSON-файла, гарантує атомарність запису та fail-closed поведінку при пошкодженні даних.

Ключові архітектурні рішення:

- **Sibling-файл, а не файл усередині worktree.** Файл стану розміщується **поруч** із checkout-директорією worktree, а не всередині неї. Для checkout-директорії `…/.worktrees/feat-x` файл стану — `…/.worktrees/feat-x.flow.json`. Причина: файл усередині worktree був би `untracked` у feature-гілці й міг би випадково потрапити у `git add -A`.
- **Атомарний запис** — через temp-файл на тому самому файловому системному рівні, `fsync` даних і атомарний `rename` (POSIX-гарантія: операція або повністю успішна, або не відбулась).
- **Fail-closed на corruption** — будь-яка некоректність (невалідний JSON, несумісний `schema_version`) призводить до `throw`, а не до тихого скидання стану. Принцип: краще зупинити flow, ніж стартувати новий поверх зіпсованого стану.
- **WAL-перехід** — пара `appendEvent` (журнал) → `updateState` (snapshot). Журнал — джерело істини для reconcile при `resume`, snapshot — швидкий зріз поточного стану.
- **Усі шляхи абсолютні** — вимога правила `no-relative-fs-path`. Кожна публічна функція робить `isAbsolute()`-перевірку й кидає, якщо їй передали відносний шлях.

## Експорти / API

| Експорт                                                             | Тип                    | Призначення                                                                              |
| ------------------------------------------------------------------- | ---------------------- | ---------------------------------------------------------------------------------------- |
| `SCHEMA_VERSION`                                                    | `const number` (= `1`) | Поточна версія схеми JSON-стану. Несумісність → fail-closed read.                        |
| `flowStatePath(worktreeDir)`                                        | function               | Дериватор шляху sibling-файла стану з абсолютного шляху worktree-checkout.               |
| `writeState(statePath, state)`                                      | function               | Атомарний запис стану з автоматичним проставленням `schema_version`.                     |
| `readState(statePath)`                                              | function               | Читання стану з валідацією `schema_version`; `null`, якщо файлу нема.                    |
| `updateState(statePath, fn)`                                        | function               | Read-modify-write: читає, прогонить через трансформер `fn`, атомарно пише.               |
| `removeState(statePath)`                                            | function               | Ідемпотентне видалення sibling-файла стану.                                              |
| `recordTransition({ statePath, eventsPath }, event, stateFn, now?)` | function               | WAL-перехід: спершу `appendEvent`, потім `updateState`.                                  |
| `cleanupFlowSiblings(worktreeDir)`                                  | function               | Видалення всіх runtime-sibling-ів worktree (`.flow.json`, `.events.jsonl`, лок-каталог). |

## Функції

### `flowStatePath(worktreeDir)`

**Сигнатура:** `(worktreeDir: string) => string`

**Параметри:**

- `worktreeDir` — абсолютний шлях checkout-директорії worktree (наприклад, `…/.worktrees/feat-x`).

**Повертає:** Абсолютний шлях sibling-файла стану виду `…/.worktrees/feat-x.flow.json`.

**Логіка:** Бере `dirname(worktreeDir)` (батьківську теку, як правило `.worktrees/`) і конкатенує з `basename(worktreeDir) + '.flow.json'`.

**Помилки:** `Error('flowStatePath: очікується абсолютний шлях …')` — якщо `worktreeDir` не абсолютний.

**Side effects:** Немає (чиста функція над шляхами).

---

### `fsyncPath(path)` (внутрішня)

**Сигнатура:** `(path: string) => void`

**Параметри:**

- `path` — абсолютний шлях до файла або каталогу, який треба `fsync`-нути.

**Повертає:** `void`.

**Логіка:** Відкриває файл/каталог у режимі читання (`openSync(path, 'r')`), викликає `fsyncSync(fd)`, у `finally` закриває дескриптор через `closeSync`.

**Side effects:** Системний виклик `fsync` — гарантує, що дані файла записані на фізичний носій (необхідно перед `rename`, щоб уникнути ситуації, коли rename видно, а вміст ще в буфері).

**Примітка:** Функція приватна (не експортується), використовується лише `writeState`.

---

### `writeState(statePath, state)`

**Сигнатура:** `(statePath: string, state: object) => object`

**Параметри:**

- `statePath` — абсолютний шлях кінцевого файла стану (`.flow.json`).
- `state` — об'єкт стану **без** поля `schema_version` (воно проставляється автоматично).

**Повертає:** Фактично записаний об'єкт виду `{ schema_version: SCHEMA_VERSION, ...state }`.

**Алгоритм (атомарний запис):**

1. Перевірка абсолютності шляху → `throw`, якщо відносний.
2. `mkdirSync(dir, { recursive: true })` — гарантуємо існування батьківської теки.
3. Збираємо `payload = { schema_version: SCHEMA_VERSION, ...state }`.
4. Генеруємо унікальне ім'я temp-файла: `.${basename(statePath)}.${pid}.${randomHex6}.tmp` у тій самій теці (важливо — той самий FS, щоб `rename` був атомарним).
5. `writeFileSync(tmp, JSON.stringify(payload, null, 2) + '\n', 'utf8')`.
6. `fsyncPath(tmp)` — flush даних temp-файла на диск.
7. `renameSync(tmp, statePath)` — атомарна заміна.
8. Best-effort `fsyncPath(dir)` — fsync батьківського каталогу для durability rename. На Windows може кинути `EISDIR`/`EPERM` — помилка проковтується (некритично).

**Помилки:** `Error('writeState: очікується абсолютний шлях …')` — якщо `statePath` не абсолютний. Інші помилки I/O (нема прав, диск повний тощо) пробрасуються нагору.

**Side effects:**

- Створення батьківської теки (якщо її нема).
- Створення й видалення temp-файла з PID та випадковим суфіксом.
- Перейменування `tmp → statePath`.
- `fsync` файла та (best-effort) каталогу.

---

### `readState(statePath)`

**Сигнатура:** `(statePath: string) => object | null`

**Параметри:**

- `statePath` — абсолютний шлях `.flow.json`.

**Повертає:**

- `null`, якщо файлу не існує (нормальна ситуація: flow ще не починався).
- Розпарсений об'єкт стану — за успішного читання й валідації.

**Алгоритм:**

1. Перевірка абсолютності шляху.
2. `existsSync(statePath)` → `false` → повертаємо `null`.
3. `readFileSync(statePath, 'utf8')`.
4. Спроба `JSON.parse(raw)`; якщо `SyntaxError` → `throw` з повідомленням `пошкоджений стан (невалідний JSON) … fail-closed`.
5. Валідація типу й `schema_version`: якщо не об'єкт, `null`, або `schema_version !== SCHEMA_VERSION` → `throw` `несумісний або пошкоджений schema_version … fail-closed`.
6. Повертаємо розпарсений об'єкт.

**Помилки:**

- `Error('readState: очікується абсолютний шлях …')`.
- `Error('readState: пошкоджений стан (невалідний JSON) … fail-closed')` (§4.1.6).
- `Error('readState: несумісний або пошкоджений schema_version … fail-closed')` (§4.1.6).

**Side effects:** Тільки читання файла (без модифікацій).

---

### `updateState(statePath, fn)`

**Сигнатура:** `(statePath: string, fn: (state: object) => object) => object`

**Параметри:**

- `statePath` — абсолютний шлях `.flow.json`.
- `fn` — функція-трансформер: приймає поточний стан (або `{}`, якщо файла нема) і повертає новий стан.

**Повертає:** Записаний об'єкт (результат `writeState`).

**Алгоритм:**

1. `current = readState(statePath)`.
2. `next = fn(current ?? {})` — якщо файла не існує, `fn` отримує порожній об'єкт.
3. `return writeState(statePath, next)`.

**Помилки:** Будь-яке пробивання з `readState` чи `writeState`. Окрім того, помилки всередині `fn` пробросяться як є.

**Side effects:** Read-modify-write — повний цикл (читання → трансформ → атомарний запис).

---

### `removeState(statePath)`

**Сигнатура:** `(statePath: string) => void`

**Параметри:**

- `statePath` — абсолютний шлях `.flow.json`.

**Повертає:** `void`.

**Алгоритм:** `rmSync(statePath, { force: true })` — ідемпотентно (відсутній файл не помилка).

**Помилки:** `Error('removeState: очікується абсолютний шлях …')`.

**Side effects:** Видалення sibling-файла стану.

**Контекст використання:** Cleanup при `worktree remove` або `flow cancel`.

---

### `recordTransition({ statePath, eventsPath }, event, stateFn, now?)`

**Сигнатура:** `({ statePath: string, eventsPath: string }, event: object, stateFn: (state: object) => object, now?: () => number) => object`

**Параметри:**

- `paths.statePath` — абсолютний шлях `.flow.json`.
- `paths.eventsPath` — абсолютний шлях журналу подій `.events.jsonl`.
- `event` — об'єкт події переходу (формат визначається `appendEvent`).
- `stateFn` — трансформер стану (як у `updateState`).
- `now` — фабрика поточного часу в ms (за замовчуванням `Date.now`); використовується для тестів.

**Повертає:** Записаний стан (результат `updateState`).

**Алгоритм (WAL-перехід, §4.1.2):**

1. `appendEvent(eventsPath, event, now)` — спершу **журнал** (durable WAL-запис події).
2. `updateState(statePath, stateFn)` — потім snapshot.

**Гарантія:** Якщо крок 2 впаде, подія в журналі вже durable; на `resume` reconcile-логіка зможе відновити стан зі snapshot + хвоста журналу.

**Side effects:** Дописування в `.events.jsonl` та атомарний read-modify-write `.flow.json`.

---

### `cleanupFlowSiblings(worktreeDir)`

**Сигнатура:** `(worktreeDir: string) => void`

**Параметри:**

- `worktreeDir` — абсолютний шлях checkout-директорії worktree (`…/.worktrees/feat-x`).

**Повертає:** `void`.

**Алгоритм:** Для `base = basename(worktreeDir)` та `dir = dirname(worktreeDir)` видаляє:

1. `<dir>/<base>.flow.json` — sibling-snapshot стану.
2. `<dir>/<base>.events.jsonl` — sibling-журнал подій.
3. `<dir>/.flow-lock-<base>/` — лок-каталог (з `recursive: true`).

Усі `rmSync` з `force: true` — ідемпотентні.

**Помилки:** `Error('cleanupFlowSiblings: очікується абсолютний шлях …')`.

**Side effects:** Видалення трьох sibling-артефактів. Викликається з `flow cancel` та `worktree remove`. Інакше sibling-и осиротіють — git їх не чистить (бо вони поза worktree).

## Залежності

### Node.js stdlib

- `node:fs` — `closeSync`, `existsSync`, `fsyncSync`, `mkdirSync`, `openSync`, `readFileSync`, `renameSync`, `rmSync`, `writeFileSync`.
- `node:path` — `basename`, `dirname`, `isAbsolute`, `join`.
- `node:crypto` — `randomBytes` (унікальне ім'я temp-файла).
- `node:process` — `pid` (також для унікальності temp-імені, особливо при паралельних процесах).

### Внутрішні залежності модуля

- `./events.mjs` — функція `appendEvent(eventsPath, event, now)`. Використовується лише в `recordTransition`.

### Логічні залежності (через дизайн, не через `import`)

- Spec `n-flow` §4, §4.1, §4.1.2, §4.1.6 — формальні вимоги до crash-safety та fail-closed.
- Конвенція розміщення worktree: усі worktree під `.worktrees/<branch>/`; sibling-файли — на одному рівні з checkout.

## Потік виконання / Використання

### Типовий життєвий цикл стану flow

```
1. Старт flow:
   const statePath = flowStatePath('/abs/path/.worktrees/feat-x')
   //   → '/abs/path/.worktrees/feat-x.flow.json'

2. Перший запис (initial state):
   writeState(statePath, { stage: 'init', step: 0 })
   //   → файл містить { schema_version: 1, stage: 'init', step: 0 }

3. Перехід стану з журналюванням (WAL):
   recordTransition(
     { statePath, eventsPath: statePath.replace('.flow.json', '.events.jsonl') },
     { type: 'stage_advanced', from: 'init', to: 'apply' },
     (s) => ({ ...s, stage: 'apply', step: s.step + 1 })
   )

4. Read-modify-write без події (рідко):
   updateState(statePath, (s) => ({ ...s, last_seen_at: Date.now() }))

5. Читання при resume:
   const state = readState(statePath)
   if (state === null) { /* новий flow */ }
   else { /* відновлення з state */ }

6. Cleanup на завершення / cancel:
   cleanupFlowSiblings('/abs/path/.worktrees/feat-x')
   // → видалить feat-x.flow.json, feat-x.events.jsonl, .flow-lock-feat-x/
```

### Гарантії crash-safety

- **Crash під час `writeFileSync(tmp, …)`** — кінцевий файл `statePath` залишається попередньою версією; temp-файл — orphan (буде перезаписаний при наступному запуску завдяки `pid + randomBytes`).
- **Crash між `writeFileSync` і `fsyncPath(tmp)`** — temp-файл може бути порожнім/частковим, але `rename` ще не виконано — `statePath` цілий.
- **Crash між `fsyncPath(tmp)` і `renameSync`** — temp-файл цілий і durable, але не на місці; `statePath` цілий.
- **Crash під час `renameSync`** — POSIX гарантує атомарність: або `statePath` — старий вміст, або новий, **ніколи частковий**.
- **Crash після `renameSync` до fsync каталогу** — на більшості FS rename вже durable; fsync каталогу — best-effort страховка.

### Fail-closed reading

При `readState`:

- **Файл порожній / не JSON** → `throw 'пошкоджений стан (невалідний JSON) … fail-closed'`. Адмін має вручну інспектувати журнал подій та прийняти рішення (replay або видалення).
- **`schema_version` відсутня / інша** → `throw 'несумісний або пошкоджений schema_version … fail-closed'`. Захищає від запуску нової версії dispatcher над станом старого формату й навпаки.

### Контекст у dispatcher

Модуль є інфраструктурною частиною `npm/scripts/dispatcher/`. Виклики йдуть із вищих шарів (стейт-машини flow, CLI-команди `flow start/resume/cancel`, обробники сигналів). Модуль сам не керує життєвим циклом — він лише надає примітиви read/write/update/remove/transition та шляхові деривації.

## Rebuild Test

Документація містить достатньо інформації, щоб відновити функціональність модуля з нуля:

- Точні імпорти з Node stdlib та локального `./events.mjs`.
- Константу `SCHEMA_VERSION = 1`.
- Сім публічних функцій з повними сигнатурами, валідацією аргументів, алгоритмами та повідомленнями про помилки.
- Внутрішню helper-функцію `fsyncPath` зі сценарієм використання.
- Точну схему атомарного запису (temp у тій самій теці → write → fsync → rename → best-effort fsync каталогу).
- Точну схему fail-closed reading (`null` для відсутнього файла, throw для пошкодженого/несумісного).
- WAL-послідовність `appendEvent` → `updateState` у `recordTransition`.
- Перелік усіх трьох sibling-артефактів для `cleanupFlowSiblings` (`.flow.json`, `.events.jsonl`, `.flow-lock-<base>/`).
- Дериватор `flowStatePath`: `join(dirname(worktreeDir), basename(worktreeDir) + '.flow.json')`.
