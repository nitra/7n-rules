# fix.mjs — точка входу правила `js-lint-ci`

## Огляд

Файл `npm/rules/js-lint-ci/fix.mjs` є **точкою входу** (entry-point) для правила з ідентифікатором `js-lint-ci` у системі `@nitra/cursor`. Він реалізує **подвійну роль**, типову для всіх стандартних правил каталогу `npm/rules/*`:

1. **Library mode** — експортує функцію `run(ctx)`, яку викликає зовнішній CLI-оркестратор (`npx @nitra/cursor fix js-lint-ci` або агрегатор `npx @nitra/cursor fix` для усіх правил).
2. **Standalone mode** — якщо файл запущено напряму через `bun rules/js-lint-ci/fix.mjs`, виконується повний еквівалент CLI-команди `npx @nitra/cursor fix js-lint-ci` (з завантаженням конфігу, whitelist, summary та exit-кодом для CI).

Сам файл не містить жодної доменно-специфічної логіки правила — вся механіка делегована у спільну бібліотечну функцію `runStandardRule`, яка реалізує стандартний конвеєр стандартного правила:

```
applies → JS-concerns → policy → mdc-refs
```

Тобто: спершу перевіряється, чи правило застосовне до файлу (`applies`), потім виконуються специфічні для JS перевірки (`JS-concerns`), далі — політика (`policy`) та робота з посиланнями `.mdc` (`mdc-refs`).

## Експорти / API

| Експорт | Тип                                  | Призначення                                                                                                                      |
| ------- | ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| `run`   | `function (ctx?) => Promise<number>` | Library-точка входу правила. Запускає стандартний конвеєр правила у каталозі правила, повертає exit-код (0 — OK, 1 — порушення). |

Інших іменованих чи default-експортів файл не містить.

### Сигнатура `run`

```js
export function run(ctx)
```

#### Параметри

- `ctx` (необов’язковий) — об’єкт контексту прогону типу `RuleContext` (визначення в модулі `../../scripts/lib/run-standard-rule.mjs`). Через цей контекст передаються спільні для одного запуску артефакти, такі як кеш обходу файлової системи (`walkCache`) тощо. Якщо контекст відсутній, `runStandardRule` створює власний.

#### Повертає

- `Promise<number>` — асинхронно резолвиться у **exit-код**:
  - `0` — порушень немає, правило пройшло успішно;
  - `1` — виявлено порушення (правило завершилось зі статусом FAIL).

#### Side effects

Сам по собі `run` не має прямих побічних ефектів, але через делегування у `runStandardRule` ініціює:

- читання конфігураційних файлів правила (зокрема `meta.json`, файлів `applies/*`, `policy/*`, `mdc-refs/*` тощо — згідно конвенції стандартного правила);
- обхід файлів проєкту відповідно до `applies`-патернів;
- виконання JS-перевірок (наприклад, запуск ESLint у відповідному режимі) та політики;
- запис до stdout/stderr діагностики, summary та результатів;
- може кешувати/читати з `walkCache` всередині `ctx`.

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

- **Сигнатура:** `run(ctx?: RuleContext): Promise<number>`.
- **Параметри:**
  - `ctx` — опційний контекст прогону (див. вище).
- **Повертає:** `Promise<number>` — exit-код прогону правила (0/1).
- **Реалізація:** єдиний виклик `runStandardRule(import.meta.dirname, ctx)`. Перший аргумент `import.meta.dirname` — абсолютний шлях до каталогу, у якому розташований цей файл (`.../npm/rules/js-lint-ci/`). Таким чином `runStandardRule` дізнається, **яке саме правило** виконувати: всі його артефакти (`meta.json`, `applies`, `policy`, `mdc-refs` тощо) лежать поряд з `fix.mjs`.
- **Side effects:** делеговані у `runStandardRule` (див. секцію _Експорти / API_ вище).

### Standalone-блок (top-level `if`)

```js
if (isRunAsCli(import.meta.url)) {
  process.exit(await runRuleCli(import.meta.dirname))
}
```

- Це не функція, а **умовний top-level statement**, що виконується лише коли модуль завантажено як головний (а не як імпортований модуль).
- **Умова:** `isRunAsCli(import.meta.url)` — повертає `true`, якщо поточний модуль є точкою входу процесу (тобто запущено `bun rules/js-lint-ci/fix.mjs`, а не `import` з іншого файлу).
- **Дія:** виконує `await runRuleCli(import.meta.dirname)` — повний CLI-сценарій (config-loading, whitelist, summary), а потім завершує процес `process.exit(<exit-code>)` з тим самим кодом, що повернув `runRuleCli` (0 або 1) — це критично для CI/IDE, які орієнтуються на код виходу.
- **Side effects:** завершення процесу (`process.exit`), вся I/O `runRuleCli`. Виклики `process.exit` тут спеціально дозволені директивою:
  ```js
   
  ```

