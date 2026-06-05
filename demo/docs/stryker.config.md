# stryker.config.mjs

## Огляд

Файл `stryker.config.mjs` — це конфігураційний модуль для [Stryker Mutator](https://stryker-mutator.io/), інструменту mutation testing для JavaScript/TypeScript. Файл розташований у теці `demo/` і експортує дефолтний об'єкт із частковими опціями (`PartialStrykerOptions`), які Stryker зчитує при запуску mutation-прогону в цьому workspace.

Конфігурація `stryker.config.mjs` визначає:

- який раннер тестів використовувати (`command` runner із Bun),
- режим роботи з робочою директорією (`inPlace: true`, без sandbox-копії),
- розташування тимчасових файлів та звітів,
- активні репортери та параметри JSON-репортера,
- режим coverage-аналізу.

Файл написаний у форматі ES Module (розширення `.mjs`), використовує JSDoc-анотацію типу для прив'язки до офіційного типу `PartialStrykerOptions` із пакета `@stryker-mutator/core` — це дає IDE та tsserver підказки і валідацію полів.

## Експорти / API

Файл `stryker.config.mjs` має один експорт — `export default`.

### `export default` (object)

Об'єкт із наступними полями (часткові опції Stryker):

| Поле               | Тип                    | Значення в `stryker.config.mjs`                 | Призначення                                                                                                                                                                                                                                                                                                                                  |
| ------------------ | ---------------------- | ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `testRunner`       | `string`               | `'command'`                                     | Назва раннера тестів. Значення `'command'` вказує Stryker використовувати `@stryker-mutator/command-runner` plugin, який просто виконує зовнішню shell-команду.                                                                                                                                                                              |
| `commandRunner`    | `{ command: string }`  | `{ command: 'bun test' }`                       | Налаштування для `command` testRunner: shell-команда, що запускає тести. Тут — `bun test` (вбудований тест-раннер Bun).                                                                                                                                                                                                                      |
| `inPlace`          | `boolean`              | `true`                                          | Якщо `true`, Stryker мутує файли безпосередньо в робочій директорії, без копіювання в sandbox. Коментар у файлі пояснює дві причини: (1) уникає проблем із hoisted `node_modules` у Bun monorepo (sandbox-копія втрачає resolution залежностей); (2) тести, що читають git/fs-state (integration checks), коректно працюють тільки in-place. |
| `tempDirName`      | `string`               | `'reports/stryker/.tmp'`                        | Шлях до тимчасової директорії Stryker (відносно кореня проєкту). Тут — `reports/stryker/.tmp`.                                                                                                                                                                                                                                               |
| `reporters`        | `string[]`             | `['json', 'clear-text']`                        | Список активних репортерів. `'json'` — машиночитний звіт у JSON, `'clear-text'` — текстовий вивід у stdout.                                                                                                                                                                                                                                  |
| `jsonReporter`     | `{ fileName: string }` | `{ fileName: 'reports/stryker/mutation.json' }` | Налаштування для JSON-репортера: шлях до файлу, у який запишеться звіт. Тут — `reports/stryker/mutation.json`.                                                                                                                                                                                                                               |
| `coverageAnalysis` | `string`               | `'off'`                                         | Режим аналізу покриття. `'off'` означає, що Stryker не використовує coverage-інформацію для оптимізації прогону мутантів — кожен мутант ганяється проти повного набору тестів. Альтернативи: `'all'`, `'perTest'`.                                                                                                                           |

Інших іменованих експортів файл `stryker.config.mjs` не має.

## Функції

Файл `stryker.config.mjs` не визначає жодних функцій. Це чисто декларативний об'єкт-конфіг. Side effects при імпорті — відсутні (модуль лише експортує об'єкт-літерал).

## Залежності

### Runtime-залежності

Файл `stryker.config.mjs` **не імпортує** жодних модулів (відсутні `import` / `require`).

### Type-залежності (через JSDoc)

- `@stryker-mutator/core` — використовується в JSDoc-анотації `@type {import('@stryker-mutator/core').PartialStrykerOptions}` для прив'язки типу до експортованого об'єкта. Це впливає лише на статичну перевірку типів і IDE-підказки; runtime ніяк не залежить від цього пакета саме в `stryker.config.mjs`.

### Зовнішні інструменти, які цей конфіг передбачає у середовищі виконання

- **Stryker CLI** (`@stryker-mutator/core` + його раннер-плагіни, зокрема `@stryker-mutator/command-runner`) — той процес, що читатиме `stryker.config.mjs`.
- **Bun** — оскільки `commandRunner.command` = `'bun test'`, у середовищі повинен бути встановлений `bun` і у workspace мають бути визначені тести, які розуміє `bun test`.

## Потік виконання / Використання

### Як Stryker зчитує `stryker.config.mjs`

1. Користувач або CI запускає Stryker з директорії `demo/` (наприклад, через npm-скрипт або `bunx stryker run`).
2. Stryker автоматично знаходить файл `stryker.config.mjs` у поточній директорії (підтримуються також `.js`, `.cjs`, `.json`).
3. Stryker імпортує дефолтний експорт із `stryker.config.mjs` і мерджить його з власними default-значеннями.

### Як Stryker використовує отримані опції

- За значенням `testRunner: 'command'` Stryker завантажує `@stryker-mutator/command-runner` plugin.
- За `commandRunner.command: 'bun test'` плагін command-runner для кожного мутанта виконує shell-команду `bun test` і за exit-кодом визначає, чи "вбито" мутант.
- За `inPlace: true` Stryker не копіює код у sandbox, а тимчасово редагує файли проєкту in-place. Після кожного мутанта вихідний файл відновлюється.
- За `tempDirName: 'reports/stryker/.tmp'` Stryker створює тимчасову робочу директорію саме за цим шляхом (відносно кореня запуску).
- За `reporters: ['json', 'clear-text']` Stryker наприкінці прогону формує два звіти: JSON-файл та текстовий вивід у stdout.
- За `jsonReporter.fileName: 'reports/stryker/mutation.json'` JSON-репортер пише результат у файл `reports/stryker/mutation.json`.
- За `coverageAnalysis: 'off'` Stryker не намагається асоціювати мутанти з покриттям тестів — кожен мутант перевіряється повним набором тестів (повільніше, але не вимагає coverage-інструментації, яка може бути несумісна з Bun).

### Типовий сценарій використання

```sh
cd demo
bunx stryker run
```

Після завершення:

- у файлі `demo/reports/stryker/mutation.json` буде машиночитний звіт про мутантів,
- у stdout буде людиночитний підсумок (`clear-text` reporter),
- тимчасові файли в `demo/reports/stryker/.tmp` будуть прибрані Stryker'ом.

### Чому саме такі значення

Коментар у `stryker.config.mjs` (рядки 5–6) фіксує обґрунтування `inPlace: true`:

> `inPlace`: уникає hoisted-node_modules issues у Bun monorepo (sandbox-копія втрачає resolution).
> Також тести, що читають git/fs-state (integration checks), працюють тільки in-place.

Тобто `inPlace: true` тут — обов'язкова умова, а не оптимізація: інакше (а) Bun-розв'язання hoisted-залежностей зламається у sandbox-копії, (б) тести, які залежать від реального git-стану або файлової системи, не працюватимуть.
