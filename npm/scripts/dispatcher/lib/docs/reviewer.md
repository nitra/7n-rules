# reviewer.mjs

## Огляд

Модуль `reviewer.mjs` реалізує **Level-1 «Суддю»** з §8.4 специфікації Dispatcher-а: чистий, детермінований раннер **Quality Gates** (§5), що повертає структурований verdict про якість поточного робочого дерева.

Призначення:

- Запустити послідовність gate-перевірок (за замовчуванням — `lint` і `coverage --changed`) через **ін'єктований** runner-процесів.
- Зупинитись на першому проваленому gate (`fail-fast`) і повернути захоплений `stdout/stderr`.
- За умови **повного** проходження зняти `worktree-fingerprint` (відбиток дерева), щоб пізніше можна було відрізнити «свіжий» verdict від «протухлого» (stale): якщо файли змінилися після зняття fingerprint-а — попередній verdict більше нерелевантний.

Архітектурні принципи:

- Модуль **не знає** про LLM, API-ключі, мережу чи Anthropic SDK. Це **чистий FS/Git/процеси**-рівень.
- Всі побічні ефекти (виклик дочірніх процесів, обчислення fingerprint-а) **ін'єктуються через параметри** — це робить функцію тестопридатною без `child_process`-моків і без реальних запусків ESLint/Vitest/Stryker.
- Один і той самий `runReview` обслуговує два сценарії:
  1. **Пасивний Турнікет** — команда `flow verify` (фінальна перевірка перед merge/commit).
  2. **Активний Раннер** — per-step Ф4 (фаза 4 з flow-циклу, що оцінює крок ітерації).
- Gate-и за замовчуванням **scoped до змінених файлів**: `lint` — quick-режим через `changed-files.mjs`; `coverage --changed` — vitest `--changed` плюс Stryker `--mutate` по diff від base-гілки. Турнікет та per-step перевіряють лише змінене; повний прогін coverage — окрема операція (`bun run coverage`, скіл `/n-coverage-fix`).

## Експорти / API

Модуль експортує дві сутності:

| Експорт         | Тип                                                     | Призначення                                                                |
| --------------- | ------------------------------------------------------- | -------------------------------------------------------------------------- |
| `DEFAULT_GATES` | `Array<{ name: string, cmd: string[] }>` (named export) | Канонічний список gate-ів за замовчуванням: `lint` і `coverage --changed`. |
| `runReview`     | `function` (named export)                               | Виконує послідовність gate-ів і повертає `verdict`-об'єкт.                 |

Імпорт:

```js
import { runReview, DEFAULT_GATES } from './reviewer.mjs'
```

### `DEFAULT_GATES`

Сталий масив із двома gate-ами, у фіксованому порядку:

```js
export const DEFAULT_GATES = [
  { name: 'lint', cmd: ['npx', '@nitra/cursor', 'lint'] },
  { name: 'coverage', cmd: ['npx', '@nitra/cursor', 'coverage', '--changed'] }
]
```

Семантика полів:

- `name` — людиночитна назва gate-у; повертається у `verdict.gates[i].name`.
- `cmd` — масив `[executable, ...args]`. Перший елемент передається в `run` як виконуваний файл, решта — як аргументи.

Послідовність визначає **порядок** виконання та fail-fast-поведінку: `lint` запускається першим, бо він дешевший і ловить більшість регресій; `coverage` — другим, бо триваліший (включає тести + мутаційне тестування Stryker).

## Функції

### `runReview({ run, cwd, gates, fingerprint })`

Проганяє gate-и послідовно, повертає structured verdict.

**Сигнатура:**

```ts
runReview(input: {
  run: (cmd: string, args: string[], opts: { cwd: string })
       => { status: number, stdout?: string, stderr?: string },
  cwd: string,
  gates?: Array<{ name: string, cmd: string[] }>,
  fingerprint?: () => string | null
}): {
  pass: boolean,
  gates: Array<{ name: string, ok: boolean }>,
  failedOutput: string | null,
  fingerprint: string | null
}
```

