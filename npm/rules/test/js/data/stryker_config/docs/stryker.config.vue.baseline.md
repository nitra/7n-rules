---
docgen:
  source: npm/rules/test/js/data/stryker_config/stryker.config.vue.baseline.mjs
  crc: a1405dc2
---

# stryker.config.vue.baseline.mjs

## Огляд

Файл `stryker.config.vue.baseline.mjs` — це **базова (еталонна) конфігурація Stryker** для мутаційного тестування Vue-проєктів, яка використовується як тестові дані (fixture) в наборі тестів правил `npm/rules/test/js/data/stryker_config/`. Розташований у директорії `data/stryker_config/` каталогу тестів пакета `npm/rules`, файл слугує канонічним зразком "як має виглядати правильно налаштований `stryker.config.mjs`" для проєкту з Vue Single-File Components.

Файл є простим ES-модулем без логіки: він експортує об'єкт конфігурації за замовчуванням (`export default`). Цей об'єкт повністю описує параметри запуску Stryker mutator-а для Vue-стека (Vitest як test runner, кастомний ignorer для Vue-макросів, increment-кешування, JSON-репортер).

Контекст використання:

- як **очікуваний baseline** (еталон) у тестах правил, що перевіряють або генерують `stryker.config.mjs` для Vue-проєктів;
- як **довідковий шаблон** для команд `n-coverage` / `n-cursor coverage`, які запускають мутаційне тестування у Vue-воркспейсах;
- як **документація-приклад** оптимальних налаштувань (perTest coverage, vitest-runner, incremental, local Vue-macros ignorer plugin).

## Експорти / API

Файл має **єдиний експорт** — `default`.

| Експорт   | Тип                                                 | Опис                                                                |
| --------- | --------------------------------------------------- | ------------------------------------------------------------------- |
| `default` | `PartialStrykerOptions` (з `@stryker-mutator/core`) | Об'єкт конфігурації Stryker для Vue-проєкту з Vitest test runner-ом |

JSDoc-анотація `/** @type {import('@stryker-mutator/core').PartialStrykerOptions} */` встановлює тип об'єкта згідно з офіційним TS-типом Stryker, що дає IDE/TS-серверу повну валідацію полів та автодоповнення.

### Структура експортованого об'єкта

| Ключ                    | Значення                                                                 | Призначення                                                                                                                    |
| ----------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| `testRunner`            | `'vitest'`                                                               | Обирає Vitest як тест-раннер для запуску мутантів                                                                              |
| `vitest.configFile`     | `'vitest.config.js'`                                                     | Шлях до конфігурації Vitest, яку має підхопити vitest-runner                                                                   |
| `coverageAnalysis`      | `'perTest'`                                                              | Аналіз покриття на рівні окремих тестів — для кожного мутанта запускаються лише ті тести, що покривають відповідний рядок коду |
| `tempDirName`           | `'reports/stryker/.tmp'`                                                 | Тимчасова директорія Stryker (зберігається всередині `reports/`, а не в корені)                                                |
| `reporters`             | `['json', 'clear-text']`                                                 | Активні репортери: машинно-читабельний JSON + текстовий вивід у термінал                                                       |
| `jsonReporter.fileName` | `'reports/stryker/mutation.json'`                                        | Куди писати JSON-звіт мутацій                                                                                                  |
| `incremental`           | `true`                                                                   | Вмикає інкрементальний режим: зберігає попередні результати між запусками                                                      |
| `incrementalFile`       | `'reports/stryker/incremental.json'`                                     | Файл-кеш для incremental-режиму                                                                                                |
| `plugins`               | `['@stryker-mutator/vitest-runner', './stryker-vue-macros-ignorer.mjs']` | Підключені Stryker-плагіни: офіційний vitest-runner і локальний ignorer для Vue compiler-macros                                |
| `ignorers`              | `['vue-macros']`                                                         | Активні ignorer-плагіни — ім'я `vue-macros` походить з локального плагіна `./stryker-vue-macros-ignorer.mjs`                   |

## Функції

