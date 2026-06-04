# Документація модуля `benchmarks/runner-comparison/demo/src/currency.mjs`

## Огляд

Модуль `benchmarks/runner-comparison/demo/src/currency.mjs` — це утилітарний ES-модуль (`.mjs`) для роботи з грошовими сумами, що зберігаються в цілих числах копійок/центів (cents). Файл є частиною демо-проєкту `benchmarks/runner-comparison/demo`, який слугує матеріалом для порівняльних бенчмарків раннерів.

Модуль `benchmarks/runner-comparison/demo/src/currency.mjs` надає три чисті (pure) функції:

- `formatCents(cents, opts)` — форматування суми у копійках у рядок виду `"USD 12.34"`.
- `addCents(a, b)` — додавання двох сум у копійках із попереднім округленням до цілих.
- `percentOf(cents, percent)` — обчислення відсотка від суми в копійках із округленням.

Усі функції модуля `benchmarks/runner-comparison/demo/src/currency.mjs` захищені перевірками типу аргументів та повертають безпечні «нульові» значення (`''` або `0`) у разі некоректного входу. Жодних побічних ефектів (I/O, мутацій стану, мережі, файлової системи) функції модуля не виконують.

## Експорти / API

Модуль `benchmarks/runner-comparison/demo/src/currency.mjs` має лише іменовані експорти; default-експорту немає.

| Експорт | Тип | Призначення |
|---|---|---|
| `formatCents` | `function` | Форматує ціле число копійок у валютний рядок із префіксом коду валюти. |
| `addCents` | `function` | Додає два числа копійок із попереднім округленням кожного до цілого. |
| `percentOf` | `function` | Обчислює `percent` відсотків від суми `cents` із округленням результату. |

Приклад імпорту:

```js
import { formatCents, addCents, percentOf } from './currency.mjs'
```

## Функції

### Функція `formatCents(cents, opts)`

Сигнатура (JSDoc-типи з файлу `benchmarks/runner-comparison/demo/src/currency.mjs`):

```js
formatCents(cents: number, opts: { currency?: string } = {}): string
```

Параметри функції `formatCents`:

- `cents` — `number`, сума в копійках/центах (може бути від’ємною, нулем або додатною).
- `opts` — об’єкт опцій форматування; необов’язковий (`= {}`).
  - `opts.currency` — `string`, код валюти, що додається префіксом до результату. Якщо не передано (тобто `undefined` або `null` через `??`), використовується значення за замовчуванням `'USD'`.

Що повертає функція `formatCents`:

- `string` — відформатований рядок виду `"<sign><currency> <whole>.<fracStr>"`, де:
  - `<sign>` — `'-'`, якщо `cents < 0`, інакше порожній рядок `''`.
  - `<currency>` — значення `opts.currency` або `'USD'`.
  - `<whole>` — ціла частина (долари/гривні), обчислена як `Math.floor(abs / 100)` від абсолютного значення `cents`.
  - `<fracStr>` — дробова частина (копійки), завжди двозначна: якщо `frac < 10`, додається провідний нуль (`` `0${frac}` ``), інакше — `String(frac)`.
- Порожній рядок `''` — у разі некоректного входу:
  - `typeof cents !== 'number'`, або
  - `Number.isFinite(cents) === false` (тобто `NaN`, `Infinity`, `-Infinity`).

Алгоритм функції `formatCents` (за рядок-у-рядок з вихідного коду):

1. Якщо `cents` не `number` або не скінченне число — повернути `''`.
2. `currency = opts.currency ?? 'USD'` (використовує оператор nullish coalescing).
3. `negative = cents < 0`.
4. `abs = Math.abs(cents)`.
5. `whole = Math.floor(abs / 100)`.
6. `frac = abs % 100`.
7. `fracStr = frac < 10 ? `0${frac}` : String(frac)`.
8. `sign = negative ? '-' : ''`.
9. Повернути шаблонний рядок `` `${sign}${currency} ${whole}.${fracStr}` ``.

Особливості функції `formatCents`:

- Функція не округлює `cents` і не нормалізує дробові значення `cents` — дробові `cents` (наприклад, `100.5`) призведуть до того, що `frac` буде дробовим (через `abs % 100`), і `fracStr` міститиме дробове число як рядок без додаткового форматування.
- Знак мінус ставиться перед кодом валюти: для `cents = -1234` результат буде `"-USD 12.34"`.
- Жодних локалізованих роздільників (коми/пробіли в тисячах) функція `formatCents` не додає — лише пряма конкатенація шаблонного рядка.

Side effects функції `formatCents`: відсутні. Функція є чистою.

### Функція `addCents(a, b)`

Сигнатура (JSDoc-типи з файлу `benchmarks/runner-comparison/demo/src/currency.mjs`):

```js
addCents(a: number, b: number): number
```

Параметри функції `addCents`:

- `a` — `number`, перша сума в копійках.
- `b` — `number`, друга сума в копійках.

Що повертає функція `addCents`:

- `number` — `Math.round(a) + Math.round(b)`, тобто сума двох доданків, кожен з яких попередньо округлено до найближчого цілого функцією `Math.round`.
- `0` — у разі некоректного входу: якщо `typeof a !== 'number'` або `typeof b !== 'number'`.

