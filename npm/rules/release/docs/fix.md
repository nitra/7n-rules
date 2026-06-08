# fix.mjs — точка входу правила `release`

## Огляд

Файл `npm/rules/release/fix.mjs` — це **точка входу (entry-point)** для правила `release` у системі правил репозиторію. Він виконує дві ролі:

1. **Library mode** — експортує асинхронну функцію `run(ctx)`, яку викликають інші скрипти/оркестратори через `import + run(ctx)`. Делегує виконання у стандартний раннер правил `runStandardRule`.
2. **CLI mode** — якщо файл запущено напряму як standalone-скрипт (`node fix.mjs` або через bun), він викликає `runRuleCli` й завершує процес кодом виходу (`process.exit`), щоб CI/IDE могли орієнтуватися на exit-code.

Сам файл не містить жодної бізнес-логіки правила: всі перевірки (`applies → JS-concerns → policy → mdc-refs`) живуть у супровідних модулях каталогу `npm/rules/release/`, а оркестрацію виконує `runStandardRule`. Це — лише тонкий адаптер між іменем правила (визначається як ім'я каталогу через `import.meta.dirname`) і загальним механізмом запуску правил.

## Експорти / API

| Експорт | Тип                               | Призначення                                                                             |
| ------- | --------------------------------- | --------------------------------------------------------------------------------------- |
| `run`   | `function(ctx?): Promise<number>` | Library-mode запуск правила. Повертає exit-code: `0` — без порушень, `1` — є порушення. |

Інших публічних експортів (типів, констант, default-експорту) файл не оголошує.

## Функції

### `run(ctx)`

```js
/**
 *
 */
export function run(ctx) {
  return runStandardRule(import.meta.dirname, ctx)
}
```

- **Сигнатура:** `run(ctx?: RuleContext): Promise<number>`
- **Параметри:**
  - `ctx` (необов'язковий) — об'єкт типу `RuleContext`, імпортований із `../../scripts/lib/run-standard-rule.mjs`. Передається через виклик і несе спільний стан прогону (наприклад, `walkCache` для повторного використання обходу файлової системи між декількома правилами в одному прогоні). Якщо `ctx` не передано, стандартний раннер працює без зовнішнього кешу.
- **Повертає:** `Promise<number>` — exit-code правила:
  - `0` — порушень не знайдено;
  - `1` — знайдені порушення (їх вже надруковано/зібрано раннером).
- **Side effects:** Безпосередньо у тілі `run` сайд-ефектів немає — функція просто проксує виклик у `runStandardRule`. Усі реальні ефекти (читання файлів, обчислення `applies`, друк звітів, mdc-refs-перевірки) залежать від реалізації `runStandardRule` і відповідних check-модулів каталогу правила.
- **Як визначає ім'я правила:** через `import.meta.dirname` — абсолютний шлях до каталогу `npm/rules/release/`. `runStandardRule` сам витягне з нього базове ім'я (`release`), знайде сусідні check-модулі (`check-*.mjs`, `applies.mjs`, `policy.*` тощо) й оркеструє конвеєр.

### CLI-блок (модульний top-level код)

```js
if (isRunAsCli(import.meta.url)) {
  // eslint-disable-next-line n/no-process-exit -- standalone entry-point має повертати exit-code для CI/IDE
  process.exit(await runRuleCli(import.meta.dirname))
}
```

- **Не є функцією**, але це частина public-API файлу як CLI-скрипта.
- **Умова виконання:** `isRunAsCli(import.meta.url)` повертає `true` лише коли файл є точкою входу процесу (а не імпортований як модуль). Це класичний еквівалент Node-патерна `require.main === module` для ESM.
- **Дія:** Дочекатися `runRuleCli(import.meta.dirname)` (top-level `await`) і завершити процес із отриманим exit-code через `process.exit`.
- **ESLint:** Спеціально дозволено `n/no-process-exit` і `unicorn/no-process-exit` — standalone-entry-point має повертати CI-сумісний код.
- **Side effects:** Завершує Node-процес. Через top-level `await` блокує закриття модульного завантаження, поки CLI-прогін не завершиться.

## Залежності

Файл імпортує **дві** утиліти з локальної бібліотеки скриптів репозиторію (відносні шляхи до `npm/scripts/lib/`):

- `../../scripts/lib/run-rule-cli.mjs`
  - **`isRunAsCli(metaUrl: string): boolean`** — перевіряє, чи модуль викликано як CLI, а не як `import`.
  - **`runRuleCli(ruleDir: string): Promise<number>`** — CLI-обгортка над раннером: парсить аргументи, налаштовує оточення прогону як standalone і повертає exit-code.
- `../../scripts/lib/run-standard-rule.mjs`
  - **`runStandardRule(ruleDir: string, ctx?: RuleContext): Promise<number>`** — стандартний конвеєр правила: дізнається, до яких файлів воно застосовується (`applies`), запускає JS-concerns (зазвичай файли `check-*.mjs`), policy-перевірки і `mdc-refs` (узгодженість з `.mdc`-документами), збирає й виводить порушення.
  - **Тип `RuleContext`** — структура контексту прогону. Цей файл лише re-references його в JSDoc-`@param`.

Жодних інших імпортів (зовнішніх npm-пакетів, Node core-модулів, динамічних `import()`) немає. Глобально використовується лише `process` (Node-built-in) — у CLI-блоці для `process.exit`.

## Потік виконання / Використання

### Library mode (виклик з іншого модуля)

```js
import { run } from './npm/rules/release/fix.mjs'

const exitCode = await run(ctx) // ctx — опційний
if (exitCode !== 0) {
  // знайдено порушення правила release
}
```

Послідовність:

1. Викликач робить `import { run } from '.../release/fix.mjs'`.
2. Виклик `run(ctx)` → `runStandardRule(import.meta.dirname, ctx)`.
3. `runStandardRule` визначає каталог правила (`release`), знаходить і запускає сусідні модулі правила (`applies` → JS-concerns → policy → mdc-refs), обмінюючись із викликачем кешем через `ctx` (за наявності).
4. Повертається числовий exit-code (`0`/`1`).

### CLI mode (запуск файлу як скрипта)

```bash
node npm/rules/release/fix.mjs
# або через bun
bun run npm/rules/release/fix.mjs
```

Послідовність:

1. Node/Bun стартує файл як точку входу — `isRunAsCli(import.meta.url)` повертає `true`.
2. `await runRuleCli(import.meta.dirname)` запускає CLI-обгортку правила: парсить можливі аргументи/прапорці, ініціалізує стандартне середовище правила, всередині сам викликає аналог `runStandardRule` і повертає exit-code.
3. `process.exit(<exitCode>)` завершує процес: CI-конвеєр або IDE-runner отримує `0` (успіх) або `1` (порушення).

### Типове місце у системі правил

Файл є членом сім'ї однотипних entry-point'ів `npm/rules/<rule-name>/fix.mjs`: кожне правило репозиторію має такий-самий шаблон («тонкий fix.mjs + сусідні check-модулі»). Це уніфікує запуск як з оркестратора (`bun run lint`, агрегатори, `runStandardRule`-цикли), так і з окремих CI-кроків чи дебагу через IDE.

### Контракт повернення (exit-code)

| Значення | Семантика                                                                 |
| -------- | ------------------------------------------------------------------------- |
| `0`      | Правило `release` не знайшло порушень для файлів, до яких воно `applies`. |
| `1`      | Принаймні одне порушення (вже зафіксоване й виведене раннером).           |

Інших кодів файл не вводить — будь-яка деталізація залежить від `runStandardRule` / `runRuleCli`.

## Примітки щодо реалізації

- **Чому `import.meta.dirname`, а не явне ім'я правила:** Це дає змогу шаблону `fix.mjs` бути ідентичним для всіх правил без захардкоджування рядкового імені — раннер сам ідентифікує правило за каталогом.
- **Чому `await` на top-level:** Файл — ESM (`.mjs`), top-level `await` дозволений. У CLI-режимі потрібен синхронно-доступний exit-code до виклику `process.exit`.
- **Чому виключені два ESLint-правила:** Обидва (`n/no-process-exit`, `unicorn/no-process-exit`) у проєкті заборонені для бібліотечного коду, але для standalone-entry-points exit-code — це і є контракт. Інлайн-коментар із поясненням обов'язковий за стилем репозиторію.
- **Що файл свідомо не робить:** не парсить CLI-аргументи самостійно, не читає файли, не звертається до мережі, не імпортує бізнес-логіку правила напряму — все це делеговано в `run-standard-rule.mjs` та `run-rule-cli.mjs`.
