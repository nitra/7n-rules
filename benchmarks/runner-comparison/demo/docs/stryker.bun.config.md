# stryker.bun.config.mjs

## Огляд

Файл `stryker.bun.config.mjs` — конфігурація Stryker Mutator для запуску mutation testing у демо-проєкті `benchmarks/runner-comparison/demo`, з використанням `bun test` як тест-раннера. Експортує об'єкт `PartialStrykerOptions`, який підхоплюється Stryker CLI (`stryker run --configFile stryker.bun.config.mjs` або через `--config-file`).

Цей конфіг призначений для бенчмарку «runner-comparison»: він має парний файл (наприклад, `stryker.<otherRunner>.config.mjs`) і відрізняється тим, що тести виконуються через зовнішню команду `bun test` замість нативного інтегрованого раннера (Jest/Mocha/Vitest plugin). Через це використано `testRunner: 'command'` + `commandRunner`. Концепція: Stryker не комунікує з тест-раннером по API, а просто запускає shell-команду на кожному мутанті, аналізує exit code/stdout.

Файл є ESM-модулем (розширення `.mjs`) з одним default-експортом — plain object конфігурації.

## Експорти / API

### `default` (default export)

Тип: `import('@stryker-mutator/core').PartialStrykerOptions` (підтверджено JSDoc-анотацією у файлі).

Значення: об'єктний літерал з ключами `testRunner`, `commandRunner`, `inPlace`, `coverageAnalysis`, `concurrency`, `tempDirName`, `reporters`, `jsonReporter`, `incremental`, `incrementalFile`, `mutate`, `timeoutMS`.

Інших іменованих експортів файл не має.

## Функції

Файл `stryker.bun.config.mjs` не містить функцій, класів, hooks чи побічних дій під час імпорту. Це чисто декларативний конфіг — статичний об'єкт без обчислень.

## Поля об'єкта конфігурації

Нижче — повний перелік ключів у default-експорті `stryker.bun.config.mjs`, у тому ж порядку, що й у файлі.

### `testRunner`

- Тип: `string`
- Значення: `'command'`
- Призначення: вказує Stryker використати вбудований command-runner — спосіб запуску тестів через довільну shell-команду. Stryker не знає внутрішнього стану тестів; орієнтується лише на exit code процесу (0 — pass, інше — fail).

### `commandRunner`

- Тип: `{ command: string }`
- Значення: `{ command: 'bun test' }`
- Призначення: визначає shell-команду, яку command-runner виконує для кожного мутанта. У цьому конфізі — `bun test`, тобто Bun-нативний test runner (читає `*.test.{js,mjs,ts}` згідно з налаштуваннями Bun).
- Залежність: вимагає наявності встановленого `bun` у `PATH` і працюючих тестів `bun test` у CWD проєкту.

### `inPlace`

- Тип: `boolean`
- Значення: `true`
- Призначення: Stryker мутує файли «на місці» — прямо в директорії проєкту, замість копіювання в sandbox. Після прогону Stryker відновлює оригінальний вміст. Економить дисковий I/O, особливо коли тестам потрібен повний контекст проєкту (моноріпо, шлях до файлу важливий). Має побічну дію: під час run файли в `src/**/*.mjs` тимчасово модифікуються.

### `coverageAnalysis`

- Тип: `string` (enum: `'off' | 'all' | 'perTest'`)
- Значення: `'off'`
- Призначення: вимкнення coverage-аналізу. Для `testRunner: 'command'` оптимізації типу `perTest` зазвичай недоступні, бо Stryker не може зібрати coverage hits з зовнішньої команди. `'off'` означає: запускати **усі** тести для **кожного** мутанта — повільніше, але універсально й коректно з будь-яким тест-раннером.

### `concurrency`

- Тип: `number`
- Значення: `1`
- Призначення: запускати mutant-runs послідовно, по одному worker-у. Для `inPlace: true` це обов'язково: паралельне мутування одних і тих самих файлів призведе до race conditions. Також полегшує бенчмаркінг (стабільна метрика часу).

### `tempDirName`

- Тип: `string` (path, відносно CWD)
- Значення: `'reports/stryker/.tmp'`
- Призначення: каталог для тимчасових файлів Stryker (сирий sandbox-стан, проміжні артефакти). Винесено під `reports/stryker/.tmp`, щоб усі stryker-артефакти (включно з звітами) лежали в одному дереві `reports/stryker/`.

### `reporters`

- Тип: `string[]`
- Значення: `['json', 'clear-text']`
- Призначення: список ввімкнених репортерів.
  - `'json'` — пише машинно-читаний звіт у JSON (шлях — у полі `jsonReporter.fileName`).
  - `'clear-text'` — друкує summary в stdout (зручно для CI-логів і локального запуску).
- HTML/dashboard-репортери вимкнено, бо конфіг призначений для бенчмарку, а не для подальшого аналізу UI.

### `jsonReporter`

- Тип: `{ fileName: string }`
- Значення: `{ fileName: 'reports/stryker/mutation.json' }`
- Призначення: шлях до файлу json-звіту з результатами мутаційного тестування. Структура — стандартна Stryker mutation report v2 (mutants, statuses, files).

### `incremental`

