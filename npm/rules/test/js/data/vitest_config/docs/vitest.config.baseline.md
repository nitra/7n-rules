# vitest.config.baseline.js

## Огляд

Файл `vitest.config.baseline.js` — це **еталонна (baseline) конфігурація Vitest**, яка використовується як test-data fixture у правилі `test` пакета `npm/rules`. Він задає мінімальний, але достатній набір опцій Vitest, що відповідає внутрішнім конвенціям проєкту: розкладку тестових файлів, exclude-патерни для штучних artefact-директорій (наприклад, sandbox-копій Stryker), середовище виконання та модель ізоляції паралельних воркерів.

Файл одночасно виконує дві ролі:

1. **Робоча конфігурація Vitest** — повністю валідний модуль, який можна передати в `vitest run` чи `vitest --config <path>`. Vitest імпортує `default`-export і використовує його як свої налаштування.
2. **Канонічний приклад (baseline) для перевірок rule `test`** — зберігається у `data/vitest_config/`, де `data/` — стандартна тека fixture-даних для правил у `npm/rules`. Інші конфіги в цьому проєкті (або їхні фрагменти) можуть порівнюватися з цим baseline, щоб гарантувати єдиний стиль.

Ключове технічне рішення, зафіксоване у файлі через коментарі, — використання `pool: 'forks'` замість дефолтного `pool: 'threads'` для уникнення гонок навколо `process.chdir()` у тестових фікстурах (детально див. ## Функції / Конфігурація).

## Експорти / API

Модуль має один **default export** — об'єкт-конфігурація Vitest, обгорнутий у `defineConfig()`:

```js
export default defineConfig({ test: { /* ... */ } })
```

| Експорт | Тип | Призначення |
| --- | --- | --- |
| `default` | `UserConfig` (тип Vitest) | Об'єкт конфігурації для команди `vitest`. Підхоплюється автоматично, якщо файл лежить за дефолтним ім'ям `vitest.config.{js,mjs,ts}` у корені проєкту, або задається явно через `--config`. |

Іменованих експортів немає.

### Структура default-export

Об'єкт містить єдиний верхньорівневий ключ `test`, всередині якого:

| Ключ | Тип | Значення | Призначення |
| --- | --- | --- | --- |
| `test.include` | `string[]` | `['**/*.test.{js,mjs}', 'tests/**/*.test.{js,mjs}']` | Glob-патерни файлів, які Vitest вважає тестами. |
| `test.exclude` | `string[]` | `['**/node_modules/**', '**/dist/**', '**/reports/stryker/**']` | Glob-патерни, виключені зі сканування. |
| `test.environment` | `string` | `'node'` | Тестове середовище — Node.js (без jsdom/happy-dom). |
| `test.pool` | `string` | `'forks'` | Модель ізоляції воркерів — окремі процеси на тест-файл. |
| `test.coverage` | `object` | `{ provider: 'v8', reporter: ['lcov', 'text-summary'] }` | Налаштування покриття: V8-провайдер, репортери `lcov` + `text-summary`. |

## Функції

Файл **не містить власних функцій** — це чисто декларативний конфігураційний модуль. Єдиний виклик — `defineConfig(...)`, імпортований з `vitest/config`.

### `defineConfig(config)`

| Атрибут | Значення |
| --- | --- |
| Походження | Імпортується з пакета `vitest/config` (named export). |
| Сигнатура | `defineConfig(config: UserConfig | UserConfigFn): UserConfig` |
| Параметри | `config` — об'єкт конфігурації Vitest або функція, що повертає такий об'єкт (підтримується async-варіант). У цьому файлі передається статичний літерал. |
| Повертає | Той самий об'єкт (identity для runtime), але з повною TypeScript-типізацією — без `defineConfig` IDE не підказувала б ключі. |
| Side effects | Немає. Функція — idempotent type-helper. |

### Конфігурація — поле за полем

**`test.include`**

- Значення: `['**/*.test.{js,mjs}', 'tests/**/*.test.{js,mjs}']`.
- Семантика: підхоплюються **обидві основні розкладки** тестів, прийняті в монорепо:
  - Тести **поряд із кодом** у піддиректоріях `tests/` (test.mdc-конвенція пакета `npm/rules` — кожне правило тримає свої тести у `<rule>/tests/`).
  - Top-level **integration suites** у `<root>/tests/`.
- Glob-патерн `**/*.test.{js,mjs}` рекурсивно охоплює обидва випадки; другий патерн `tests/**/*.test.{js,mjs}` залишений як надлишково-явна декларація для читабельності та узгодженості з документацією.

**`test.exclude`**

- Значення: `['**/node_modules/**', '**/dist/**', '**/reports/stryker/**']`.
- Перші два патерни — стандартні для Node-проєктів (vendor-залежності та build-артефакти).
- **Критичний патерн** `**/reports/stryker/**` виключає sandbox-копії тестів, які Stryker (mutation testing) залишає у `reports/stryker/.tmp/` після incremental- або aborted-runs. Без цього exclude команда `vitest run --coverage` підхоплює ці копії і вони **фейляться**, бо стартують поза реальним repo root. Детальна мотивація фіксована inline-коментарем.

**`test.environment`**

- Значення: `'node'`.
- Тести виконуються у звичайному Node.js-середовищі: без DOM-стабів, без `window`/`document`. Це коректний вибір для CLI- та rule-логіки, що становить основну масу коду в `npm/rules`.

**`test.pool`**

- Значення: `'forks'` (замість дефолтного `'threads'`).
- **Defense-in-depth ізоляція процесів** між тест-файлами. Мотивація:
  - У дефолтному `pool: 'threads'` усі воркери ділять **один спільний процес Node.js** → кожен `process.chdir(dir)` всередині фікстури **перехоплює cwd сусіда** посеред його FS- або `git`-операції.
  - Зафіксований реальний інцидент: `git init` + `git commit` із tmp-фікстури **потрапив у реальний робочий репозиторій**, бо cwd змінився в момент виклику Git.
  - `pool: 'forks'` дає кожному файлу окремий процес → `process.chdir` локальний, ізоляція гарантована.
  - Канонічний патерн тестів, прийнятий у проєкті, — `withTmpDir(async dir => ...)` (зафіксований у `test.mdc`).

**`test.coverage`**

- Значення: `{ provider: 'v8', reporter: ['lcov', 'text-summary'] }`.
- `provider: 'v8'` — нативне покриття від V8 engine (без інструментації Istanbul) — швидше та точніше для сучасного Node.
- `reporter`:
  - `'lcov'` — машиночитний формат (`lcov.info`) для імпорту в CI / SonarQube / Codecov.
  - `'text-summary'` — компактний текстовий звіт у stdout для локального запуску й логів CI.

### Side effects модуля

Side effects відсутні. Файл — pure declarative module: на import-time не відбувається мутації глобального стану, відкриття дескрипторів чи мережевих з'єднань. Vitest сам інтерпретує об'єкт у власному lifecycle.

## Залежності

### Зовнішні (npm)

| Пакет | Імпорт | Призначення |
| --- | --- | --- |
| `vitest/config` | `import { defineConfig } from 'vitest/config'` | Сабпакет основного пакета `vitest`. Експортує `defineConfig` — type-helper, що дає TypeScript-/IDE-підказки для об'єкта конфігурації. Має бути доступним як devDependency. |

### Внутрішні залежності проєкту

Жодних internal-імпортів — файл є кінцевим листком тестового data-fixture.

### Транзитивні / runtime

На етапі реального тестового виконання задіюються (поза цим файлом):

- `vitest` — раннер, який споживає об'єкт конфігурації.
- `@vitest/coverage-v8` — окремий пакет coverage-провайдера V8, потрібен, якщо запускати з `--coverage` (іноді постачається як peer-dependency).

## Потік виконання / Використання

### Як baseline-fixture для правила `test`

Файл лежить у `npm/rules/test/js/data/vitest_config/` — типовій теці `data/`, де правила пакета `npm/rules` зберігають **референсні приклади (fixtures)** для:

- snapshot-порівнянь з конфігами користувацьких проєктів,
- pattern-matching у перевірках (наприклад, чи містить чужий `vitest.config.js` необхідні ключі),
- авто-генерації / migration-кроків (rule може запропонувати оновити чужий конфіг до baseline).

Конкретний механізм споживання baseline залежить від реалізації check-функцій правила (`check-*.mjs`), але типова схема така:

1. Rule отримує цільовий `vitest.config.{js,mjs,ts}` проєкту.
2. Парсить його (через AST або динамічний import у sandbox) та зіставляє з baseline.
3. Емітить попередження / автофікс, якщо ключові поля (`pool`, `exclude`, `coverage.provider`) відхиляються від baseline.

### Як робоча конфігурація Vitest

Файл повністю придатний до прямого використання Vitest-CLI:

```bash
vitest run --config npm/rules/test/js/data/vitest_config/vitest.config.baseline.js
```

або копіюванням у корінь споживчого проєкту під ім'ям `vitest.config.js`.

Lifecycle:

1. Vitest CLI завантажує модуль через ESM-loader Node.
2. `defineConfig` повертає той самий об'єкт; default-export потрапляє у Vitest internals.
3. Vitest застосовує `test.include`/`test.exclude` для discovery, потім ініціалізує `forks`-pool, для кожного знайденого файлу спавнить child-process з `environment: 'node'`.
4. Якщо запуск із `--coverage` — після проходу збирається V8-coverage і пишеться `lcov.info` + текстовий summary.

### Інваріанти, що треба зберігати при правках

- **Не змінювати `pool: 'forks'` на `'threads'`** без явного перегляду всіх тестів на `process.chdir` — це регрес з ризиком пошкодження реального репозиторію.
- **Не видаляти `**/reports/stryker/**` з `exclude`** — інакше coverage-run починає підхоплювати mutation-sandbox-копії.
- **Не додавати `test.environment: 'jsdom'`** без потреби — це повільніше і неактуально для текстової/CLI-логіки `npm/rules`.

## Rebuild Test

Файл — конфігурація без власної логіки, тому ребілд-тест зводиться до перевірки структурної відповідності default-export очікуваним полям. Орієнтовний smoke-тест на Vitest (псевдокод):

```js
import { describe, it, expect } from 'vitest'
import config from './vitest.config.baseline.js'

describe('vitest.config.baseline.js', () => {
  it('експортує об`єкт із секцією test', () => {
    expect(config).toBeTypeOf('object')
    expect(config.test).toBeTypeOf('object')
  })

  it('include охоплює дві канонічні розкладки', () => {
    expect(config.test.include).toEqual([
      '**/*.test.{js,mjs}',
      'tests/**/*.test.{js,mjs}'
    ])
  })

  it('exclude містить stryker-sandbox', () => {
    expect(config.test.exclude).toContain('**/reports/stryker/**')
  })

  it('environment === node', () => {
    expect(config.test.environment).toBe('node')
  })

  it('pool === forks (захист від chdir-гонок)', () => {
    expect(config.test.pool).toBe('forks')
  })

  it('coverage: v8 + lcov + text-summary', () => {
    expect(config.test.coverage.provider).toBe('v8')
    expect(config.test.coverage.reporter).toEqual(['lcov', 'text-summary'])
  })
})
```

Цього достатньо, щоб зафіксувати baseline як invariant — будь-яка спроба змінити критичні поля без узгодження впаде на smoke-тесті.
