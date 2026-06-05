# flow-lock.mjs

## Огляд

Модуль `flow-lock.mjs` надає тонку обгортку над спільною утилітою `withLock` для серіалізації мутацій стану `flow` у межах конкретного git worktree (per-branch). Він не реалізує власної логіки взяття/звільнення лока — натомість **повторно використовує** перевірений механізм `withLock` (spec §4.1.3), який уже коректно:

- чистить stale-локи (TTL + перевірка процесу через `process.kill(pid, 0)`);
- релізить лок на `SIGINT` / `SIGTERM`;
- підтримує очікування з poll-інтервалом і таймаутом.

Ключові поведінкові відмінності цього модуля від базового `withLock` (override-и для контексту `flow`):

- **`onWaitTimeout: 'fail'`** — fail-closed. На відміну від lint, де після таймауту прийнятно стартонути «без лока», для `flow` мутацію стану двома writer-ами одночасно не допускається. Якщо лок не вдалось узяти за `waitTimeout` — кидається помилка.
- **`getFingerprint: () => null`** — dedup за «однаковим деревом» вимкнено. Flow повинен виконатись завжди, а не пропускатись через те, що інший writer щойно мутував той самий стан.
- **Лок-каталог — sibling до worktree-checkout**: `.flow-lock-<branch>/` створюється поряд із самим worktree-каталогом (`.worktrees/.flow-lock-<branch>/`), а не в глобальному кеш-каталозі ОС. Це усуває залежність від `XDG_CACHE_HOME` / `os.tmpdir()` і прив’язує лок до того ж тому, де живе стан.

Модуль входить у бібліотеку диспетчера (`npm/scripts/dispatcher/lib/`) і є будівельним блоком для усіх кроків, що змінюють persistent-стан `flow` конкретної гілки.

## Експорти / API

Модуль експортує одну іменовану функцію:

| Експорт                                   | Тип        | Призначення                                                                              |
| ----------------------------------------- | ---------- | ---------------------------------------------------------------------------------------- |
| `withFlowLock(worktreeDir, runFn, opts?)` | `function` | Виконує `runFn` під per-branch локом flow, прив’язаним до конкретного worktree-каталогу. |

Default export відсутній.

## Функції

### `withFlowLock(worktreeDir, runFn, opts = {})`

Виконує користувацьку асинхронну (або синхронну) функцію `runFn` ексклюзивно для конкретного worktree. Якщо інший процес уже тримає лок, очікує до `opts.waitTimeout`, інакше кидає помилку (fail-closed).

#### Сигнатура

```js
withFlowLock(worktreeDir: string,
             runFn: () => unknown | Promise<unknown>,
             opts?: object): Promise<unknown>
```

#### Параметри

- `worktreeDir` — `string`, **абсолютний** шлях до checkout-каталогу worktree (наприклад, `/repo/.worktrees/feat-x`). Якщо шлях не абсолютний, функція кидає `Error` (див. нижче).
- `runFn` — `() => unknown | Promise<unknown>`, критична секція. Викликається без аргументів усередині лока. Може повертати як значення, так і `Promise`.
- `opts` — `object`, опціональний. Прокидається у `withLock` як є (через spread). Дозволяє переозначити, зокрема:
  - `waitTimeout` — максимальний час очікування лока (мс);
  - `pollInterval` — період опитування стану лока (мс);
  - будь-які інші поля, що підтримує `withLock`.

  **Увага:** опції з override-ів (`onWaitTimeout`, `cacheDir`, `getFingerprint`) **можуть бути перевизначені** користувачем, бо `...opts` стоїть після них у літералі. Якщо потрібно зберегти fail-closed поведінку — не передавайте ці три поля.

#### Повертає

`Promise<unknown>` — те, що повернув `runFn`. Якщо `runFn` кинув помилку — `Promise` відхиляється тією ж помилкою (лок звільнюється у `finally` всередині `withLock`).

#### Винятки

- `Error('withFlowLock: очікується абсолютний шлях (отримано: <worktreeDir>)')` — якщо `worktreeDir` не є абсолютним шляхом (`!isAbsolute(worktreeDir)`).
- Будь-яка помилка, кинута з `withLock`: зокрема, при `onWaitTimeout: 'fail'` — помилка таймауту очікування лока.
- Будь-яка помилка, кинута з `runFn` — пробрасується без обгортки.

#### Side effects

- Створює (через `withLock`) каталог `${dirname(worktreeDir)}/.flow-lock-${basename(worktreeDir)}/` для зберігання lock-файлу та допоміжних артефактів (PID, мітки часу — деталі визначає `withLock`).
- На час виконання `runFn` тримає файловий лок у вищезгаданому каталозі.
- Реагує на `SIGINT`/`SIGTERM` (через хендлери у `withLock`) — звільняє лок при перериванні процесу.
- Не виконує жодних мережевих чи git-операцій сам по собі — лише обчислює шляхи та делегує у `withLock`.

#### Логіка обчислення параметрів лока

Усередині функції:

1. `base = basename(worktreeDir)` — ім’я останнього сегменту шляху (наприклад, `feat-x` для `/repo/.worktrees/feat-x`). Використовується як суфікс імені лока та назви кеш-каталогу.
2. `cacheDir = join(dirname(worktreeDir), `.flow-lock-${base}`)` — каталог, у якому `withLock` зберігає сам lock-файл. Розташовується **поряд** із worktree-каталогом, а не всередині нього (sibling).
3. Виклик `withLock(name, runFn, options)`:
   - `name = `flow-${base}`` — стабільний ідентифікатор лока, унікальний у межах гілки.
   - `options`:
     - `onWaitTimeout: 'fail'` — fail-closed по таймауту очікування;
     - `cacheDir` — обчислений вище;
     - `getFingerprint: () => null` — dedup вимкнено: рівноцінні запуски не «склеюються»;
     - `...opts` — користувацькі опції зверху (можуть переозначити будь-яке з трьох попередніх полів).

## Залежності

### Зовнішні (Node.js core)

- `node:path` — імпортуються `basename`, `dirname`, `isAbsolute`, `join`. Використовуються для валідації абсолютності шляху та обчислення sibling-каталогу лока і `name` лока.

### Внутрішні (репозиторій)

- `../../utils/with-lock.mjs` (відносно `npm/scripts/dispatcher/lib/flow-lock.mjs` — це `npm/scripts/utils/with-lock.mjs`) — спільна утиліта `withLock`. Відповідає за:
  - створення lock-файлу;
  - очищення stale-локів за TTL і `process.kill(pid, 0)`;
  - обробку `SIGINT`/`SIGTERM`;
  - polling/wait/timeout логіку;
  - dedup за fingerprint (тут — вимкнено).

Інших зовнішніх npm-залежностей модуль не має.

## Потік виконання / Використання

### Високорівневий потік виклику

1. Викликач формує абсолютний шлях `worktreeDir` (наприклад, `/repo/.worktrees/feat-x`).
2. Передає його в `withFlowLock(worktreeDir, runFn, opts?)`.
3. `withFlowLock`:
   - валідує, що `worktreeDir` абсолютний (інакше — кидає);
   - обчислює `base` та `cacheDir`;
   - делегує у `withLock('flow-<base>', runFn, { onWaitTimeout: 'fail', cacheDir, getFingerprint: () => null, ...opts })`.
4. `withLock`:
   - намагається взяти лок у `cacheDir`;
   - якщо лок зайнятий — чекає до `waitTimeout` з кроком `pollInterval` (значення за замовчуванням — з `withLock`);
   - якщо за таймаут лок не взято — через `onWaitTimeout: 'fail'` кидає помилку;
   - якщо взято — виконує `runFn` і у `finally` звільняє лок;
   - реєструє хендлери `SIGINT`/`SIGTERM`, що звільняють лок при перериванні.
5. Результат `runFn` повертається через `Promise`.

### Приклад використання

```js
import { withFlowLock } from './flow-lock.mjs'

const worktreeDir = '/repo/.worktrees/feat-x'

await withFlowLock(
  worktreeDir,
  async () => {
    // Критична секція: мутації стану flow для гілки feat-x
    await mutateFlowState(worktreeDir)
  },
  { waitTimeout: 30_000, pollInterval: 250 }
)
```

Поведінка:

- Якщо інший процес уже виконує `withFlowLock` для **того ж самого** `worktreeDir`, поточний виклик чекатиме до 30 с.
- Якщо за 30 с лок не звільниться — буде кинуто помилку (fail-closed).
- Для **іншого** `worktreeDir` (інша гілка) лок не блокує — `name` лока містить `basename(worktreeDir)`, тож гілки серіалізуються незалежно.

### Розташування артефактів на диску

Для `worktreeDir = /repo/.worktrees/feat-x`:

- worktree-checkout: `/repo/.worktrees/feat-x/`
- lock-каталог (sibling): `/repo/.worktrees/.flow-lock-feat-x/`

Sibling-розміщення обрано свідомо, аби:

- не «забруднювати» сам worktree файлом лока (він не є частиною робочого дерева);
- не залежати від глобального кеш-каталогу ОС (інакше лок-семантика «per-branch у цьому репо» загубилась би на машинах з нестандартним `XDG_CACHE_HOME`).

### Гарантії та обмеження

- **Серіалізація per-branch:** два паралельні виклики `withFlowLock` для одного `worktreeDir` виконуються послідовно.
- **Незалежність гілок:** виклики для різних `worktreeDir` (різний `basename`) не блокують одне одного.
- **Fail-closed:** при недоступному локі writer **не** запуститься «оптимістично» — на відміну від lint-сценаріїв.
- **Без dedup:** навіть якщо викликач передасть свій `getFingerprint`, дефолт `() => null` вимикає «склеювання» однакових запусків; для увімкнення dedup потрібно явно передати `getFingerprint` в `opts` (override `...opts` після дефолтів дозволяє це).
- **Обов’язковий абсолютний шлях:** відносні шляхи відхиляються одразу — це усуває клас помилок «лок узяли не там, де думали».