- Тип: `boolean`
- Значення: `true`
- Призначення: вмикає incremental mode — Stryker зберігає стан попереднього прогону і на наступних викликах перетестовує лише мутанти у файлах, що змінилися (та/або їхні залежні тести). Прискорює локальні re-run-и.

### `incrementalFile`

- Тип: `string` (path, відносно CWD)
- Значення: `'reports/stryker/incremental-bun.json'`
- Призначення: шлях до файлу інкрементального стану. Суфікс `-bun` у назві важливий: бенчмарк має кілька раннерів (наприклад, `incremental-bun.json`, `incremental-node.json` тощо), і кожен повинен мати власний інкрементальний кеш, інакше run-и переплутають стани й деградують точність.

### `mutate`

- Тип: `string[]` (glob patterns)
- Значення: `['src/**/*.mjs']`
- Призначення: glob-патерни файлів, які Stryker мутує. Тут — усі `.mjs` під `src/` рекурсивно. Тестові файли явно не мутуються (зазвичай вони у `test/`, `tests/` чи `*.test.*` — і не потрапляють під `src/**/*.mjs`).

### `timeoutMS`

- Тип: `number` (milliseconds)
- Значення: `60000` (60 секунд)
- Призначення: загальний таймаут на mutant-run. Якщо `bun test` не завершився за 60 c — мутант помічається як `Timeout` і вважається вбитим (killed). Stryker додає до цього значення власний overhead (`timeoutFactor`, `timeoutOffset`) — точну формулу див. у документації Stryker.

## Залежності

### Зовнішні (npm)

- `@stryker-mutator/core` — використовується **типово** (через JSDoc `@type`). Runtime-imports у файлі немає, але без встановленого Stryker конфіг не має сенсу: його читає `stryker` CLI.

### Системні

- `bun` — мусить бути доступним у `PATH`, бо `commandRunner.command === 'bun test'`. Без Bun mutation testing не запуститься.

### Файлова система (очікувані шляхи)

- `src/**/*.mjs` — джерельні файли під мутацію (повинні існувати).
- `reports/stryker/.tmp` — створюється Stryker автоматично під час run.
- `reports/stryker/mutation.json` — створюється/перезаписується після run.
- `reports/stryker/incremental-bun.json` — створюється/оновлюється між run-ами.

Внутрішніх імпортів інших файлів проєкту немає.

## Потік виконання / Використання

### Як цей файл використовується

Файл `stryker.bun.config.mjs` не виконується самостійно. Він підхоплюється Stryker CLI, наприклад:

```bash
bunx stryker run --configFile stryker.bun.config.mjs
# або
npx stryker run --configFile stryker.bun.config.mjs
```

Stryker:

1. Завантажує `stryker.bun.config.mjs` як ESM-модуль і бере `default` export як `PartialStrykerOptions`.
2. Знаходить файли під `mutate: ['src/**/*.mjs']`.
3. Запускає initial test run командою з `commandRunner.command` (`bun test`) — перевіряє, що базові тести проходять.
4. Для кожного знайденого мутанта:
   - Якщо `incremental: true` та мутант не змінений з минулого запуску — пропускає, тягне результат з `incrementalFile`.
   - Інакше: модифікує файл «in place» (`inPlace: true`), виконує `bun test`, чекає до `timeoutMS = 60000` ms.
   - Класифікує мутант: `Killed`, `Survived`, `Timeout`, `NoCoverage` тощо.
   - Відновлює оригінальний вміст файлу.
5. Записує JSON-звіт у `reports/stryker/mutation.json` (через `jsonReporter`).
6. Оновлює інкрементальний стан у `reports/stryker/incremental-bun.json`.
7. Друкує `clear-text`-summary у stdout.
8. Усі тимчасові файли лежать у `reports/stryker/.tmp`.

### Особливості / Підводні камені

- `inPlace: true` + `concurrency: 1` — обов'язкова пара: паралельні мутанти зруйнували б файли одне одному.
- `coverageAnalysis: 'off'` означає, що **усі** тести з `bun test` запускаються для **кожного** мутанта. Це повільно, але точно. Для бенчмарку runner-ів це бажано — рівні умови.
- Окремий `incrementalFile` (`incremental-bun.json`) виключає колізії з іншими runner-конфігами у тій же директорії.
- Якщо `bun test` падає на initial run (без мутацій) — Stryker зупиниться з помилкою «InitialTestRun failed». Перед використанням переконатися, що `bun test` локально зелений.

### Rebuild Test

Щоб відтворити файл `stryker.bun.config.mjs` з нуля за цим документом, треба створити ESM-модуль (розширення `.mjs`) з єдиним default-експортом — об'єктом, що має поля: `testRunner: 'command'`, `commandRunner: { command: 'bun test' }`, `inPlace: true`, `coverageAnalysis: 'off'`, `concurrency: 1`, `tempDirName: 'reports/stryker/.tmp'`, `reporters: ['json', 'clear-text']`, `jsonReporter: { fileName: 'reports/stryker/mutation.json' }`, `incremental: true`, `incrementalFile: 'reports/stryker/incremental-bun.json'`, `mutate: ['src/**/*.mjs']`, `timeoutMS: 60000`. Перед `export default` додати JSDoc `@type {import('@stryker-mutator/core').PartialStrykerOptions}` для IDE-підтримки типів. Жодних імпортів, функцій чи побічних дій не додавати.
