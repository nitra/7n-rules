# Документація модуля `src/promise-pool.mjs`

## Огляд

Модуль `benchmarks/runner-comparison/demo/src/promise-pool.mjs` надає утиліту для паралельного виконання асинхронної роботи над масивом вхідних елементів із обмеженням рівня одночасності (concurrency cap). Модуль експортує єдину функцію `promisePool()`, яка:

- приймає масив елементів `items`, асинхронний обробник `worker` і ліміт одночасних запусків `concurrency`;
- запускає не більше ніж `concurrency` паралельних виконавців (runner-ів), які беруть наступний елемент із черги через спільний індекс;
- зберігає порядок результатів — i-й елемент масиву результатів відповідає i-му елементу вхідного масиву `items`, незалежно від того, в якому порядку завершуються асинхронні виклики `worker`;
- повертає `Promise<unknown[]>`, який резолвиться після обробки всіх елементів.

Файл `benchmarks/runner-comparison/demo/src/promise-pool.mjs` є частиною демо-проєкту для порівняння runner-ів у каталозі `benchmarks/runner-comparison/demo` і не має зовнішніх імпортів — це самодостатній утилітарний модуль на чистому JavaScript (ESM).

## Експорти / API

Модуль `benchmarks/runner-comparison/demo/src/promise-pool.mjs` має один іменований експорт:

| Експорт       | Тип              | Призначення                                                                                                      |
| ------------- | ---------------- | ---------------------------------------------------------------------------------------------------------------- |
| `promisePool` | `async function` | Запускає `worker` над `items` із обмеженням `concurrency`, повертає масив результатів у порядку вхідних `items`. |

Експорт за замовчуванням (`default`) у файлі `benchmarks/runner-comparison/demo/src/promise-pool.mjs` відсутній.

## Функції

### Функція `promisePool(items, worker, concurrency)`

Сигнатура з JSDoc у файлі `benchmarks/runner-comparison/demo/src/promise-pool.mjs`:

```js
export async function promisePool(items, worker, concurrency = 4)
```

Параметри функції `promisePool()`:

| Параметр      | Тип (JSDoc)                                                     | За замовчуванням | Опис                                                                                                               |
| ------------- | --------------------------------------------------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------ |
| `items`       | `unknown[]`                                                     | —                | Масив вхідних елементів, які треба обробити.                                                                       |
| `worker`      | `(item: unknown, index: number) => unknown \| Promise<unknown>` | —                | Обробник одного елемента; може бути синхронним або повертати Promise. Отримує сам елемент і його індекс у `items`. |
| `concurrency` | `number`                                                        | `4`              | Максимальна кількість одночасно запущених викликів `worker`.                                                       |

Повертає функція `promisePool()`: `Promise<unknown[]>` — масив результатів довжиною `items.length`, де елемент за індексом `i` дорівнює значенню, яке повернув (чи яким зарезолвився) `worker(items[i], i)`.

Поведінка функції `promisePool()` у крайніх випадках:

- Якщо `items` не є масивом (перевірка `Array.isArray(items)` повертає `false`), функція `promisePool()` одразу повертає порожній масив `[]` (resolved promise). У такому разі `worker` не викликається жодного разу.
- Якщо `concurrency < 1`, значення `concurrency` нормалізується до `1` (присвоєння `concurrency = 1`), тобто завжди буде хоча б один runner.
- Якщо `items.length === 0`, `Array.from({ length: 0 })` створить порожній масив, `limit = Math.min(concurrency, 0) = 0`, цикл `for` не створить жодного runner-а, `Promise.all([])` миттєво резолвиться, і функція `promisePool()` поверне порожній масив.
- Якщо `items.length < concurrency`, кількість запущених runner-ів обмежується `Math.min(concurrency, items.length)` — зайвих runner-ів, які одразу б завершилися без роботи, не створюється.

Side effects функції `promisePool()`:

- Модифікує локальний масив `results` (мутація за індексом `results[i] = await worker(items[i], i)`). Цей масив не є вхідним аргументом і створюється всередині виклику.
- Викликає переданий `worker`, який може мати власні зовнішні side effects (I/O, мережа, тощо) — відповідальність за це лежить на викликовій стороні.
- Не модифікує вхідний масив `items` і не змінює глобальний стан модуля `benchmarks/runner-comparison/demo/src/promise-pool.mjs`.
- Помилки (rejection) у `worker(items[i], i)` пробрасуються через `await` нагору до `Promise.all(runners)` і призводять до rejection повернутого promise; інших runner-ів це не зупиняє примусово (вони можуть продовжити поточну ітерацію), але загальний `Promise.all` відхиляється першою помилкою — обробка/перехоплення помилок не реалізовані всередині `promisePool()`.