## Залежності

### Внутрішні (модулі того ж пакета)

- `../../scripts/lib/run-rule-cli.mjs` — імпортуються:
  - `isRunAsCli(metaUrl)` — детектор того, що поточний ESM-модуль запущено як CLI-entry;
  - `runRuleCli(dirname)` — full standalone CLI-runner правила, що дзеркалить поведінку `npx @nitra/cursor fix <id>` (config-loading + whitelist + summary).
- `../../scripts/lib/run-standard-rule.mjs` — імпортується:
  - `runStandardRule(dirname, ctx?)` — стандартний бібліотечний конвеєр правила (`applies → JS-concerns → policy → mdc-refs`).

### Зовнішні (поза репозиторієм)

- Стандартні Node/Bun-глобали: `process` (для `process.exit`), `import.meta.dirname`, `import.meta.url`.
- Прямих залежностей від npm-пакетів у самому файлі немає (вони — транзитивні через `run-rule-cli.mjs` / `run-standard-rule.mjs`).

### Типи (через JSDoc)

- `import('../../scripts/lib/run-standard-rule.mjs').RuleContext` — імпорт типу для параметра `ctx`.

## Потік виконання / Використання

### Сценарій 1. Library mode (виклик з оркестратора)

Виконується, коли інший модуль імпортує цей файл та викликає `run(ctx)`:

```js
import { run } from '@nitra/cursor/rules/js-lint-ci/fix.mjs'

const exitCode = await run(ctx)
if (exitCode !== 0) {
  // правило виявило порушення
}
```

Послідовність:

1. Оркестратор передає (опційно) спільний `ctx` (наприклад, з `walkCache`).
2. `run` викликає `runStandardRule(import.meta.dirname, ctx)`.
3. `runStandardRule` зчитує конфіг правила з каталогу `npm/rules/js-lint-ci/` і послідовно проганяє ланцюжок:
   - `applies` — визначає список файлів, до яких застосовне правило;
   - `JS-concerns` — JS-специфічні перевірки;
   - `policy` — політика правила;
   - `mdc-refs` — звірення з посиланнями `.mdc`.
4. Повертається `Promise<number>` з exit-кодом.

У цьому сценарії `process.exit` **не** викликається — exit-код повертається у викликача, який сам вирішує, що з ним робити (наприклад, агрегує з кодами інших правил).

### Сценарій 2. Standalone mode (прямий запуск)

Виконується командою:

```sh
bun npm/rules/js-lint-ci/fix.mjs
```

Послідовність:

1. ESM-модуль завантажується як головний, `import.meta.url` дорівнює URL процесу.
2. Виконується top-level `if (isRunAsCli(import.meta.url))` — умова істинна.
3. Запускається `await runRuleCli(import.meta.dirname)` — повний CLI-сценарій (config, whitelist, summary), еквівалентний `npx @nitra/cursor fix js-lint-ci`.
4. `process.exit(<code>)` завершує процес з отриманим exit-кодом (0/1) — для коректної інтеграції з CI та IDE.

> Експортована функція `run` у цьому сценарії **не** викликається напряму — `runRuleCli` сам інкапсулює всю CLI-логіку, включно з потрібними викликами `runStandardRule` всередині.

### Чому існують обидві ролі

- **Library `run`** потрібна, щоб агрегатор (`npx @nitra/cursor fix` без id або фоновий runner) міг прогнати багато правил у спільному контексті — з кешуванням обходу ФС, єдиним підсумком тощо, без породження окремого процесу на кожне правило.
- **Standalone-блок** потрібен, щоб правило було самодостатнім: розробник може запустити його в IDE «як файл» і отримати повноцінний CLI-сценарій з коректним exit-кодом. Це особливо зручно для дебагу окремого правила без переходу через головний CLI пакета.

Файл свідомо тримається **мінімальним**: він є лише адаптером (entry-point), уся доменна логіка — у бібліотечних функціях `runStandardRule` та `runRuleCli`. Це уніфікує всі правила з каталогу `npm/rules/*` — їхні `fix.mjs` мають однакову структуру і відрізняються лише шляхом каталогу, у якому лежать (через `import.meta.dirname`).