Алгоритм функції `addCents`:

1. Якщо хоча б один з `a` чи `b` не є `number` — повернути `0`.
2. Інакше повернути `Math.round(a) + Math.round(b)`.

Особливості функції `addCents`:

- Функція не перевіряє `Number.isFinite` для `a` та `b` (на відміну від `formatCents`). Якщо `a = NaN`, то `typeof NaN === 'number'` істинне, отже умова не спрацює, а `Math.round(NaN) === NaN`, тож результатом буде `NaN`.
- Округлення відбувається до додавання, а не після. Це впливає на половинні значення (`Math.round` округлює `0.5` до `1`, але `-0.5` до `0` за специфікацією JavaScript).

Side effects функції `addCents`: відсутні. Функція є чистою.

### Функція `percentOf(cents, percent)`

Сигнатура (JSDoc-типи з файлу `benchmarks/runner-comparison/demo/src/currency.mjs`):

```js
percentOf(cents: number, percent: number): number
```

Параметри функції `percentOf`:

- `cents` — `number`, базова сума в копійках, від якої береться відсоток.
- `percent` — `number`, значення відсотка (наприклад, `15` означає 15%).

Що повертає функція `percentOf`:

- `number` — `Math.round((cents * percent) / 100)`, тобто обчислений відсоток у копійках, округлений до цілого.
- `0` — у разі некоректного входу: якщо `typeof cents !== 'number'` або `typeof percent !== 'number'`.

Алгоритм функції `percentOf`:

1. Якщо хоча б один з `cents` чи `percent` не є `number` — повернути `0`.
2. Інакше повернути `Math.round((cents * percent) / 100)`.

Особливості функції `percentOf`:

- Як і `addCents`, функція `percentOf` не перевіряє `Number.isFinite`. При `cents = Infinity` або `percent = NaN` повернеться `NaN` (через арифметичні операції з нескінченністю/`NaN` і `Math.round`).
- Порядок операцій: спочатку множення `cents * percent`, потім ділення на `100`, потім округлення.

Side effects функції `percentOf`: відсутні. Функція є чистою.

## Залежності

Модуль `benchmarks/runner-comparison/demo/src/currency.mjs` не має жодних `import`-ів:

- Жодних залежностей від npm-пакетів.
- Жодних залежностей від інших модулів проєкту.
- Жодних залежностей від Node.js built-in модулів.

Модуль використовує лише глобальні об’єкти стандарту ECMAScript:

- `Number.isFinite` — для перевірки, що `cents` у `formatCents` є скінченним числом.
- `Math.abs` — у `formatCents` для отримання модуля `cents`.
- `Math.floor` — у `formatCents` для отримання цілої частини `whole = Math.floor(abs / 100)`.
- `Math.round` — у `addCents` (для округлення кожного доданка) та у `percentOf` (для округлення результату).
- `String` — у `formatCents` для приведення `frac` до рядка, коли `frac >= 10`.

Інші мовні засоби, які використовує модуль `benchmarks/runner-comparison/demo/src/currency.mjs`:

- Оператор `??` (nullish coalescing) — у `formatCents` для дефолту `opts.currency ?? 'USD'`.
- Шаблонні рядки (template literals) — у `formatCents` для побудови результату та провідного нуля у `fracStr`.
- Деструктуризація НЕ використовується; параметр-об’єкт `opts` отримує дефолтне значення через `opts = {}`.

## Потік виконання / Використання

Файл `benchmarks/runner-comparison/demo/src/currency.mjs` призначений для імпорту в інші модулі ESM. Імпортувальник може використовувати функції модуля для:

- Відображення грошових сум: викликати `formatCents(amountInCents, { currency: 'EUR' })`, отримати готовий рядок для UI чи логів.
- Складання сум: викликати `addCents(subtotal, tax)` для отримання сумарного значення в копійках.
- Обчислення податків/комісій/знижок: викликати `percentOf(amountInCents, taxPercent)` для отримання частки в копійках.

Ключові гілки логіки модуля `benchmarks/runner-comparison/demo/src/currency.mjs`:

1. У функції `formatCents`:
   - Гілка валідації: невалідний `cents` (`typeof !== 'number'` або `!Number.isFinite`) → ранній `return ''`.
   - Гілка знаку: `negative = cents < 0` визначає, чи буде префікс `'-'`.
   - Гілка форматування дробової частини: `frac < 10` → додається провідний нуль; інакше — пряме приведення до рядка.
   - Гілка вибору валюти: `opts.currency` присутнє (не `null`/`undefined`) → використовується воно; інакше — `'USD'`.

2. У функції `addCents`:
   - Гілка валідації: `a` або `b` не `number` → `return 0`.
   - Інакше — округлення і додавання.

3. У функції `percentOf`:
   - Гілка валідації: `cents` або `percent` не `number` → `return 0`.
   - Інакше — обчислення `(cents * percent) / 100` із округленням.

Передбачуваний контекст використання модуля `benchmarks/runner-comparison/demo/src/currency.mjs` — демо-сценарії для порівняння раннерів у каталозі `benchmarks/runner-comparison/demo`. Модуль не виконує самостійно жодного коду на верхньому рівні; усе, що він робить, — експортує три функції.