Файл **не містить функцій** — це чисто декларативний конфіг-модуль, що експортує статичний об'єкт. Жодних викликів, фабрик, factory-функцій чи hook-ів немає.

### Side effects

Side effects на рівні модуля **відсутні**:

- немає `import`-ів (окрім JSDoc type-import у коментарі, який не виконується);
- немає викликів функцій верхнього рівня;
- немає мутацій глобального стану;
- немає I/O.

Файл при `import`-уванні просто повертає літерал об'єкта.

## Залежності

### Прямі імпорти

**Жодних `import`-операторів немає.** Файл самодостатній на рівні JS-завантаження.

### Тип-залежності (лише через JSDoc)

| Пакет                   | Призначення                                                | Спосіб використання                                         |
| ----------------------- | ---------------------------------------------------------- | ----------------------------------------------------------- |
| `@stryker-mutator/core` | Базовий тип `PartialStrykerOptions` для типізації експорту | Через JSDoc `@type {import('...')}` — не впливає на рантайм |

### Імпліцитні runtime-залежності (за іменами рядків)

Конфіг **посилається на зовнішні модулі та файли через рядкові ідентифікатори**, які підвантажує сам Stryker під час виконання:

| Залежність                                               | Тип                | Опис                                                                                                                                                                                    |
| -------------------------------------------------------- | ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `'vitest'` (значення `testRunner`)                       | npm-плагін Stryker | Ім'я раннера — Stryker шукає `@stryker-mutator/vitest-runner` у `node_modules`                                                                                                          |
| `'@stryker-mutator/vitest-runner'` (елемент `plugins`)   | npm-пакет          | Власне реалізація vitest-runner, мусить бути встановленою як devDependency                                                                                                              |
| `'./stryker-vue-macros-ignorer.mjs'` (елемент `plugins`) | локальний модуль   | Кастомний Stryker-плагін у тій самій директорії, що пропускає мутацію Vue compiler-macros (`defineProps`, `defineEmits`, `defineModel`, `defineSlots`, `defineExpose`, `defineOptions`) |
| `'vitest.config.js'` (значення `vitest.configFile`)      | файл воркспейсу    | Конфігурація Vitest у корені тестованого Vue-воркспейсу                                                                                                                                 |
| `'vue-macros'` (елемент `ignorers`)                      | ім'я ignorer-а     | Внутрішнє ім'я ignorer-а, яке експортує `./stryker-vue-macros-ignorer.mjs`                                                                                                              |

## Потік виконання / Використання

### Як файл використовується

1. **Як test-fixture (eталон)** — тестовий код у `npm/rules/test/js/` читає цей файл як еталонний baseline і порівнює з реальним `stryker.config.mjs` у проєктах, що перевіряються правилом.
2. **Як шаблон для генератора** — правило, що автоматично створює/нормалізує `stryker.config.mjs` для Vue-воркспейсів, може використовувати цей файл як вихідну форму.
3. **Як приклад у документації** — для розробників, що налаштовують мутаційне тестування Vue вручну.

### Як цей конфіг виконує Stryker (якщо запустити проти Vue-воркспейсу)

При виклику `bunx stryker run` (чи через `n-cursor coverage`) Stryker:

1. читає експортований об'єкт як `PartialStrykerOptions`;
2. завантажує плагіни зі списку `plugins`:
   - офіційний `@stryker-mutator/vitest-runner` — для запуску мутантів через Vitest;
   - локальний `./stryker-vue-macros-ignorer.mjs` — реєструє ignorer з іменем `'vue-macros'`;
