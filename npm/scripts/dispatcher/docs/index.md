# `npm/scripts/dispatcher/index.mjs`

## Огляд

Файл реалізує **CLI-диспетчер підкоманди `n-cursor flow`** — точку входу другого рівня, до якої делегує гілка `case 'flow'` у `bin/n-cursor.js`. Реалізація відповідає специфікації §8 "Dual-Mode Dispatcher" і надає два фасади поверх єдиного джерела істини `.flow.json`:

- **Фасад A — "Пасивний Турнікет"** (`init`, `spec`, `plan`, `verify`, `review`, `gate`, `release`). Призначений для IDE-агентів (Cursor, Claude Code), які самі пишуть код; `n-cursor` лише виносить вердикт (judge).
- **Фасад B — "Активний Раннер"** (`run`, `resume`, `cancel`, `repair`). Повний 5-фазний polyfill-цикл для headless/CI-сценаріїв, де агент відсутній.

Модуль не містить ні I/O-побічних ефектів сам по собі (окрім `console.error` для usage), ні бізнес-логіки фаз. Він виключно:

1. парсить `argv` (підкоманда + опційний прапорець `--branch <гілка>`);
2. валідовує наявність handler-а;
3. делегує виклик до конкретного handler-модуля з директорії `./lib/`;
4. повертає `exit code` (число).

Така архітектура дає змогу повністю мокати `handlers` через DI в тестах, а сам диспатчер тримати тонким і детермінованим.

## Експорти / API

Модуль ESM (`.mjs`). Експортує:

| Експорт | Тип | Призначення |
| --- | --- | --- |
| `DEFAULT_HANDLERS` | `Record<string, (rest: string[], deps: object) => Promise<number>>` | Стандартна мапа підкоманд → handler-функцій (`init`, `spec`, `plan`, `verify`, `review`, `gate`, `release`, `run`, `resume`, `cancel`, `repair`). |
| `extractBranchFlag` | `function(args: string[]) → { rest: string[], branch: string \| undefined }` | Чистий парсер опційного `--branch <гілка>` / `--branch=<гілка>`; повертає очищений масив аргументів і значення гілки (або `undefined`). |
| `runFlowCli` | `async function(args: string[], deps?: object) → Promise<number>` | Власне точка входу диспатчера; маршрутизує підкоманду на handler і повертає exit code. |

Default-експорту немає — імпорт іменований.

## Функції

### `extractBranchFlag(args)`

**Сигнатура.**

```js
export function extractBranchFlag(args: string[]): { rest: string[], branch: string | undefined }
```

**Параметри.**

- `args: string[]` — масив "сирих" аргументів, які залишилися після виокремлення підкоманди (тобто `argv` без префіксу `flow <sub>`).

**Повертає.**

Об'єкт із двома полями:

- `rest: string[]` — очищений масив аргументів, з якого вилучено всі форми `--branch …`.
- `branch: string | undefined` — значення гілки, якщо було вказано непорожньою формою; інакше `undefined`.

**Підтримувані форми прапорця.**

- Пробільна форма: `--branch <гілка>` — поглинає **наступний** аргумент **лише** якщо він існує і не починається з `-` (щоб не "з'їсти" сусідній прапорець); інакше `--branch` тихо стає no-op без помилки.
- Inline-форма: `--branch=<гілка>` — значення береться суфіксом після `=`. Порожній суфікс (`--branch=`) ігнорується (гілку не встановлює).

**Особливості / захисти.**

- Захист від тихого "пожирання" сусіднього прапорця: `--branch --other-flag` не призведе до того, що `--other-flag` стане значенням гілки.
- Може зустрічатися кілька разів — **остання** валідна форма перемагає (стандартна семантика циклу: змінна `branch` перезаписується).
- Чиста функція: не залежить від `process`, файлової системи чи мережі.

**Side effects.** Жодних.

---

### `runFlowCli(args, deps)`

**Сигнатура.**

```js
export async function runFlowCli(
  args: string[],
  deps?: {
    handlers?: Record<string, (rest: string[], deps: object) => Promise<number>>,
    branch?: string,
    // …довільні інші deps, які потрібні конкретним handler-ам (логер, fs-мок тощо)
  }
): Promise<number>
```

**Параметри.**

- `args: string[]` — масив аргументів **після** слова `flow`. Перший елемент трактується як підкоманда (`sub`), решта — як її аргументи (`raw`).
- `deps` — опційний об'єкт ін'єкції залежностей:
  - `deps.handlers` — кастомна мапа handler-ів (для тестів / альтернативних збірок). Якщо не передано, використовується `DEFAULT_HANDLERS`.
  - `deps.branch` — попередньо встановлена гілка з вищого рівня; має пріоритет над тією, що витягнута з `args` (`deps.branch ?? branch`).
  - Інші довільні поля проходять "прозоро" до handler-а через spread `{ ...deps, branch: … }`.