### Внутрішня функція `run()`

Усередині `promisePool()` оголошено допоміжну асинхронну функцію `run()` (closure):

```js
/**
 *
 */
async function run() {
  while (next < items.length) {
    const i = next++
    results[i] = await worker(items[i], i)
  }
}
```

Особливості функції `run()`:

- Не приймає параметрів і нічого явно не повертає (повертає `Promise<void>` після завершення циклу).
- Використовує спільні з `promisePool()` змінні з замикання: `next` (індекс наступного елемента), `items` (вхідний масив), `worker` (обробник), `results` (вихідний масив).
- На кожній ітерації захоплює поточне значення `next` у локальну константу `i` через постфіксний інкремент `next++`, гарантуючи, що кожен runner отримує унікальний індекс. Оскільки JavaScript однопотоковий і вираз `const i = next++` синхронний, гонок за індекс між runner-ами не виникає.
- Виконує `await worker(items[i], i)` і записує результат у `results[i]`, зберігаючи відповідність позицій вхід-вихід.
- Цикл `while (next < items.length)` завершується, коли всі індекси розібрані; після виходу з циклу runner завершується.

## Залежності

Модуль `benchmarks/runner-comparison/demo/src/promise-pool.mjs`:

- Не має жодного `import` (ані з npm-пакетів, ані з локальних модулів).
- Використовує лише вбудовані можливості JavaScript / ECMAScript: `Array.isArray`, `Array.from({ length })`, `Math.min`, `Promise.all`, синтаксис `async`/`await`.
- Розширення `.mjs` означає, що файл `benchmarks/runner-comparison/demo/src/promise-pool.mjs` обробляється Node.js як ES-модуль незалежно від поля `"type"` у найближчому `package.json`.

Зовнішні залежності/runtime-вимоги: будь-яке середовище з підтримкою ES2017+ (через `async`/`await`) і ESM-імпорту.

## Потік виконання / Використання

Алгоритм роботи функції `promisePool(items, worker, concurrency)` у файлі `benchmarks/runner-comparison/demo/src/promise-pool.mjs`:

1. Валідація вхідних даних:
   - Якщо `items` не масив — повернути `[]`.
   - Якщо `concurrency < 1` — підняти до `1`.
2. Ініціалізація:
   - Створити масив `results = Array.from({ length: items.length })` (масив з `items.length` слотів, значення `undefined`).
   - Завести лічильник наступного індексу `let next = 0`.
3. Визначити фактичний ліміт runner-ів: `limit = Math.min(concurrency, items.length)`.
4. У циклі `for (let k = 0; k < limit; k++)` запустити `limit` екземплярів `run()`, штовхаючи їхні promise-и в масив `runners`. Кожен `run()` стартує синхронно до першого `await` всередині, після чого віддає керування назад у цикл.
5. Дочекатися `await Promise.all(runners)` — точка синхронізації, де всі runner-и встигають розібрати чергу через спільний `next`.
6. Повернути заповнений масив `results`.

Ключові гілки логіки у функції `promisePool()`:

| Умова                                  | Гілка                                                                                      |
| -------------------------------------- | ------------------------------------------------------------------------------------------ |
| `!Array.isArray(items)`                | Ранній `return []`, `worker` не викликається.                                              |
| `concurrency < 1`                      | `concurrency = 1`, далі звичайний потік.                                                   |
| `items.length === 0`                   | `limit === 0`, runner-ів не створено, повертається `[]`.                                   |
| `items.length > 0 && concurrency >= 1` | Створюється `min(concurrency, items.length)` runner-ів, які паралельно розбирають `items`. |

Шаблон використання модуля `benchmarks/runner-comparison/demo/src/promise-pool.mjs` із зовнішнього коду:

```js
import { promisePool } from './promise-pool.mjs'

const urls = ['/a', '/b', '/c', '/d', '/e']
const results = await promisePool(
  urls,
  async (url, index) => fetchData(url, index),
  2 // максимум 2 одночасні запити
)
// results[i] відповідає urls[i] у тому самому порядку
```

Гарантії, які надає функція `promisePool()`:

- Порядок результатів у поверненому масиві збігається з порядком `items` (досягається за рахунок `results[i] = await worker(items[i], i)`, а не `results.push(...)`).
- Кількість одночасних активних `await worker(...)` ніколи не перевищує `min(concurrency, items.length)`.
- Кожен елемент `items` обробляється рівно один раз — завдяки атомарному (в межах однопотокового JS) інкременту `next++` із захопленням значення в `const i`.
- Функція `promisePool()` не реалізує власних механізмів cancel/timeout/retry: усе це — обов’язок переданого `worker`.
