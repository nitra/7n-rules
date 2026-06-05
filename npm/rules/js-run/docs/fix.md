# fix.mjs — точка входу правила `js-run`

## Огляд

Файл `npm/rules/js-run/fix.mjs` — це **диспетчер правила** `js-run` у пакеті `@nitra/cursor`. Він виконує дві ролі одночасно:

1. **Library-режим** — експортує функцію `run(ctx)`, яку викликає зовнішній CLI-оркестратор (`npx @nitra/cursor fix <id>`) під час пакетного прогону всіх правил. У цьому режимі модуль не торкається `process.exit` і повертає `Promise<number>` із кодом виходу.
2. **Standalone-режим** — якщо файл запущено напряму (`bun rules/js-run/fix.mjs`), він поводиться як повноцінний entry-point: завантажує конфіг, застосовує whitelist, друкує підсумок і завершує процес із відповідним exit-code.

Усю фактичну логіку (визначення `applies`, JS-concerns, policy-перевірки, mdc-references) інкапсулює спільна функція `runStandardRule`. `fix.mjs` лише прокидає `import.meta.dirname` (директорія правила) до неї або до CLI-обгортки `runRuleCli`. Файл не містить власних доменних перевірок — він суто структурний і дотримується конвенції «двох ролей `fix.mjs`», прийнятої в `@nitra/cursor` для всіх стандартних правил.

Назву правила (`js-run`) система визначає не з вмісту цього файлу, а з імені директорії, в якій він лежить (`npm/rules/js-run/`). Це дозволяє створювати ідентичні `fix.mjs` для багатьох правил, не дублюючи логіку.

## Експорти / API

| Експорт | Тип                                            | Призначення                                                                          |
| ------- | ---------------------------------------------- | ------------------------------------------------------------------------------------ |
| `run`   | `function(ctx?: RuleContext): Promise<number>` | Library entry-point правила — викликається зовнішнім оркестратором у тому ж процесі. |

Додатково в модулі присутній **side-effect блок** на рівні модуля: якщо `isRunAsCli(import.meta.url)` повертає `true`, модуль виконує `await runRuleCli(...)` і завершує процес через `process.exit(...)`. Цей блок не є експортом, але є частиною публічної поведінки файлу.

Файл не має default-експорту і не реекспортує нічого зі своїх залежностей.

## Функції

### `run(ctx)`

```js
export function run(ctx) {
  return runStandardRule(import.meta.dirname, ctx)
}
```

- **Сигнатура:** `run(ctx?: RuleContext): Promise<number>`
- **Параметри:**
  - `ctx` _(необовʼязковий)_ — обʼєкт контексту прогону. Тип імпортується з `../../scripts/lib/run-standard-rule.mjs` як `RuleContext`. Зазвичай містить розділяємий між правилами кеш обходу файлової системи (`walkCache`) та інші cross-rule артефакти, які дозволяють зекономити IO при батч-прогоні. Якщо аргумент не передано, `runStandardRule` створює локальний контекст самостійно.
- **Повертає:** `Promise<number>` — exit-code прогону:
  - `0` — порушень не знайдено (OK);
  - `1` — знайдено хоча б одне порушення.
- **Side effects:** делегуються в `runStandardRule`. Можливі: читання файлів проєкту, читання `meta.json` правила, друк діагностики у stdout/stderr, запис у спільні структури `ctx`. Сам `run` `process.exit` не викликає — це принципово для library-режиму, де декілька правил мають викликатись підряд в одному процесі.
- **Алгоритм:** одна делегація — `runStandardRule(import.meta.dirname, ctx)`. `import.meta.dirname` — абсолютний шлях до директорії, в якій лежить `fix.mjs` (тобто `.../npm/rules/js-run/`). За цим шляхом `runStandardRule` знаходить `meta.json`, підправила в `js/`, `policy/`, а також `.mdc`-документ правила.

### Top-level CLI-блок

```js
if (isRunAsCli(import.meta.url)) {
  process.exit(await runRuleCli(import.meta.dirname))
}
```

- **Умова активації:** `isRunAsCli(import.meta.url)` — повертає `true`, якщо файл запущено напряму як скрипт (`node`/`bun fix.mjs`), а не імпортовано як модуль. Конкретний механізм перевірки інкапсульований у `run-rule-cli.mjs`.
- **Що робить:** очікує (`await`) завершення `runRuleCli(import.meta.dirname)`, який окрім логіки `runStandardRule` додатково:
  - завантажує конфіг проєкту (whitelist, exclusions);
  - вирівнює аргументи CLI;
  - друкує summary в кінці прогону;
  - повертає exit-code.
- **Завершення:** `process.exit(<code>)` — обовʼязкове для standalone-режиму, бо CI/IDE очікують саме exit-code, а не повернене значення з `import()`.
- **ESLint suppression:** коментар `// eslint-disable-next-line n/no-process-exit, unicorn/no-process-exit` свідомо вимикає правила, які забороняють `process.exit` у бібліотечному коді. Виключення виправдане роллю файлу як standalone-entry-point — це не лібра у вузькому сенсі.

## Залежності

Файл має рівно **дві** внутрішні залежності, обидві з `npm/scripts/lib/`:

| Імпорт            | Звідки                                    | Що звідти використовується                                                                                                    |
| ----------------- | ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `isRunAsCli`      | `../../scripts/lib/run-rule-cli.mjs`      | Предикат: чи модуль запущено як CLI, а не імпортовано як бібліотека. Приймає `import.meta.url`.                               |
| `runRuleCli`      | `../../scripts/lib/run-rule-cli.mjs`      | Повна CLI-обгортка над `runStandardRule`: конфіг + whitelist + summary + повернення exit-code. Приймає `import.meta.dirname`. |
| `runStandardRule` | `../../scripts/lib/run-standard-rule.mjs` | Універсальний раннер «стандартного» правила: applies → JS-concerns → policy → mdc-refs. Приймає `(dirname, ctx?)`.            |

Зовнішніх npm-залежностей файл не має. Опосередковано він залежить від:

- структури директорії правила (`meta.json`, підтеки `js/`, `policy/`, `.mdc`-файл);
- існування файлу `js-run.mdc` поруч (документ правила, на який спирається mdc-refs);
- API-контракту `RuleContext`, який тримається в `run-standard-rule.mjs`.

## Потік виконання / Використання

### Library-режим (батч-прогон правил)

```js
// Десь у CLI-оркестраторі @nitra/cursor
import { run as runJsRun } from '@nitra/cursor/rules/js-run/fix.mjs'

const ctx = createSharedContext() // walkCache, тощо
const code = await runJsRun(ctx) // 0 або 1
if (code !== 0) failures.push('js-run')
```

Послідовність:

1. Оркестратор створює спільний `ctx` (один на всі правила в прогоні).
2. Імпортує `run` з `fix.mjs` потрібного правила.
3. Викликає `run(ctx)` і чекає `Promise<number>`.
4. `run` делегує в `runStandardRule(dirname, ctx)`, яка читає `meta.json`, виконує applies → JS-concerns → policy → mdc-refs.
5. Результат — exit-code — повертається оркестратору, який агрегує всі коди й вирішує, з чим завершити сам процес.

### Standalone-режим (локальний дебаг або CI per-rule)

```bash
bun npm/rules/js-run/fix.mjs
# або
node npm/rules/js-run/fix.mjs
```

Послідовність:

1. Інтерпретатор завантажує модуль.
2. Виконується top-level код: `isRunAsCli(import.meta.url)` повертає `true` (бо файл — entrypoint).
3. Викликається `await runRuleCli(import.meta.dirname)`:
   - читає конфіг проєкту і whitelist;
   - усередині запускає еквівалент `runStandardRule(dirname, ctx)`;
   - друкує summary у stdout.
4. Повернений exit-code передається в `process.exit(...)`, який завершує процес з ним же.
5. CI/IDE/Husky отримують exit-code і вирішують, чи фейлити крок.

### Розширення / модифікація

- Щоб **додати специфічну логіку** для `js-run` за межами «стандартної» воронки — не правити цей файл, а додати чек у `js/` або `policy/` директорію правила. `runStandardRule` сам їх підхопить.
- Щоб **використати власний контекст** — передавати `ctx` із полем `walkCache: Map<string, FsEntry[]>` для шарингу обходу між правилами.
- Щоб **тимчасово виключити правило з batch** — оркестратор просто не імпортує `run` цього файлу. Сам файл такої логіки не містить.

### Інваріанти, які слід зберігати при змінах

1. Library-функція `run` **ніколи не викликає** `process.exit` — інакше зламається батч-прогон.
2. CLI-блок виконується **тільки** під охороною `isRunAsCli(import.meta.url)` — інакше імпорт зробить exit у чужому процесі.
3. У `runStandardRule` і `runRuleCli` передається `import.meta.dirname`, а не `import.meta.url` — це шлях, а не URL. Підміна типу зламає резолвінг `meta.json` і підправил.
4. Назва правила береться з імені директорії — не дублюй її рядком у цьому файлі.

## Rebuild Test

Виходячи з цього документа можна відновити еквівалентний файл `fix.mjs`:

1. Імпортувати `isRunAsCli` і `runRuleCli` з `../../scripts/lib/run-rule-cli.mjs`.
2. Імпортувати `runStandardRule` з `../../scripts/lib/run-standard-rule.mjs`.
3. Експортувати функцію `run(ctx)`, яка повертає `runStandardRule(import.meta.dirname, ctx)`.
4. Додати top-level `if (isRunAsCli(import.meta.url)) { process.exit(await runRuleCli(import.meta.dirname)) }` з ESLint-suppression-коментарем для `n/no-process-exit` і `unicorn/no-process-exit`.
5. JSDoc для `run`: параметр `ctx?: RuleContext` (тип із `run-standard-rule.mjs`), повертає `Promise<number>` (0 — OK, 1 — порушення).

Поведінкові ознаки для перевірки відновленого файлу:

- `import { run } from './fix.mjs'` працює без побічних ефектів (CLI-блок не активується).
- `bun fix.mjs` запускає повний CLI-прогон і завершує процес із кодом `0` або `1`.
- `run(ctx)` повертає `Promise`, який резолвиться у число.
- Файл не містить більше ніяких експортів і ніяких власних доменних перевірок.
