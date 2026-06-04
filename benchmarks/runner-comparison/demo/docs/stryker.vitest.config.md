# stryker.vitest.config.mjs

## Огляд

Файл `stryker.vitest.config.mjs` — це конфігураційний модуль для інструменту мутаційного тестування `@stryker-mutator/core`, налаштований під запуск через `vitest` як test runner. Файл розташований у `benchmarks/runner-comparison/demo/` і використовується у бенчмарках порівняння різних test runners (зокрема `vitest`) на однакових мутантах.

Модуль експортує дефолтний об'єкт типу `PartialStrykerOptions` (тип з пакета `@stryker-mutator/core`), який Stryker зчитує при запуску CLI-команди `stryker run stryker.vitest.config.mjs` (або через автоматичний пошук конфіг-файлу).

Формат файлу — ECMAScript Modules (`.mjs`), використовується `export default` синтаксис.

## Експорти / API

Файл `stryker.vitest.config.mjs` містить єдиний експорт:

- `export default` — об'єкт-конфігурація типу `import('@stryker-mutator/core').PartialStrykerOptions`.

Іменованих експортів немає. Функцій файл не оголошує.

### Структура експортованого об'єкта

| Ключ | Тип | Значення у файлі | Призначення |
| --- | --- | --- | --- |
| `testRunner` | `string` | `'vitest'` | Назва test runner-плагіна, який Stryker використовує для прогону тестів на мутантах. Очікує встановлений пакет `@stryker-mutator/vitest-runner`. |
| `vitest` | `object` | `{ configFile: 'vitest.config.js' }` | Опції, специфічні для `vitest` runner. Поле `configFile` вказує шлях до vitest-конфігу відносно cwd запуску Stryker. |
| `vitest.configFile` | `string` | `'vitest.config.js'` | Шлях до файлу конфігурації `vitest`, який буде використано при прогоні тестів на мутантах. |
| `coverageAnalysis` | `string` | `'perTest'` | Режим аналізу покриття. Значення `'perTest'` означає, що Stryker запам'ятовує, які тести покривають який код, і запускає лише релевантні тести на кожному мутанті. |
| `tempDirName` | `string` | `'reports/stryker/.tmp'` | Шлях до тимчасової директорії, у якій Stryker створює sandbox-копії проєкту. |
| `reporters` | `string[]` | `['json', 'clear-text']` | Список репортерів. `'json'` — машинно-читаний звіт, `'clear-text'` — текстовий summary у stdout. |
| `jsonReporter` | `object` | `{ fileName: 'reports/stryker/mutation.json' }` | Опції для json-репортера. |
| `jsonReporter.fileName` | `string` | `'reports/stryker/mutation.json'` | Шлях до файлу, куди json-репортер пише підсумковий звіт мутаційного прогону. |
| `incremental` | `boolean` | `true` | Увімкнено інкрементальний режим: Stryker перезапускає лише мутанти, що стосуються змінених файлів/тестів. |
| `incrementalFile` | `string` | `'reports/stryker/incremental-vitest.json'` | Шлях до файлу-стейту інкрементального режиму, у який Stryker записує результати попередніх прогонів для повторного використання. |
| `mutate` | `string[]` | `['src/**/*.mjs']` | Glob-патерни файлів, які Stryker мутує. Тут — усі `.mjs`-файли в директорії `src/`. |
| `timeoutMS` | `number` | `60000` | Таймаут (мс) на прогон тест-сюїти для одного мутанта. 60000 мс = 60 секунд. |

## Функції

Файл `stryker.vitest.config.mjs` не оголошує жодних функцій. Це декларативний конфіг-об'єкт. Поведінкові сторонні ефекти виникають лише при імпорті файлу інструментом Stryker (зчитування дефолтного експорту); сам модуль не виконує жодного коду на момент імпорту, окрім обчислення літералу об'єкта.

## Залежності

### Зовнішні залежності (за типом)

- `@stryker-mutator/core` — використовується лише як джерело типу `PartialStrykerOptions` через JSDoc-аннотацію `/** @type {import('@stryker-mutator/core').PartialStrykerOptions} */`. На runtime пакет не імпортується в цьому файлі, але має бути встановлений у проєкті, бо саме CLI `stryker` зчитує конфіг.
- `@stryker-mutator/vitest-runner` — потрібен у проєкті, бо `testRunner: 'vitest'` посилається на цей плагін; у файлі не імпортується явно.
- `vitest` — runtime-залежність test runner, очікувана у проєкті.

