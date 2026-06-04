# `vitest.config.js`

## Огляд

Файл `vitest.config.js` — кореневий конфігураційний модуль тест-раннера [Vitest](https://vitest.dev/) для воркспейсу `demo/`. Він задає, які файли вважаються тестами, у якому середовищі вони виконуються та як збирається покриття коду. Файл використовує ES Module-синтаксис (`import` / `export default`) і призначається для виконання Vitest CLI під час запуску команд штибу `vitest`, `vitest run`, `vitest --coverage`.

Конфігурація навмисно покриває дві паралельні розкладки тестів у проєкті `demo/`:

1. Юніт-/модульні тести, розташовані поряд із кодом, але всередині піддиректорій `tests/` (відповідно до внутрішньої `test`-конвенції правила).
2. Top-level integration suites у `<root>/tests/**`.

## Експорти / API

| Експорт | Тип | Опис |
| --- | --- | --- |
| `default` | `UserConfig` (об'єкт-результат виклику `defineConfig`) | Конфіг Vitest, що його автоматично підхоплює Vitest CLI з кореня воркспейсу `demo/`. |

Інших іменованих експортів файл `vitest.config.js` не має.

### Структура default-експорту

`defineConfig({ test })` повертає об'єкт із єдиним полем `test`, у якому містяться такі властивості:

- `test.include: string[]` — масив glob-патернів, що включають тестові файли:
  - `'**/*.test.{js,mjs}'` — рекурсивний пошук файлів `*.test.js` та `*.test.mjs` у будь-якій директорії проєкту (зокрема у вкладених `tests/`).
  - `'tests/**/*.test.{js,mjs}'` — додаткова, явна вибірка тестів із top-level директорії `tests/` від кореня воркспейсу `demo/`.
- `test.environment: 'node'` — тестове середовище Node.js (без емуляції браузера/JSDOM); жодних глобалів DOM, `window`, `document`.
- `test.coverage: { provider: 'v8', reporter: ['lcov', 'text-summary'] }` — налаштування покриття:
  - `provider: 'v8'` — нативний V8 coverage без інструментування коду (швидше за `istanbul`).
  - `reporter: ['lcov', 'text-summary']` — генерує LCOV-звіт (для CI/Codecov/IDE) та текстовий підсумок у stdout.

## Функції

### `defineConfig(config)`

- Походження: імпорт `import { defineConfig } from 'vitest/config'`.
- Сигнатура: `defineConfig(config: UserConfig | UserConfigFn | UserConfigExport): UserConfigExport`.
- Параметри:
  - `config` — об'єкт конфігу Vitest (тип `UserConfig` із пакета `vitest/config`). У поточному файлі передається літерал `{ test: { include, environment, coverage } }`.
- Що повертає: тип-проксі для конфігу, ідентичний переданому, але з типобезпекою та IDE-автокомплітом (TypeScript). На рантаймі — той самий об'єкт.
- Side effects: відсутні. `defineConfig` — це pure identity-функція-помічник; вона не змінює глобальний стан і не звертається до файлової системи.

У файлі `vitest.config.js` визначено єдиний виклик `defineConfig(...)`, результат якого присвоюється `export default`. Власних функцій (декларацій або стрілкових) файл не містить.

## Залежності

| Залежність | Імпорт | Призначення |
| --- | --- | --- |
| `vitest/config` | `import { defineConfig } from 'vitest/config'` | Надає типобезпечну функцію-помічник `defineConfig` для побудови конфігу Vitest. Це пакет, який постачається разом із `vitest` (dev-dependency). |

Файл не має внутрішніх (відносних) залежностей: жодного `import './...'` чи `import '../...'`. Конфіг також не читає змінні середовища, файли чи будь-які зовнішні ресурси.

Транзитивно конфіг впливає на:

- Vitest CLI (`vitest`, `vitest run`, `vitest --coverage`) — споживач default-експорту.
- `@vitest/coverage-v8` — провайдер покриття, обраний у `test.coverage.provider`. Має бути доступний у `devDependencies` (інакше Vitest повідомить про відсутність провайдера при `--coverage`).

## Потік виконання / Використання

1. Користувач/CI запускає Vitest у воркспейсі `demo/` командою на кшталт `vitest`, `vitest run`, `bun run test`, `bun run test --coverage` тощо.
2. Vitest CLI шукає файл конфігу за конвенцією (`vitest.config.{js,mjs,ts,...}`) у поточній директорії та знаходить `vitest.config.js`.
3. Vitest імпортує `vitest.config.js` як ES-модуль і читає `default`-експорт.
4. На рівні модуля виконується `import { defineConfig } from 'vitest/config'`, потім будується об'єкт `{ test: { include, environment, coverage } }` і передається у `defineConfig(...)`. Повернутий конфіг присвоюється `export default`.
5. Vitest застосовує конфіг:
   - Сканує файлову систему та збирає список тестів, що задовольняють принаймні один із glob-патернів `test.include` — `**/*.test.{js,mjs}` або `tests/**/*.test.{js,mjs}`. Файли поза цими патернами (наприклад, `*.spec.ts`, `*.test.ts`) у цій конфігурації **не** запускаються.
   - Виконує тести у Node.js-середовищі (`test.environment === 'node'`); глобалі DOM відсутні.
   - Якщо CLI запущено з прапором покриття (`--coverage`), Vitest активує провайдера `v8` і пише звіти у форматах `lcov` (зазвичай у `coverage/lcov.info`) та `text-summary` (в stdout).

### Rebuild Test (логічна реконструкція)

Семантично еквівалентний код, який можна було б написати замість файлу `vitest.config.js`:

```js
import { defineConfig } from 'vitest/config'

const config = {
  test: {
    include: ['**/*.test.{js,mjs}', 'tests/**/*.test.{js,mjs}'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['lcov', 'text-summary']
    }
  }
}

export default defineConfig(config)
```

Поведінка Vitest з цією реконструкцією повністю збігається з поведінкою `vitest.config.js`: ті ж glob-патерни включення тестів, те ж середовище `node`, той же провайдер покриття `v8` та ті ж репортери `lcov` і `text-summary`.
