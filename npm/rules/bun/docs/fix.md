# `npm/rules/bun/fix.mjs`

## Огляд

Файл є точкою входу для правила `bun` у системі правил `@nitra/cursor`. Він виконує дві ролі одночасно:

1. **Library mode** — експортує функцію `run(ctx)`, яку CLI-оркестрація викликає через динамічний `import(...)`, щоб виконати правило в межах загального батч-прогону всіх правил.
2. **Standalone mode** — якщо файл запущено напряму через `bun rules/bun/fix.mjs`, він повністю емулює виклик `npx @nitra/cursor fix bun` (з конфіг-завантаженням, whitelist-фільтрацією та фінальним summary) і завершує процес кодом виходу, придатним для CI/IDE.

Власної логіки перевірки/виправлення файл не містить — він делегує роботу стандартному пайплайну правил `runStandardRule`, який послідовно прогонює фази `applies → JS-concerns → policy → mdc-refs` на основі сусідніх файлів правила (`meta.json`, `bun.mdc`, тек `js/`, `policy/`).

Цей патерн ідентичний у всіх однотипних правил `npm/rules/<id>/fix.mjs` — фактично це тонкий «диспатчер», який прив’язує конкретне правило (визначене теками-сусідами через `import.meta.dirname`) до загальної інфраструктури запуску.

## Експорти / API

| Експорт | Тип                                            | Опис                                                                                                                                                  |
| ------- | ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `run`   | `function(ctx?: RuleContext): Promise<number>` | Іменований експорт. Точка входу в library-режимі: викликається оркестратором CLI через ESM `import` після динамічного резолву шляху до файлу правила. |

Default-експорту немає. Окрім `run`, файл має **top-level side-effect**: при виконанні в standalone-режимі (див. нижче) виконує `process.exit(...)` ще до того, як модуль завершить ініціалізацію.

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
  - `ctx` — необов’язковий об’єкт контексту прогону, тип `RuleContext` із модуля `../../scripts/lib/run-standard-rule.mjs`. Передається оркестратором, коли кілька правил виконуються в одному батчі та потребують спільного стану (наприклад, `walkCache` — кеш обходу файлової системи, щоб не повторювати `fs.readdir` для тих самих директорій). Якщо `undefined`, `runStandardRule` створює власний контекст за замовчуванням.
- **Повертає:** `Promise<number>` з кодом виходу:
  - `0` — правило не знайшло порушень (OK);
  - `1` — знайдено порушення (правило завершилося з помилками).
- **Алгоритм:** єдине виконуване твердження — `return runStandardRule(import.meta.dirname, ctx)`. Тут `import.meta.dirname` — абсолютний шлях до теки правила (`npm/rules/bun/`); саме на основі цього шляху `runStandardRule` визначає ідентифікатор правила (остання сегментна назва — `bun`) та підвантажує сусідні артефакти (`meta.json`, `bun.mdc`, скрипти з `js/` та `policy/`).
- **Side effects:**
  - Делеговані до `runStandardRule`: читання конфіг-файлу, обхід дерева проєкту згідно з applies-фільтрами, можливі модифікації цільових файлів у фазі JS-concerns / policy, запис лог-повідомлень у stdout.
  - Сам `run` не звертається до `process.exit`, не змінює `process.env` і не змінює глобальний стан — повертає чистий `Promise`, який повністю керується викликачем.

### Standalone-блок (top-level)

```js
if (isRunAsCli(import.meta.url)) {
  process.exit(await runRuleCli(import.meta.dirname))
}
```

- **Що це:** не функція, а IIFE-подібний top-level guard. Виконується один раз на завантаженні модуля.
- **Умова:** `isRunAsCli(import.meta.url)` повертає `true`, лише коли цей файл стартовано напряму як entry-point (а не імпортовано як модуль із оркестратора). Перевірка зазвичай зводиться до порівняння `import.meta.url` з `pathToFileURL(process.argv[1])`.
- **Дія:** викликає `runRuleCli(import.meta.dirname)`, дочікується резолву та передає результат у `process.exit(...)`. На відміну від `run`, тут запускається повний CLI-pipeline (а не лише стандартне правило): завантаження користувацького конфігу, фільтр whitelist, фінальний summary та форматування виводу.
- **Side effects:**
  - Завершує процес Node/Bun із кодом виходу `0` або `1`.
  - У файлі присутні директиви `eslint-disable-next-line n/no-process-exit, unicorn/no-process-exit` — це свідомий виняток для standalone-точок входу, які повинні повертати exit-code для CI та IDE.
  - Використано top-level `await`, тому модуль працює лише в ESM-середовищі з підтримкою TLA (Bun, Node.js 14.8+ у ESM-режимі).

## Залежності

### Внутрішні (relative imports)

| Модуль                                    | Імпорти                    | Призначення                                                                                                                                                              |
| ----------------------------------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `../../scripts/lib/run-rule-cli.mjs`      | `isRunAsCli`, `runRuleCli` | Утиліти для standalone-режиму: визначити, чи файл запущено як CLI, та виконати повноцінний CLI-pipeline для одного правила.                                              |
| `../../scripts/lib/run-standard-rule.mjs` | `runStandardRule`          | Стандартний рантайм правила: послідовність фаз `applies → JS-concerns → policy → mdc-refs`. Також експортує тип `RuleContext`, на який посилається JSDoc-анотація `run`. |

### Зовнішні (npm-пакети, runtime)

- Зовнішніх npm-залежностей файл не імпортує напряму.
- Опосередковано через `runStandardRule` / `runRuleCli` залучається інфраструктура `@nitra/cursor` (logger, конфіг-парсер, walker файлової системи тощо).