**Повертає.**

`Promise<number>` — exit code:

- `1` — підкоманда відсутня (`!sub`) або невідома (`Object.hasOwn(handlers, sub) === false`). У цьому разі додатково надсилається текст `USAGE` у `stderr` через `console.error`.
- Будь-яке інше число — результат, який повернув викликаний handler.

**Side effects.**

- При невалідному вводі — запис у `stderr` (`console.error(USAGE)`).
- Делегує **всі** інші побічні ефекти (читання `.flow.json`, мутації worktree, git-операції тощо) у handler-модулі — сам диспатчер їх не виконує.

**Алгоритм (по кроках).**

1. Деструктурує `args` як `[sub, ...raw]`.
2. Бере `handlers = deps.handlers ?? DEFAULT_HANDLERS`.
3. Перевірка валідності: якщо `sub` фолсі або `Object.hasOwn(handlers, sub)` === `false` → `console.error(USAGE)` і `return 1`. `Object.hasOwn` ужито замість `in`/`hasOwnProperty`, щоб уникнути колізій із prototype-полями (безпечніше для ін'єкційного `handlers`).
4. Викликає `extractBranchFlag(raw)` → отримує `{ rest, branch }`.
5. Викликає `await handlers[sub](rest, { ...deps, branch: deps.branch ?? branch })` і повертає його результат.
6. Передача `branch` далі в `deps` забезпечує cwd-незалежний резолв стану (беклог №1 — `.flow.json` можна знайти й виконати команду поза worktree).

## Залежності

Усі залежності — **локальні** ESM-імпорти з директорії `./lib/`. Кожен handler — окремий модуль; диспатчер не знає їхньої внутрішньої логіки.

| Імпорт | З модуля | Призначення / Фасад |
| --- | --- | --- |
| `cancel`, `repair`, `resume`, `run` | `./lib/active.mjs` | Фасад B — Активний Раннер: повний 5-фазний цикл (`run`), продовження з чекпойнта (`resume`), скасування з прибиранням стану (`cancel`), відновлення пошкодженого стану (`repair`). |
| `init`, `release`, `verify` | `./lib/commands.mjs` | Фасад A — Турнікет: створення worktree + `.flow.json` (`init`), Quality Gates (`verify`), фіксація `.changes` + completion snapshot (`release`). |
| `gate` | `./lib/gate.mjs` | Фасад A: фінальний вердикт `PASS / CONCERNS / FAIL` (комбінований `verify + review`). |
| `plan` | `./lib/plan.mjs` | Фасад A: фаза плану → `docs/plans/<…>` + оновлення стану. |
| `review` | `./lib/review.mjs` | Фасад A: adversarial diff-review (інтенсивність залежить від `level`). |
| `spec` | `./lib/spec.mjs` | Фасад A: фаза дизайну → `docs/specs/<…>`. |

**Зовнішніх npm-залежностей немає** — модуль використовує лише вбудоване `console` API та `Object.hasOwn` (ECMAScript 2022+).

## Потік виконання / Використання

### Як викликається

Модуль вмонтований у CLI як обробник підкоманди `flow` у `bin/n-cursor.js`. Скорочена картина:

```js
// у bin/n-cursor.js
import { runFlowCli } from '../npm/scripts/dispatcher/index.mjs'

switch (cmd) {
  case 'flow':
    process.exit(await runFlowCli(rest))
    break
  // …інші команди
}
```

### Приклади з CLI

Усі приклади з блоку `USAGE`, який видається у `stderr` при невалідному виклику:

```text
npx @nitra/cursor flow init "<опис>"      # Фасад A: worktree + .flow.json (+ level)
npx @nitra/cursor flow spec [--panel]     # Фасад A: фаза дизайну → docs/specs/<…>
npx @nitra/cursor flow plan [--panel]     # Фасад A: фаза плану → docs/plans/<…> + state
npx @nitra/cursor flow verify             # Фасад A: Quality Gates (pass/fail)
npx @nitra/cursor flow review             # Фасад A: adversarial diff-review (за level)
npx @nitra/cursor flow gate               # Фасад A: вердикт PASS/CONCERNS/FAIL (verify+review)
npx @nitra/cursor flow release            # Фасад A: .changes + completion snapshot
npx @nitra/cursor flow run "<опис>"       # Фасад B: повний 5-фазний цикл
npx @nitra/cursor flow resume             # продовжити з чекпойнта
npx @nitra/cursor flow cancel             # скасувати, прибрати стан
npx @nitra/cursor flow repair [--discard-step-work]   # відновлення пошкодженого стану
```

### Опційний `--branch <гілка>`

Підтримується **для будь-якої** підкоманди. Допомагає, коли користувач запускає `n-cursor flow …` **поза** worktree цільової задачі — гілка вказує, який `.flow.json` (з якого worktree-резолва) брати.

Приклади:

```bash
npx @nitra/cursor flow verify --branch feature/payments
npx @nitra/cursor flow verify --branch=feature/payments
```

### Програмний виклик (для тестів)

`runFlowCli` повністю замокується через DI:

```js
import { runFlowCli } from './npm/scripts/dispatcher/index.mjs'

const calls = []
const fakeHandlers = {
  verify: async (rest, deps) => {
    calls.push({ rest, deps })
    return 0
  }
}

const code = await runFlowCli(['verify', '--branch', 'main'], { handlers: fakeHandlers })
// code === 0
// calls[0].deps.branch === 'main'
// calls[0].rest === []
```

### Послідовність кроків `runFlowCli`

1. Деструктуризація `args` → `sub` + `raw`.
2. Підбір мапи handler-ів (`deps.handlers ?? DEFAULT_HANDLERS`).
3. Валідація `sub` через `Object.hasOwn(handlers, sub)`.
   - Якщо невалідно → `console.error(USAGE)` + `return 1`.
4. Парсинг `--branch` через `extractBranchFlag(raw)` → `{ rest, branch }`.
5. Виклик `handlers[sub](rest, { ...deps, branch: deps.branch ?? branch })`.
6. Повернення exit code від handler-а як результату Promise.

### Коди завершення

| Код | Коли | Хто повертає |
| --- | --- | --- |
| `1` | відсутня або невідома підкоманда (`!sub` чи `Object.hasOwn` === `false`) | сам диспатчер |
| будь-яке число | результат handler-а | відповідний модуль із `./lib/` |

### Обмеження та інваріанти

- Диспатчер **не** інтерпретує жоден аргумент окрім `--branch`; усі інші опції-прапорці (`--panel`, `--discard-step-work` тощо) прокидаються в handler як частина `rest`.
- Усі handler-и повинні повертати `Promise<number>`; синхронний throw обірве промісі та "вибухне" вище — це навмисно (диспатчер не маскує внутрішні помилки фаз).
- Кеш стану й бізнес-логіка фаз — поза цим файлом; його роль виключно — маршрутизація.

## Rebuild Test

Якщо реалізацію цього файлу повністю видалити, з опису вище має бути можливо відтворити її без читання оригіналу:

1. ESM-модуль із трьома експортами: `DEFAULT_HANDLERS`, `extractBranchFlag`, `runFlowCli`.
2. Імпортувати 11 handler-ів із 6 модулів у `./lib/` (`active.mjs` → 4 шт., `commands.mjs` → 3 шт., `gate.mjs`, `plan.mjs`, `review.mjs`, `spec.mjs` → по 1 шт.) і скласти в `DEFAULT_HANDLERS`.
3. `extractBranchFlag(args)` — лінійний прохід `for`-циклом по `args`:
   - якщо елемент `=== '--branch'` — спробувати взяти `args[i+1]` як значення, якщо `!== undefined && !startsWith('-')`, інакше залишити `branch` як є; обидва випадки пропускають елемент (не пушать у `rest`); якщо значення взято — `i++` додатково;
   - інакше якщо елемент `startsWith('--branch=')` — взяти суфікс після `=`, якщо непорожній — присвоїти `branch`; не пушати в `rest`;
   - інакше — `rest.push(args[i])`.
   - Повернути `{ rest, branch }`.
4. `runFlowCli(args, deps = {})`:
   - `[sub, ...raw] = args`;
   - `handlers = deps.handlers ?? DEFAULT_HANDLERS`;
   - якщо `!sub || !Object.hasOwn(handlers, sub)` → `console.error(USAGE); return 1;`
   - `{ rest, branch } = extractBranchFlag(raw)`;
   - `return await handlers[sub](rest, { ...deps, branch: deps.branch ?? branch })`.
5. `USAGE` — багаторядковий текстовий блок із прикладами використання всіх 11 підкоманд + рядок `--branch` у `repair` (опційний `[--discard-step-work]`).

Відтворена реалізація має пройти тести з `npm/scripts/dispatcher/tests/`, які перевіряють: маршрутизацію відомих підкоманд, повернення `1` для невідомих, прокидання `branch` із обох форм прапорця, відмову поглинати сусідній прапорець після `--branch` без значення, ігнорування порожньої форми `--branch=`, пріоритет `deps.branch` над парсингом і DI `handlers` для мок-тестів.
