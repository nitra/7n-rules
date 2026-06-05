# fix.mjs — entry-point правила `vue`

## Огляд

Файл `npm/rules/vue/fix.mjs` — це **точка входу** (entry-point) для правила `vue` у системі `@nitra/cursor`. Файл одночасно виконує дві ролі:

1. **Library mode** — експортує функцію `run(ctx)`, яку викликає зовнішній оркестратор (CLI `@nitra/cursor`, інші правила, тести) з підготовленим контекстом прогону.
2. **Standalone mode** — якщо файл запущено напряму (наприклад, `bun npm/rules/vue/fix.mjs`), він самостійно піднімає повноцінний CLI-цикл, еквівалентний `npx @nitra/cursor fix vue`.

Сам файл не містить специфічної для Vue логіки правил. Уся логіка делегується у спільні бібліотеки `runStandardRule` (виконання стандартних фаз правила) і `runRuleCli` (підготовка CLI-середовища). Завдяки цьому `fix.mjs` у директорії правила `vue` залишається тонким shim-файлом, який лише підставляє свою директорію як ідентифікатор правила.

Стандартний пайплайн, який під цим запускається (через `runStandardRule`), складається з фаз:

- `applies` — детекція файлів/області застосування правила,
- `JS-concerns` — перевірки JS/JSX/TS-аспектів коду,
- `policy` — застосування policy-чеків (warn/error),
- `mdc-refs` — узгодженість MDC-документації та посилань.

## Експорти / API

| Назва | Тип        | Опис                                                                                            |
| ----- | ---------- | ----------------------------------------------------------------------------------------------- |
| `run` | `function` | Named export. Library-точка входу правила. Приймає опційний `ctx` і повертає `Promise<number>`. |

**Side-effect експорт:** при виконанні модуля під CLI (умова `isRunAsCli(import.meta.url)`) модуль вмикає standalone-режим і завершує процес викликом `process.exit(...)` з exit-кодом, отриманим від `runRuleCli`. Цей побічний ефект виконується на верхньому рівні модуля (top-level `await`), тому імпорт файлу як ESM-модуля з іншого файлу **не** активує standalone-гілку — її активує лише пряме виконання інтерпретатором.

## Функції

### `run(ctx)`

Library-функція правила. Делегує виконання у спільну реалізацію `runStandardRule`, передаючи їй власну директорію модуля (`import.meta.dirname`) як ідентифікатор правила та переданий контекст.

- **Сигнатура:** `function run(ctx): Promise<number>`
- **Параметри:**
  - `ctx` _(optional)_ — об'єкт типу `RuleContext` із модуля `../../scripts/lib/run-standard-rule.mjs`. У ньому, серед іншого, передається `walkCache` для уникнення повторного обходу файлової системи між послідовно запущеними правилами. Якщо `ctx` не передано, `runStandardRule` створює його самостійно.
- **Повертає:** `Promise<number>` — exit-код прогону правила:
  - `0` — порушень немає (OK);
  - `1` — знайдено порушення (rule violations).
- **Side effects:** усі побічні ефекти ховаються всередині `runStandardRule` (читання файлів проєкту, можливі автоматичні фікси, виведення summary в stdout/stderr). Сам `run` додаткових side-effects не має, поза тим, що значення повернення завжди є `Promise`, навіть якщо `runStandardRule` поверне синхронно — це гарантує контракт async-pipeline для оркестратора.
- **Помилки:** функція не обгортає виняткові ситуації — будь-яка помилка з `runStandardRule` пробрасується нагору (rejection промісу) і має оброблятись на рівні CLI/орхестратора.

### Top-level standalone-блок

Не функція, а top-level гілка модуля:

```js
if (isRunAsCli(import.meta.url)) {
  process.exit(await runRuleCli(import.meta.dirname))
}
```

- **Семантика:** `isRunAsCli(import.meta.url)` повертає `true`, коли поточний модуль є entry-point процесу (тобто Node/Bun запустив саме цей файл, а не імпортував його). У такому разі викликається `runRuleCli` з директорією поточного правила; її exit-код передається у `process.exit(...)`, щоб CI/IDE отримали коректний статус.
- **Side effects:**
  - синхронне завершення процесу через `process.exit`;
  - усе, що робить `runRuleCli` (завантаження конфігу, whitelist, summary).
- **ESLint-винятки:** standalone-entry-point має право робити `process.exit`, тому над цим викликом стоять директиви `// eslint-disable-next-line n/no-process-exit, unicorn/no-process-exit`. Це штатна практика для двороле́вих fix.mjs.