### Платформенні залежності

- ESM (`import`, `import.meta.url`, `import.meta.dirname`).
- Top-level `await` — потрібна Node.js ≥ 14.8 в ESM або Bun.
- `process.exit` — Node/Bun-середовище.

### Сусідні артефакти правила (читаються через `import.meta.dirname`)

Файл сам не імпортує їх явно, але `runStandardRule` / `runRuleCli` підхоплюють з тієї ж теки:

- `meta.json` — метадані правила (id, applies-патерни, опис тощо).
- `bun.mdc` — людинозрозумілий опис правила у форматі MDC.
- `js/` — JS-concerns (check-/fix-скрипти, що працюють із JS/AST).
- `policy/` — policy-фаза (rego/інші policy-чеки).

## Потік виконання / Використання

### Сценарій 1: виклик з оркестратора (library mode)

```js
import { run } from '@nitra/cursor/rules/bun/fix.mjs'

const exitCode = await run({ walkCache })
if (exitCode !== 0) {
  // правило знайшло порушення
}
```

Послідовність:

1. Оркестратор резолвить шлях до `fix.mjs` (наприклад, у циклі по `npm/rules/*/fix.mjs`).
2. Виконує `import(...)` — модуль завантажується, `isRunAsCli(...)` повертає `false`, тому standalone-блок не спрацьовує, `process.exit` не викликається.
3. Оркестратор отримує іменований експорт `run` і викликає його з підготованим `ctx`.
4. `run` делегує до `runStandardRule(import.meta.dirname, ctx)`, який:
   - читає `meta.json` сусідньої теки;
   - проходить фази `applies → JS-concerns → policy → mdc-refs`;
   - повертає `0` або `1`.
5. Оркестратор агрегує коди повернення всіх правил та формує підсумковий exit-code.

### Сценарій 2: прямий запуск файлу (standalone mode)

```bash
bun npm/rules/bun/fix.mjs
# або
node npm/rules/bun/fix.mjs
```

Послідовність:

1. Bun/Node стартує модуль як entry-point.
2. Модуль виконує імпорти `run-rule-cli.mjs` та `run-standard-rule.mjs`.
3. Створюється експорт `run` (просто зв’язується з функцією).
4. Перевірка `isRunAsCli(import.meta.url)` повертає `true`.
5. Виконується `await runRuleCli(import.meta.dirname)` — це **повний** еквівалент `npx @nitra/cursor fix bun`: завантаження конфігу, whitelist-фільтрація, прогон правила, фінальний summary.
6. Результат (число — exit-code) передається у `process.exit(...)`, процес завершується одразу.

### Еквівалентність CLI-команд

| Спосіб запуску              | Внутрішній шлях                                                 | Поведінка                                                |
| --------------------------- | --------------------------------------------------------------- | -------------------------------------------------------- |
| `npx @nitra/cursor fix bun` | CLI знаходить правило `bun`, імпортує `run` → `runStandardRule` | Library mode                                             |
| `bun npm/rules/bun/fix.mjs` | Standalone-блок → `runRuleCli`                                  | Standalone mode (повний CLI-pipeline для одного правила) |

### Чому дві ролі в одному файлі

- **Library mode** потрібен для батч-прогону: оркестратор не повинен форкати процес під кожне правило і не повинен дублювати конфіг-завантаження.
- **Standalone mode** потрібен для зручного дебагу одного правила в IDE/CI: достатньо вказати шлях до файлу як entry-point, не запускаючи всю CLI-обгортку.

Обидві ролі узгоджуються через стандартний `import.meta.dirname` — точку прив’язки до сусідніх артефактів правила.

## Rebuild Test

Якщо файл видалити і відтворити з нуля за цією документацією, мають виконуватись усі наступні твердження:

1. Файл містить рівно два імпорти з відносних шляхів: `../../scripts/lib/run-rule-cli.mjs` (іменовані `isRunAsCli`, `runRuleCli`) та `../../scripts/lib/run-standard-rule.mjs` (іменований `runStandardRule`).
2. Експортується іменована функція `run(ctx)`, яка повертає результат виклику `runStandardRule(import.meta.dirname, ctx)`. `ctx` — необов’язковий параметр.
3. JSDoc над `run` описує: фази правила (`applies → JS-concerns → policy → mdc-refs`), library-режим (`import + run(ctx)`), тип параметра `RuleContext`, повертає `Promise<number>` з кодами `0`/`1`.
4. Після експорту функції є top-level guard `if (isRunAsCli(import.meta.url)) { ... }`.
5. Усередині guard — `process.exit(await runRuleCli(import.meta.dirname))`.
6. Рядок із `process.exit` має eslint-disable-коментар, що вимикає правила `n/no-process-exit` та `unicorn/no-process-exit` з поясненням, що це standalone entry-point для CI/IDE.
7. Стандартний коментар поряд із guard пояснює подвійну роль файлу (`library (run) + standalone (main)`) та еквівалентність до `npx @nitra/cursor fix <id>`.
8. У файлі немає інших експортів, default-експорту, побічних викликів `process.exit` поза guard-блоком та жодних звернень до `process.env`, файлової системи чи мережі — все делеговано в `runStandardRule` / `runRuleCli`.
9. Файл коректно виконується в Bun і Node.js ≥ 14.8 у ESM-режимі завдяки top-level `await`.
10. При імпорті як модуль (`import { run } from '.../fix.mjs'`) `process.exit` не викликається — guard повертає `false`.
