---
docgen:
  source: npm/rules/php/fix.mjs
  crc: 12fc1644
---

# fix.mjs — правило `php`

## Огляд

Файл `npm/rules/php/fix.mjs` — це точка входу правила `php` у системі `@nitra/cursor`. Він виконує дві ролі одночасно:

1. **Library mode** — експортує функцію `run(ctx)`, яку викликає CLI-оркестратор (`cursor.mjs`) під час масового прогону правил. У цьому режимі правило інтегрується у спільний pipeline і використовує загальний `walkCache` та інший контекст оркестратора.
2. **Standalone mode** — коли файл запускається напряму через `bun rules/php/fix.mjs`, він діє як самостійний CLI-скрипт, що є повним еквівалентом команди `npx @nitra/cursor fix php` (з підтягуванням конфігурації, whitelist і фінальним summary).

Логіка правила (applies → JS-concerns → policy → mdc-refs) інкапсульована у спільному оркестраторі `runStandardRule`, тож сам файл `fix.mjs` залишається мінімальним «glue»-шаром і не містить специфічної для PHP логіки безпосередньо — конкретні чекери лежать поряд у директорії правила (`checks/`, `applies.mjs`, `policy.mjs` тощо), а їх виявлення робить `runStandardRule` за конвенцією шляху `import.meta.dirname`.

## Експорти / API

| Експорт | Тип                                            | Призначення                                                                                                                                                              |
| ------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `run`   | `function(ctx?: RuleContext): Promise<number>` | Іменований експорт — основний entry-point library-режиму. Запускає стандартний pipeline правила в каталозі поточного модуля. Повертає exit-code (0 — OK, 1 — порушення). |

Файл **не** має `default`-експорту. Side-effect на верхньому рівні модуля: блок `if (isRunAsCli(...))` із викликом `process.exit(...)` — спрацьовує лише при прямому запуску.

## Функції

### `run(ctx)`

```js
export function run(ctx)
```

- **Параметри:**
  - `ctx` _(опціональний)_ — об'єкт типу `RuleContext`, імпортований з `../../scripts/lib/run-standard-rule.mjs`. Передається оркестратором і містить кеш обходу файлової системи (`walkCache`) та інші розшаровані між правилами дані. Якщо не передано — `runStandardRule` створює власний локальний контекст.
- **Повертає:** `Promise<number>` — exit-code прогону:
  - `0` — правило пройшло без порушень;
  - `1` — виявлено порушення (або правило завершилось помилкою, яку оркестратор мапить на ненульовий код).
- **Side effects:**
  - Делегує всю реальну роботу `runStandardRule`: читання файлів, виконання чекерів, друк summary до `stdout`/`stderr`.
  - Сам `run` не має власних побічних ефектів — це тонкий wrapper.
- **Як визначається корінь правила:** через `import.meta.dirname` — абсолютний шлях до директорії, в якій лежить `fix.mjs`. Це дозволяє `runStandardRule` знайти сусідні файли правила (`applies.mjs`, `policy.mjs`, `checks/*.mjs`, `*.mdc` тощо) без додаткових параметрів.

## Залежності

Файл імпортує дві утиліти з внутрішньої бібліотеки `npm/scripts/lib/`:

| Імпорт            | Звідки                                    | Призначення                                                                                                                                                        |
| ----------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `isRunAsCli`      | `../../scripts/lib/run-rule-cli.mjs`      | Детектор «чи модуль запущений напряму як CLI». Порівнює `import.meta.url` із `process.argv[1]`. Використовується для гілки standalone.                             |
| `runRuleCli`      | `../../scripts/lib/run-rule-cli.mjs`      | Повноцінний CLI-runner правила: парсить аргументи, підтягує config, застосовує whitelist, друкує summary. Повертає `Promise<number>` із exit-кодом.                |
| `runStandardRule` | `../../scripts/lib/run-standard-rule.mjs` | Стандартний pipeline правила: послідовно виконує стадії `applies → JS-concerns → policy → mdc-refs`. Приймає шлях до директорії правила та опційний `RuleContext`. |