## Залежності

Імпорти модуля:

- `isRunAsCli` — з `../../scripts/lib/run-rule-cli.mjs`. Утиліта-детектор: чи поточний модуль є entry-point (CLI mode), чи його імпортнули як бібліотеку.
- `runRuleCli` — з `../../scripts/lib/run-rule-cli.mjs`. Виконує повну CLI-оркестрацію для одного правила: завантажує конфіг, формує whitelist, друкує summary та повертає exit-код. Використовується тільки у standalone-гілці.
- `runStandardRule` — з `../../scripts/lib/run-standard-rule.mjs`. Виконує стандартний пайплайн правила: `applies → JS-concerns → policy → mdc-refs`. JSDoc-типи `RuleContext` теж приходять із цього модуля (через `@param`-import).

Неявні залежності:

- Структура директорії правила (`npm/rules/vue/`) має містити очікувані `runStandardRule` під-директорії/файли: `js/`, `lib/`, `policy/`, `meta.json`, `vue.mdc` тощо. Сам `fix.mjs` не звертається до них напряму — він лише підставляє свій `import.meta.dirname`, а решту виявляє shared-runner.
- ESM-середовище (Node.js ≥ 20 / Bun) з підтримкою `import.meta.url` та `import.meta.dirname`.

## Потік виконання / Використання

### Library mode (виклик з оркестратора)

```js
import { run } from './npm/rules/vue/fix.mjs'

const exitCode = await run(ctx) // ctx — спільний RuleContext із walkCache
if (exitCode !== 0) {
  // у правилі vue знайдено порушення → обробляємо
}
```

Послідовність:

1. Оркестратор імпортує `fix.mjs`. Гілка `if (isRunAsCli(...))` не виконується, бо `import.meta.url` не є entry-point.
2. Оркестратор викликає `run(ctx)`.
3. `run` передає `import.meta.dirname` (= `…/npm/rules/vue`) і `ctx` у `runStandardRule`.
4. `runStandardRule` виконує фази `applies → JS-concerns → policy → mdc-refs` для правила `vue`, використовуючи кеші з `ctx` (наприклад, `walkCache`).
5. Повертається exit-код (`0` або `1`), який оркестратор інтегрує у свій агрегований підсумок.

### Standalone mode (пряме виконання)

```bash
bun npm/rules/vue/fix.mjs
# або
node npm/rules/vue/fix.mjs
```

Послідовність:

1. Інтерпретатор завантажує модуль; виконуються імпорти.
2. Виконується top-level код: `isRunAsCli(import.meta.url)` повертає `true`.
3. Викликається `await runRuleCli(import.meta.dirname)` — це повний еквівалент `npx @nitra/cursor fix vue`:
   - читає конфіг,
   - застосовує whitelist,
   - усередині піднімає той самий `runStandardRule`-цикл (або сумісний з ним),
   - друкує summary.
4. Отриманий exit-код передається у `process.exit(...)`, процес завершується з відповідним кодом для CI/IDE.

### Чому існують дві ролі

Подвійна реалізація (`run` + standalone) дозволяє:

- викликати правило **разом з іншими** з єдиного оркестратора без зайвого spawn-у процесів і без втрати спільних кешів (бібліотечний шлях);
- запускати правило **окремо** з командного рядка під час локальної розробки/дебагу, маючи повноцінний CLI-вивід (standalone-шлях).

## Rebuild Test

Можна повністю відтворити поведінку цього файлу з опису вище:

- Імпортуються тільки два символи з двох сусідніх бібліотек: `isRunAsCli`, `runRuleCli` з `../../scripts/lib/run-rule-cli.mjs` та `runStandardRule` з `../../scripts/lib/run-standard-rule.mjs`.
- Експортується одна named-функція `run(ctx)`, яка повертає результат `runStandardRule(import.meta.dirname, ctx)` — отже, є async (повертає `Promise<number>`).
- На рівні модуля стоїть умова `if (isRunAsCli(import.meta.url)) { process.exit(await runRuleCli(import.meta.dirname)) }` з відповідними ESLint-disable-коментарями для `n/no-process-exit` та `unicorn/no-process-exit`.
- Жодних додаткових іменованих експортів, default-експортів, констант чи побічних викликів у файлі немає.

Цього достатньо, щоб переписати файл байт-у-байт еквівалентно (з точністю до коментарів/форматування), не звертаючись до оригіналу.
