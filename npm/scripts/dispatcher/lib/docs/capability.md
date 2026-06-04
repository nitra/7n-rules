# capability.mjs

## Огляд

Модуль `capability.mjs` реалізує **Capability Router** — шар резолюції режиму оркестрації для підкоманди `flow` диспетчера `n-cursor`. Завдання модуля — відповісти на запитання: «у якому режимі (`native` чи `polyfill`) виконувати flow для оголошеної моделі LLM?».

Ключові архітектурні рішення модуля:

- **Жодної рантайм-детекції моделі.** Модель не вгадується з оточення/процесу — її потрібно **явно оголосити** (CLI-прапорець, env, config). Це відповідає вимозі spec §2.2 проєкту.
- **Чисті функції без I/O.** Усі вхідні джерела (`args`, `env`, `config`, `matrix`, `hasRunner`) приходять параметрами ззовні. Модуль не читає файлову систему, не звертається до мережі та не використовує `process.*` напряму. Завдяки цьому функції тривіально тестуються без моків.
- **Розділення відповідальності.** Сам модуль лише **резолвить** режим і повідомляє про можливість запуску `polyfill`. Власне кидання помилок (`fail`) та інтеграція з runner-ом виконуються caller-ом — `polyfill` без доступного `SubagentRunner` (§15.1) не може стартувати, але рішення про помилку приймається вище за стеком.

Модуль використовується як read-only утиліта диспетчером: спочатку парситься CLI-прапорець `--model`, потім збирається оголошена модель за пріоритетом, далі береться режим оркестрації з `capability-matrix`, і нарешті перевіряється, чи доступний `SubagentRunner` для polyfill-шляху.

## Експорти / API

| Експорт | Тип | Опис |
| --- | --- | --- |
| `DEFAULT_ORCHESTRATION` | константа: `string` (`'polyfill'`) | Дефолтний режим оркестрації, що повертається, коли в `matrix` немає інформації для моделі і не задано `matrix.default.orchestration`. |
| `parseModelFlag(args)` | функція | Витягує значення прапорця `--model <value>` з масиву argv. |
| `declaredModel(sources)` | функція | Повертає оголошену модель за пріоритетом CLI > env > config. |
| `orchestrationFor(model, matrix)` | функція | Резолвить режим оркестрації (`'native' | 'polyfill'`) для оголошеної моделі за матрицею. |
| `polyfillStartable(ctx)` | функція | Перевіряє, чи доступний `SubagentRunner`, необхідний для старту polyfill-режиму. |

Усі експорти — `named exports`; `default export` відсутній.

## Функції

### `parseModelFlag(args)`

**Сигнатура:** `parseModelFlag(args: string[]): string | null`

**Параметри:**

- `args` — масив рядків, що представляє argv підкоманди `flow` (без імені виконуваного файлу). Зазвичай це частина `process.argv`, передана у диспетчер.

**Повертає:**

- `string` — значення, що йде безпосередньо за токеном `--model` в argv.
- `null` — якщо токен `--model` відсутній або є останнім елементом масиву (тобто значення за ним немає).

**Алгоритм:**

1. Знайти індекс першого входження рядка `'--model'` через `Array.prototype.indexOf`.
2. Якщо індекс не `-1` **і** наступний елемент існує (`i + 1 < args.length`) — повернути `args[i + 1]`.
3. Інакше — повернути `null`.

**Side effects:** жодних. Вхідний масив не мутується, лише читається.

**Зауваги:**

- Розпізнається лише форма `--model <value>` через пробіл. Форма `--model=value` цією функцією **не** підтримується.
- Враховується лише перше входження `--model` (наслідок `indexOf`).
- Якщо аргумент після `--model` сам є прапорцем (наприклад, `--model --foo`), він однаково буде повернутий — валідація формату значення не виконується.

### `declaredModel(sources)`

**Сигнатура:** `declaredModel(sources?: { cliModel?: string | null, envModel?: string | null, configModel?: string | null }): string | null`