3. активує ignorer-и зі списку `ignorers` — у цьому випадку `'vue-macros'` пропускає мутацію аргументів `defineProps` / `defineEmits` / `defineModel` / `defineSlots` / `defineExpose` / `defineOptions`, оскільки інакше Stryker огортав би їх у coverage-тернарник, який `@vue/compiler-sfc` не зміг би статично проаналізувати, і компіляція SFC падала б;
4. встановлює `testRunner: 'vitest'` і передає йому `vitest.configFile`;
5. виконує **perTest coverage analysis** — заздалегідь запускає тести один раз, фіксує мапу "який тест покриває який рядок", і потім для кожного мутанта виконує лише релевантний підмножину тестів (значно швидше за `command` runner, де довелось би ганяти весь test-suite на кожен мутант);
6. використовує `reports/stryker/.tmp` як тимчасову директорію (всередині `reports/`, щоб не засмічувати корінь);
7. зберігає звіт у `reports/stryker/mutation.json` через `json`-репортер, паралельно друкує `clear-text` у термінал;
8. при `incremental: true` після першого прогону зберігає стан у `reports/stryker/incremental.json`; наступні запуски (особливо noop-прогони, коли код не змінився) виконуються в ~262× швидше (за результатами `benchmarks/runner-comparison/SPIKE.md`, на який посилається коментар у файлі).

### Архітектурні рішення (з коментарів у файлі)

- **`coverageAnalysis: 'perTest'`** — головний приріст швидкості проти `command` runner-а, де довелось би запускати весь test-suite на кожен мутант.
- **Відсутність `inPlace`** — vitest-runner ізолює мутантів у пам'яті через AST-patching, без копіювання `node_modules` у sandbox (стара проблема command runner у Bun monorepo).
- **`concurrency` не задано** — Stryker за замовчуванням обирає `os.cpus().length - 1`, що оптимально для більшості машин.
- **Локальний `vue-macros` ignorer** — обов'язковий для Vue-проєктів, інакше Stryker зламає компіляцію SFC при мутації compiler-macros у блоках `<script setup>`.

### Типовий life-cycle конфіга

```text
import default з stryker.config.vue.baseline.mjs
        |
        v
PartialStrykerOptions → передається в @stryker-mutator/core
        |
        v
плагіни підвантажуються: vitest-runner + локальний ignorer
        |
        v
testRunner='vitest' стартує з vitest.config.js
        |
        v
perTest coverage map будується
        |
        v
для кожного мутанта запускається підмножина тестів,
ignorer 'vue-macros' пропускає Vue compiler-macros
        |
        v
звіт → reports/stryker/mutation.json (+ clear-text у термінал)
        |
        v
incremental.json зберігає стан для наступного запуску
```

## Rebuild Test

Перевірка, що документація відображає реальний вміст файлу:

1. **Експорт**: файл містить **рівно один** `export default` зі статичним об'єктом — підтверджено.
2. **Ключі об'єкта**: рівно 10 ключів верхнього рівня: `testRunner`, `vitest`, `coverageAnalysis`, `tempDirName`, `reporters`, `jsonReporter`, `incremental`, `incrementalFile`, `plugins`, `ignorers` — підтверджено.
3. **Значення**:
   - `testRunner === 'vitest'`
   - `vitest.configFile === 'vitest.config.js'`
   - `coverageAnalysis === 'perTest'`
   - `tempDirName === 'reports/stryker/.tmp'`
   - `reporters` — масив з двох рядків `['json', 'clear-text']`
   - `jsonReporter.fileName === 'reports/stryker/mutation.json'`
   - `incremental === true`
   - `incrementalFile === 'reports/stryker/incremental.json'`
   - `plugins` — масив з двох рядків: `'@stryker-mutator/vitest-runner'` та `'./stryker-vue-macros-ignorer.mjs'`
   - `ignorers` — масив з одного рядка `['vue-macros']`
4. **JSDoc-тип**: `/** @type {import('@stryker-mutator/core').PartialStrykerOptions} */` присутній над `export default` — підтверджено.
5. **Імпорти**: жодного `import`-оператора немає — підтверджено.
6. **Функції**: жодних оголошень функцій (ні `function`, ні стрілкових) — підтверджено.
7. **Side effects на рівні модуля**: відсутні — підтверджено.
8. **Коментарі**: усі ключові рішення (`perTest`, відсутність `inPlace`, `incremental` із посиланням на `benchmarks/runner-comparison/SPIKE.md`, призначення локального `vue-macros` ignorer-а) задокументовані inline-коментарями у вихідному файлі — відображено в розділах "Архітектурні рішення" та "Залежності".

Документація сумісна з вмістом файла і не містить вигаданих фактів.