**Параметри (всі — поля об'єктного аргументу):**

- `run` — **обов'язковий**. Синхронна (або синхронно-сумісна за shape) функція запуску дочірнього процесу. Має сигнатуру `(cmd, args, opts)` й мусить повертати об'єкт із принаймні `status: number`; опційно `stdout: string` і `stderr: string`. Передбачається, що це обгортка над `Bun.spawnSync` / `node:child_process.spawnSync`, але реалізація лишається за викликачем. Це **ін'єкція** — модуль сам процесів не породжує.
- `cwd` — **обов'язковий**. Робоча директорія, в якій виконувати кожен gate. Передається у виклик `run(..., { cwd })`. Має бути коренем worktree, з якого gate-команди (`npx @nitra/cursor lint` тощо) бачать правильну монорепу.
- `gates` — опційний. Перевизначає список gate-ів. За замовчуванням — `DEFAULT_GATES`. Дозволяє тестам/скриптам прогнати кастомний набір (наприклад, лише `lint`, або додати власний gate `typecheck`).
- `fingerprint` — опційний. Функція без аргументів, що повертає `string | null` — відбиток поточного стану worktree. За замовчуванням — `() => worktreeFingerprint()` (див. `../../utils/worktree-fingerprint.mjs`). Викликається **лише** у випадку повного pass.

**Повертає** verdict-об'єкт:

- `pass: boolean` — `true` лише якщо **всі** gate-и завершились зі статусом `0`. Якщо `gates` порожній (`[]`), результат `pass: true` (вакуумна істина: `results.length === gates.length === 0` і `every` на порожньому масиві — `true`).
- `gates: Array<{ name, ok }>` — звіт за кожним фактично виконаним gate-ом. У разі fail-fast масив містить **усі попередні** `{ ok: true }` плюс **один** `{ ok: false }`; gate-и після провалу до масиву **не потрапляють**.
- `failedOutput: string | null` — конкатенація `stdout` і `stderr` першого проваленого gate-у, обрізана `trim()`-ом. Якщо обидва стріми порожні після trim — `null`. У разі pass — `null`.
- `fingerprint: string | null` — результат `fingerprint()`, **тільки** якщо `pass === true`; інакше `null`. Це навмисно: stale-перевірка має сенс лише для свіжого позитивного verdict-у.

**Семантика `ok`:**

```js
const ok = (r?.status ?? 1) === 0
```

- `r === undefined`/`null` або `r.status === undefined` → трактується як **fail** (`status` defaultиться у `1`).
- `r.status === 0` → **ok**.
- Будь-який інший числовий код → **fail**.

**Логіка fail-fast:**

```js
for (const g of gates) {
  const r = run(g.cmd[0], g.cmd.slice(1), { cwd })
  const ok = (r?.status ?? 1) === 0
  results.push({ name: g.name, ok })
  if (!ok) {
    failedOutput = `${r?.stdout ?? ''}\n${r?.stderr ?? ''}`.trim() || null
    break
  }
}
```

- Розбиття `cmd` на `[head, ...rest]` через `g.cmd[0]` і `g.cmd.slice(1)`.
- Якщо `stdout`/`stderr` відсутні — підставляється `''`, склейка через `\n`, далі `trim()`. Якщо після trim рядок порожній — повертається `null`, а не `""` (короткозамкнення `|| null`).

**Логіка fingerprint:**

```js
const pass = results.length === gates.length && results.every(x => x.ok)
return { pass, gates: results, failedOutput, fingerprint: pass ? fingerprint() : null }
```

- `pass` істинний лише якщо **жодного break-у** не сталось (довжини масивів збігаються) **і** всі результати `ok`.
- Виклик `fingerprint()` — **ліниво**, лише на pass-гілці; на fail зайвої роботи не робимо.

**Side effects:**

Сам `runReview` побічних ефектів **не має**: ані до файлової системи, ані до мережі, ані до stdout/stderr процесу-хоста. Усі побічні ефекти інкапсульовано в **ін'єкціях** `run` (запуск процесу, читання вихідних потоків) і `fingerprint` (за замовчуванням — обхід worktree для побудови відбитка). Це робить функцію **детермінованою при фіксованих ін'єкціях** і повністю unit-тестопридатною без stubs на `child_process`/`fs`.

**Особливості й edge-cases:**

- **Порожній `gates`**: `pass === true`, `gates: []`, `failedOutput: null`, `fingerprint: fingerprint()`. У такому разі fingerprint **усе одно** буде знятий — повний pass із 0 перевірок формально успіх.
- **`run` кидає виняток**: не перехоплюється всередині `runReview`. Помилка проб'ється у викликача — це навмисно (баг у runner-обгортці не маскується під «провалений gate»).
- **`fingerprint()` повертає `null`**: легітимний випадок (наприклад, worktree не git-репо); поле `fingerprint` у verdict-і просто буде `null`.
- **`fingerprint()` кидає виняток на pass-гілці**: проб'ється у викликача; не обгортається в try/catch.

## Залежності

### Імпорти

```js
import { worktreeFingerprint } from '../../utils/worktree-fingerprint.mjs'
```

Єдина зовнішня залежність модуля — функція `worktreeFingerprint` з `npm/scripts/utils/worktree-fingerprint.mjs`. Використовується лише як **значення за замовчуванням** для параметра `fingerprint` (через стрілку `() => worktreeFingerprint()`). Якщо викликач передає власну `fingerprint`-функцію, `worktreeFingerprint` не викликається.

### Невидимі залежності (через ін'єкції)

- `run` (передається ззовні) — фактичний запуск дочірніх процесів (`npx @nitra/cursor lint`, `npx @nitra/cursor coverage --changed`).
- CLI `@nitra/cursor` — має бути доступний у `PATH` worktree-кореня (через `npx`).
- Сабкоманди `lint` і `coverage` пакету `@nitra/cursor`, що внутрішньо тягнуть ESLint, Vitest, Stryker та логіку «changed files» з `changed-files.mjs`.

### Зовнішні правила-документи

- §5 spec — Quality Gates.
- §8.4 spec — Level-1 «Суддя».
- `flow verify` (`n-flow.mdc`) — пасивний турнікет.
- `/n-coverage-fix`, `bun run coverage` — повний прогін coverage окремо.

## Потік виконання / Використання

### Типовий сценарій 1 — `flow verify` (пасивний турнікет)

1. Користувач/CI запускає `flow verify` у worktree.
2. Команда збирає ін'єкції:
   - `run` — обгортка над `Bun.spawnSync` (синхронний запуск, capture stdout/stderr).
   - `cwd` — корінь worktree.
   - `gates` — `DEFAULT_GATES` (не перевизначається).
   - `fingerprint` — default (`worktreeFingerprint`).
3. Виклик `runReview({...})`.
4. Аналіз verdict-у:
   - `pass: true` → merge/commit дозволений; verdict разом із `fingerprint` зберігається у стан, щоб наступного разу детектити stale.
   - `pass: false` → виводиться `failedOutput`, операція переривається.

### Типовий сценарій 2 — per-step Ф4 (активний раннер)

1. Dispatcher на фазі 4 циклу (після кожного кроку) викликає `runReview` для оцінки якості після зміни.
2. Та ж сигнатура, ті ж `DEFAULT_GATES`.
3. Verdict використовується для:
   - прийняття рішення «крок успішний / відкотити»;
   - формування feedback-у наступному LLM-кроку (через `failedOutput`).

### Псевдокод інтеграції

```js
import { runReview, DEFAULT_GATES } from './reviewer.mjs'
import { spawnSync } from 'node:child_process'

const run = (cmd, args, opts) => {
  const r = spawnSync(cmd, args, { ...opts, encoding: 'utf8' })
  return { status: r.status ?? 1, stdout: r.stdout, stderr: r.stderr }
}

const verdict = runReview({ run, cwd: process.cwd() })

if (verdict.pass) {
  saveState({ fingerprint: verdict.fingerprint, verdict })
} else {
  console.error(verdict.failedOutput)
  process.exit(1)
}
```

### Послідовність виконання (внутрішня)

1. Ініціалізувати `results = []`, `failedOutput = null`.
2. Для кожного `g ∈ gates` у порядку оголошення:
   - 2.1. Викликати `run(g.cmd[0], g.cmd.slice(1), { cwd })`.
   - 2.2. Обчислити `ok = (r?.status ?? 1) === 0`.
   - 2.3. Додати `{ name: g.name, ok }` у `results`.
   - 2.4. Якщо `!ok` — записати `failedOutput` із `stdout + '\n' + stderr` (trim → `null` якщо пусто) і **вийти з циклу**.
3. Обчислити `pass = results.length === gates.length && results.every(x => x.ok)`.
4. Якщо `pass` — викликати `fingerprint()`, інакше — `null`.
5. Повернути `{ pass, gates: results, failedOutput, fingerprint }`.

### Stale-семантика (роль fingerprint у часі)

- Verdict із `fingerprint: 'abc123'` зберігається у стан Dispatcher-а.
- Перед повторним використанням verdict-у викликач знову обчислює `worktreeFingerprint()` і порівнює.
- Якщо відбитки збігаються → verdict ще валідний.
- Якщо ні → файли у дереві змінились після pass-у; verdict **stale**, треба перепрогнати gate-и.
- Цей механізм визначений §5 і реалізується **поза** `runReview` — модуль лише **постачає** fingerprint у момент успіху.

## Rebuild Test

Перевірка, що документація достатня для відтворення модуля з нуля:

1. **Експорти й сигнатура** — `DEFAULT_GATES` (named, масив із двох об'єктів `{ name, cmd }` у фіксованому порядку lint→coverage), `runReview(input)` (named) із чотирма іменованими полями: `run`, `cwd`, `gates?`, `fingerprint?`.
2. **Імпорт** — `worktreeFingerprint` з `../../utils/worktree-fingerprint.mjs`; використовується лише як значення за замовчуванням.
3. **Канонічні команди gate-ів** — `['npx', '@nitra/cursor', 'lint']` та `['npx', '@nitra/cursor', 'coverage', '--changed']` (саме в такому порядку аргументів).
4. **Алгоритм** — послідовний цикл for-of по `gates`, fail-fast із `break` на першому `!ok`, обчислення `ok` як `(r?.status ?? 1) === 0`.
5. **`failedOutput`** — конкатенація `stdout` і `stderr` (defaultяться у `''`), розділювач `\n`, далі `trim()` та fallback на `null` через `|| null`.
6. **`pass`** — комбінація двох умов: `results.length === gates.length` **і** `results.every(x => x.ok)` (друга умова критична для коректності, бо перша істинна вже на старті при порожньому `gates`).
7. **`fingerprint` у verdict-і** — тернар `pass ? fingerprint() : null`; виклик ліниво.
8. **Side-effect-free** — `runReview` сам не торкає FS/network/процеси; усе через ін'єкції.
9. **Дефолти параметрів** — `gates = DEFAULT_GATES`, `fingerprint = () => worktreeFingerprint()`. Жодних дефолтів для `run` і `cwd` — обидва обов'язкові, відсутність призведе до runtime-помилки в тілі функції.
10. **Структура verdict-у** — рівно чотири поля: `pass`, `gates`, `failedOutput`, `fingerprint`; жодних додаткових.