**Параметри (об’єкт-деструктуризація з дефолтами `null`):**

- `cliModel` — модель, отримана з CLI (зазвичай результат `parseModelFlag`). Найвищий пріоритет.
- `envModel` — модель з env-змінної (за конвенцією проєкту — `N_CURSOR_FLOW_MODEL`). Середній пріоритет.
- `configModel` — модель з конфігураційного файла (ключ `flow.model`). Найнижчий пріоритет.

Усі три поля **опціональні**; виклик без аргументів (`declaredModel()`) валідний завдяки дефолту `= {}`.

**Повертає:**

- `string` — перше істинне (truthy) значення серед `cliModel`, `envModel`, `configModel` у вказаному порядку.
- `null` — якщо всі три джерела falsy (`null`, `undefined`, `''`).

**Алгоритм:** короткозамкнений ланцюг `cliModel || envModel || configModel || null`.

**Side effects:** жодних.

**Зауваги:** оскільки використовується `||`, **порожній рядок** `''` трактується як «не оголошено» і пропускається — це узгоджується з намірами модуля (модель повинна бути не лише визначена, а й непорожня).

### `orchestrationFor(model, matrix)`

**Сигнатура:** `orchestrationFor(model: string | null, matrix: { models?: Record<string, { orchestration?: string }>, default?: { orchestration?: string } }): 'native' | 'polyfill'`

**Параметри:**

- `model` — оголошена модель (зазвичай результат `declaredModel`). Може бути `null`.
- `matrix` — capability-matrix:
  - `matrix.models` — мапа `модель → { orchestration }` з режимом для конкретних моделей.
  - `matrix.default.orchestration` — фолбек-режим для невідомих/неоголошених моделей.

**Повертає:** літеральний рядок `'native'` або `'polyfill'` (типи з JSDoc; у реальності повертається будь-яке рядкове значення, прочитане з матриці, але інваріант протоколу — саме ці два).

**Алгоритм каскадного фолбеку:**

1. Якщо `model` truthy **і** є `matrix.models` — узяти `entry = matrix.models[model]`; інакше `entry = null`.
2. Повернути перше істинне з трьох:
   - `entry?.orchestration` — режим, прописаний для конкретної моделі;
   - `matrix?.default?.orchestration` — дефолт із самої матриці;
   - `DEFAULT_ORCHESTRATION` — глобальний дефолт модуля (`'polyfill'`).

**Side effects:** жодних. Матриця читається ad hoc без копіювання.

**Зауваги:**

- Функція стійка до `null`/`undefined` як `matrix`, так і `matrix.models`/`matrix.default` завдяки явним перевіркам та операторам `&&`.
- Невідома модель (відсутня в `matrix.models`) автоматично потрапляє в гілку `matrix.default` → `DEFAULT_ORCHESTRATION`. Це означає, що нові/незареєстровані моделі за замовчуванням підуть через `polyfill` (за наявності runner-а).

### `polyfillStartable(ctx)`

**Сигнатура:** `polyfillStartable(ctx: { hasRunner: boolean }): boolean`

**Параметри:**

- `ctx.hasRunner` — прапорець наявності `SubagentRunner` у середовищі (відповідно до §15.1 spec). Тип повинен бути саме `boolean`.

**Повертає:**

- `true` — якщо `ctx.hasRunner === true` (strict equality).
- `false` — у будь-якому іншому випадку (`false`, `undefined`, truthy-не-`true`, тощо).

**Алгоритм:** одна перевірка `hasRunner === true`.

**Side effects:** жодних.

**Зауваги:** strict-перевірка свідома — модуль не приймає «приблизно правда» значення (`1`, `'yes'`, об’єкти runner-а тощо). Це змушує caller-а передавати дискретний boolean-прапорець, що дисциплінує контракт.

## Залежності