### Внутрішні залежності (шляхи у конфізі)

- `vitest.config.js` — конфіг vitest, на який посилається `vitest.configFile`. Має існувати у тій же cwd, з якої запускається Stryker.
- `src/**/*.mjs` — джерельні файли, що мутуються (через `mutate`).
- `reports/stryker/.tmp` — тимчасова директорія для sandbox (через `tempDirName`).
- `reports/stryker/mutation.json` — вихідний файл json-репортера (через `jsonReporter.fileName`).
- `reports/stryker/incremental-vitest.json` — файл стану інкрементального режиму (через `incrementalFile`).

### Імпорти / require

Жодних `import` чи `require` у файлі немає — конфіг суто декларативний.

## Потік виконання / Використання

### Як Stryker використовує файл `stryker.vitest.config.mjs`

1. Користувач (або CI) запускає Stryker CLI у директорії `benchmarks/runner-comparison/demo/`, наприклад: `npx stryker run stryker.vitest.config.mjs` або `stryker run -c stryker.vitest.config.mjs`.
2. Stryker динамічно імпортує файл `stryker.vitest.config.mjs` і читає його дефолтний експорт як `PartialStrykerOptions`.
3. Stryker зливає прочитані опції зі своїми дефолтами та валідує їх.
4. Stryker ініціалізує `vitest` runner (через `@stryker-mutator/vitest-runner`), передавши йому `configFile: 'vitest.config.js'`.
5. Stryker формує множину файлів для мутацій за патерном `src/**/*.mjs` (значення з `mutate`).
6. Перед прогоном мутантів Stryker виконує початковий dry-run тестів для збору покриття `perTest` (опція `coverageAnalysis: 'perTest'`), що дозволить запускати тільки релевантні тести на кожному мутанті.
7. Stryker створює sandbox-копію проєкту у `reports/stryker/.tmp` (опція `tempDirName`) і прогонить мутанти.
8. Якщо `incremental: true` і файл `reports/stryker/incremental-vitest.json` існує — Stryker завантажує попередній стан і обмежує множину мутантів змінами; інакше будує стан з нуля.
9. На кожний мутант Stryker запускає тести через vitest з таймаутом `60000` мс (опція `timeoutMS`); якщо тести не вкладаються — мутант помічається як `Timeout`.
10. Після завершення Stryker викликає репортери з опції `reporters`:
    - `'json'` пише підсумковий звіт у файл `reports/stryker/mutation.json` (шлях з `jsonReporter.fileName`);
    - `'clear-text'` друкує текстову зведенку результатів у stdout.
11. Stryker оновлює інкрементальний файл `reports/stryker/incremental-vitest.json` поточними результатами для наступного запуску.

### Контекст використання у бенчмарках

Файл `stryker.vitest.config.mjs` — частина набору демо-конфігів у `benchmarks/runner-comparison/demo/`, де паралельно існують конфіги для інших test runners (наприклад, для Jest/Node test). Конфіг `stryker.vitest.config.mjs` забезпечує однакові параметри Stryker (мутації, репортери, інкрементальність, таймаут, sandbox-директорія) для прогону на одному й тому ж коді, але з vitest у ролі test runner. Це дозволяє порівнювати продуктивність і поведінку різних runners на ідентичному наборі мутантів.

### Очікувані передумови

- Установлені пакети `@stryker-mutator/core`, `@stryker-mutator/vitest-runner`, `vitest`.
- Існує файл `vitest.config.js` у тій же cwd.
- Існує директорія `src/` із файлами `.mjs`, які буде мутовано.
- Директорія `reports/stryker/` доступна для запису (Stryker створить її при потребі).

### Rebuild Test (відтворення файлу за документом)

Щоб відтворити файл `stryker.vitest.config.mjs` за цим документом, потрібно створити `.mjs`-модуль із JSDoc-аннотацією типу `import('@stryker-mutator/core').PartialStrykerOptions` над `export default`, який повертає об'єкт із полями: `testRunner: 'vitest'`; `vitest: { configFile: 'vitest.config.js' }`; `coverageAnalysis: 'perTest'`; `tempDirName: 'reports/stryker/.tmp'`; `reporters: ['json', 'clear-text']`; `jsonReporter: { fileName: 'reports/stryker/mutation.json' }`; `incremental: true`; `incrementalFile: 'reports/stryker/incremental-vitest.json'`; `mutate: ['src/**/*.mjs']`; `timeoutMS: 60000`.