Зовнішніх npm-залежностей файл не має — лише внутрішні модулі монорепо.

## Потік виконання / Використання

### Сценарій A — виклик з оркестратора (library mode)

1. CLI `@nitra/cursor fix` (або агрегатор) знаходить правило `php` за його директорією.
2. Динамічно імпортує `fix.mjs` і викликає `await run(ctx)`, передаючи спільний `RuleContext` (зокрема `walkCache`, щоб уникнути повторного обходу ФС між правилами).
3. `run` делегує виклик `runStandardRule(import.meta.dirname, ctx)`.
4. `runStandardRule` повертає exit-code; оркестратор агрегує коди всіх правил.

```js
import { run } from '@nitra/cursor/rules/php/fix.mjs'

const code = await run(sharedCtx)
```

### Сценарій B — прямий запуск файлу (standalone mode)

1. Користувач (або IDE/CI) виконує:
   ```bash
   bun npm/rules/php/fix.mjs
   ```
2. Top-level `if (isRunAsCli(import.meta.url))` повертає `true` (бо `import.meta.url` збігається з шляхом запущеного скрипта).
3. Викликається `await runRuleCli(import.meta.dirname)` — повноцінний CLI-режим: підвантажує конфігурацію, застосовує whitelist, друкує підсумок.
4. `process.exit(...)` завершує процес із отриманим exit-кодом, аби CI/IDE могли коректно інтерпретувати результат.

### Семантика exit-кодів

- `0` — правило застосовне та порушень не виявлено (або правило незастосовне для цього проєкту — `applies` повернув `false`).
- `1` — є порушення, які треба виправити.

### Коментарі та лінт-винятки

У standalone-гілці явно вимкнено два правила лінтера:

```js
// eslint-disable-next-line n/no-process-exit -- standalone entry-point має повертати exit-code для CI/IDE
process.exit(await runRuleCli(import.meta.dirname))
```

Це свідомий виняток: `process.exit` тут потрібний, щоб CLI/CI отримали ненульовий код у разі порушень — без нього процес міг би завершитись із кодом `0` навіть за наявності знайдених проблем.

## Архітектурний контекст

- **Конвенція файлу `fix.mjs`** — у директорії кожного правила (`npm/rules/<id>/fix.mjs`) лежить однотипний тонкий wrapper із двома ролями (library + standalone). Це гарантує:
  - єдиний інтерфейс для оркестратора (`run(ctx)`);
  - можливість запускати окреме правило ізольовано (для дебагу/CI per-rule).
- **Чому через `import.meta.dirname`** — `runStandardRule` за директорією правила автоматично знаходить усі сусідні артефакти (`applies.mjs`, `policy.mjs`, `checks/*.mjs`, `*.mdc`). Це уникає дублювання id-правила як рядка.
- **Patch-free wrapper** — у самому `fix.mjs` не повинно з'являтися PHP-специфічної логіки; будь-які зміни поведінки правила робляться у сусідніх файлах правила, а не в цьому entry-point'і.

## Rebuild Test

Файл можна повністю відтворити з опису вище за такими інваріантами:

1. Два імпорти: `{ isRunAsCli, runRuleCli }` з `../../scripts/lib/run-rule-cli.mjs` і `{ runStandardRule }` з `../../scripts/lib/run-standard-rule.mjs`.
2. Іменований експорт `function run(ctx)` — однорядкове тіло `return runStandardRule(import.meta.dirname, ctx)`.
3. JSDoc над `run`: опис стадій (applies → JS-concerns → policy → mdc-refs), згадка library mode, тип параметра `ctx` через `import('...').RuleContext`, тип повернення `Promise<number>` із семантикою 0/1.
4. Блок `if (isRunAsCli(import.meta.url)) { ... }` із викликом `process.exit(await runRuleCli(import.meta.dirname))` і коментарем-поясненням про дві ролі fix.mjs.
5. Лінт-disable перед `process.exit`: `n/no-process-exit, unicorn/no-process-exit` із обґрунтуванням «standalone entry-point має повертати exit-code для CI/IDE».
6. Жодних інших top-level операцій, жодного `default`-експорту.