**Імпорти:** жодних. Модуль **самодостатній** — не залежить ні від npm-пакетів, ні від інших файлів проєкту.

**Глобали / середовище:** не використовуються. Зокрема, не читається `process.argv`, `process.env`, файлова система, мережа.

**Споживачі (caller-и):** модуль очікувано викликається з реалізації підкоманди `flow` диспетчера (`npm/scripts/dispatcher/...`), яка:

1. збирає `args` з `process.argv`;
2. підставляє `process.env.N_CURSOR_FLOW_MODEL` як `envModel`;
3. читає `flow.model` з config-файла як `configModel`;
4. вантажить `capability-matrix` (ймовірно, із статичного JSON/JS);
5. визначає `hasRunner` за наявністю `SubagentRunner` у рантаймі;
6. за результатом `orchestrationFor` + `polyfillStartable` або стартує flow, або кидає помилку.

## Потік виконання / Використання

Типовий ланцюг викликів caller-а:

```js
import {
  parseModelFlag,
  declaredModel,
  orchestrationFor,
  polyfillStartable,
  DEFAULT_ORCHESTRATION,
} from './capability.mjs'

// 1. CLI-парсинг
const cliModel = parseModelFlag(args)

// 2. Резолюція оголошеної моделі за пріоритетом
const model = declaredModel({
  cliModel,
  envModel: process.env.N_CURSOR_FLOW_MODEL ?? null,
  configModel: config?.flow?.model ?? null,
})

// 3. Режим оркестрації за матрицею
const mode = orchestrationFor(model, capabilityMatrix)

// 4. Перевірка можливості старту polyfill
if (mode === 'polyfill' && !polyfillStartable({ hasRunner })) {
  throw new Error('polyfill requires SubagentRunner (spec §15.1)')
}

// 5. Старт flow у режимі mode
startFlow({ mode, model })
```

**Інваріанти потоку:**

- Якщо модель **не оголошена** в жодному з трьох джерел, `declaredModel` повертає `null`. `orchestrationFor(null, matrix)` пропустить `matrix.models` і впаде на `matrix.default` або `DEFAULT_ORCHESTRATION = 'polyfill'`. Тобто за замовчуванням flow без оголошеної моделі піде через `polyfill` — і вимагатиме `SubagentRunner`.
- Caller відповідає за **fail-fast** у разі `mode === 'polyfill' && !hasRunner`. Сам модуль помилок не кидає.
- `DEFAULT_ORCHESTRATION = 'polyfill'` означає: «дефолт — мати polyfill доступним»; це сумісно з ідеєю, що `polyfill` має «працювати з будь-якою моделлю» **лише** за наявності runner-а.

**Таблиця рішень `orchestrationFor`:**

| `model` | `matrix.models[model]` | `matrix.default.orchestration` | Результат |
| --- | --- | --- | --- |
| `'modelA'` | `{ orchestration: 'native' }` | будь-що | `'native'` |
| `'modelB'` | `{ orchestration: 'polyfill' }` | будь-що | `'polyfill'` |
| `'unknownModel'` | відсутній | `'native'` | `'native'` |
| `'unknownModel'` | відсутній | `'polyfill'` | `'polyfill'` |
| `'unknownModel'` | відсутній | відсутній | `DEFAULT_ORCHESTRATION` (`'polyfill'`) |
| `null` | (не дивимось) | `'native'` | `'native'` |
| `null` | (не дивимось) | відсутній | `DEFAULT_ORCHESTRATION` (`'polyfill'`) |

## Rebuild Test

На основі цієї документації модуль `capability.mjs` можна повністю відтворити: він складається з однієї константи `DEFAULT_ORCHESTRATION = 'polyfill'` та чотирьох чистих експортних функцій (`parseModelFlag`, `declaredModel`, `orchestrationFor`, `polyfillStartable`) з описаними вище сигнатурами, алгоритмами та інваріантами; жодних імпортів, жодного I/O, жодного default-export — тільки named exports.
