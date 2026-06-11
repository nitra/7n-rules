---
docgen:
  source: npm/rules/python/fix.mjs
  crc: 12fc1644
---

# fix.mjs — entry-point правила `python`

## Огляд

Файл `npm/rules/python/fix.mjs` — це **точка входу** для правила з ідентифікатором `python` пакету `@nitra/cursor`. Він виконує дві ролі одночасно:

1. **Library mode** — експортує функцію `run(ctx)`, яку CLI-оркестратор `npx @nitra/cursor fix` або інші правила можуть викликати програмно через `import { run } from './fix.mjs'`.
2. **Standalone mode** — коли файл запускається безпосередньо (`bun npm/rules/python/fix.mjs`), він самостійно ініціалізує CLI-шар (завантаження конфіга, whitelist цілей, summary-звіт) і завершує процес із коректним exit-code для CI/IDE.

Сам файл нічого не перевіряє і не править — він лише делегує всю роботу стандартному раннеру `runStandardRule`, який за угодою обходить підпапки правила (`applies`, `js`, `policy`, `mdc-refs` тощо) у фіксованому порядку. Конкретні перевірки правила `python` живуть у сусідніх теках (`./js/`, `./lint/`, `./policy/`) і у файлі-описі `./python.mdc`.

Файл є мінімальним shim-ом і свідомо тримається коротким — уся логіка винесена в спільні бібліотеки `scripts/lib/`, щоб усі правила пакету мали однаковий контракт запуску.

## Експорти / API

| Експорт | Тип                      | Призначення                                                                                                                       |
| ------- | ------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| `run`   | named export, `function` | Library API правила `python`. Викликається CLI-оркестратором або іншим кодом для прогону правила в межах вже існуючого контексту. |

Default-експорту немає. Експорт `run` має сталу сигнатуру через JSDoc-тип `RuleContext`, імпортований із `../../scripts/lib/run-standard-rule.mjs`.

Окрім експорту, файл містить **side-effect блок** для standalone-режиму — він не експортується, але виконується при безпосередньому запуску модуля.

## Функції

### `run(ctx)`

Public-функція правила, делегатор до `runStandardRule`.

**Сигнатура**

```js
/**
 *
 */
export function run(ctx) {
  return runStandardRule(import.meta.dirname, ctx)
}
```

**Параметри**

- `ctx` _(optional)_ — об'єкт типу `RuleContext` (визначений у `../../scripts/lib/run-standard-rule.mjs`). Несе спільний для одного прогону стан: зокрема `walkCache` (закешований обхід дерева файлів, щоб не пере-сканувати робочу копію між правилами) та інші поля, які додає оркестратор. Якщо параметр опущений — `runStandardRule` створить дефолтний контекст самостійно.

**Повертає**

- `Promise<number>` — exit-code прогону:
  - `0` — порушень не знайдено (правило пройшло),
  - `1` — знайдено хоча б одне порушення.

Хоча тіло функції `return runStandardRule(...)` синхронне, сам `runStandardRule` повертає `Promise`, тому викликач має `await`-ити результат.

**Side effects**

Безпосередньо у `run` побічних ефектів немає — усі вони виконуються всередині `runStandardRule`:

- читання файлів проекту (через `walkCache`/файлову систему),
- запуск підправил (applies/JS-concerns/policy/mdc-refs),
- запис у `stdout`/`stderr` діагностики (summary вмикається лише в standalone-режимі через `runRuleCli`).

Сам `run` **не викликає** `process.exit` — це обов'язок зовнішнього оркестратора. Це принципово, бо `run` має бути безпечним для виклику з іншого правила або тесту.

### Standalone-блок (anonymous side-effect)

```js
if (isRunAsCli(import.meta.url)) {
  // eslint-disable-next-line n/no-process-exit
  process.exit(await runRuleCli(import.meta.dirname))
}
```

Не функція, а top-level async-блок (використовує `await` на рівні модуля, що валідно для ES-модулів).

**Як працює**

1. `isRunAsCli(import.meta.url)` — повертає `true`, тільки якщо модуль є entry-point процесу (`bun rules/python/fix.mjs`, а не імпорт). При імпорті з іншого модуля гілка не виконується.
2. `runRuleCli(import.meta.dirname)` — повний CLI-цикл одного правила: завантажує конфіг проекту, формує whitelist цілей, прогоняє `run` (через `runStandardRule`), друкує summary.
3. `process.exit(<exit-code>)` — терміново завершує процес кодом, який повернув `runRuleCli`. Дві ESLint-директиви (`n/no-process-exit`, `unicorn/no-process-exit`) явно дозволяють виклик `process.exit` саме тут, бо standalone entry-point повинен повернути код процесу для CI/IDE-інтеграції.

**Side effects**

- Завершує Node/Bun-процес (`process.exit`).
- Усе, що робить `runRuleCli` (читання конфіга, файлові обходи, лог summary).

## Залежності

Усі залежності — внутрішні модулі того ж пакету (`@nitra/cursor`):

| Модуль                                    | Імпортовані символи        | Роль                                                                                                                                                                                      |
| ----------------------------------------- | -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `../../scripts/lib/run-rule-cli.mjs`      | `isRunAsCli`, `runRuleCli` | Детектор standalone-запуску й повний CLI-цикл одного правила (config + whitelist + summary).                                                                                              |
| `../../scripts/lib/run-standard-rule.mjs` | `runStandardRule`          | Стандартний раннер правила: обходить підпапки `applies → js → policy → mdc-refs` у фіксованому порядку й агрегує exit-code. Також експортує тип `RuleContext` (використовується в JSDoc). |

Зовнішніх npm-залежностей у файлі немає. Файл покладається лише на ES-модульні runtime-API:

- `import.meta.dirname` — абсолютний шлях до теки модуля (`.../npm/rules/python/`). Передається як «корінь правила» в обидва раннери, щоб вони знали, де шукати підпапки.
- `import.meta.url` — URL модуля (`file://...`), потрібен `isRunAsCli`, щоб порівняти з `process.argv[1]`.
- `process.exit` — глобальний Node/Bun API.
- Top-level `await` — стандарт ESM.

## Потік виконання / Використання

### Сценарій 1. Виклик з оркестратора (library mode)

Коли користувач запускає `npx @nitra/cursor fix python` (або просто `npx @nitra/cursor fix`, де `python` потрапляє у whitelist), CLI-оркестратор пакету:

1. Імпортує `run` із цього файлу: `const { run } = await import('.../npm/rules/python/fix.mjs')`.
2. Створює спільний `RuleContext` (зокрема `walkCache`).
3. Викликає `await run(ctx)` і збирає exit-code.

У цьому сценарії `if (isRunAsCli(...))` повертає `false`, бо модуль імпортовано — standalone-блок не виконується, `process.exit` не викликається.

### Сценарій 2. Прямий запуск (standalone mode)

```bash
bun npm/rules/python/fix.mjs
# або еквівалент:
npx @nitra/cursor fix python
```

1. Модуль виконується як entry-point — `isRunAsCli(import.meta.url)` → `true`.
2. Викликається `runRuleCli(import.meta.dirname)`:
   - завантажує конфіг проекту,
   - формує whitelist цілей,
   - усередині сам викликає `run(ctx)` (через `runStandardRule`),
   - друкує summary-звіт.
3. `process.exit` із отриманим exit-code (`0` або `1`) — придатно для CI (`bun npm/rules/python/fix.mjs && echo OK`).

### Внутрішній порядок підправил

Згідно з JSDoc до `run`, `runStandardRule` запускає послідовність:

1. **applies** — фільтр «чи правило взагалі застосовне до проекту» (читає метадані `meta.json` / контекст).
2. **JS-concerns** — JS-перевірки (у цьому правилі живуть у `./js/`).
3. **policy** — політики (у цьому правилі — `./policy/`).
4. **mdc-refs** — перевірка посилань усередині `python.mdc`.

Будь-яке порушення на будь-якому етапі підвищує exit-code до `1`, але всі етапи прогоняються — щоб користувач бачив повний список порушень за один прохід, а не виправляв їх по одному.

### Чому дві ролі в одному файлі

Це угода всього пакету `@nitra/cursor`: кожне правило має один `fix.mjs`, який:

- легко імпортувати з іншого правила/коду (named export `run`),
- легко запустити вручну для діагностики конкретного правила (`bun rules/<id>/fix.mjs`),
- однаково поводиться під CLI-оркестратором і в standalone.

Сусідні правила (наприклад, `npm/rules/n-bun/fix.mjs`, `npm/rules/n-adr/fix.mjs`) мають той самий шаблон — це дає змогу мати один універсальний loader і не дублювати CLI-код у кожному правилі.

## Rebuild Test

Контрольний перелік, за яким можна відтворити файл «з нуля», маючи лише цю документацію:

1. Файл — ES-модуль (`.mjs`), без default-експорту, із одним named export `run`.
2. Імпорти (у такому порядку):
   - `isRunAsCli` та `runRuleCli` з `../../scripts/lib/run-rule-cli.mjs`,
   - `runStandardRule` з `../../scripts/lib/run-standard-rule.mjs`.
3. Функція `run(ctx)`:
   - `export function run(ctx)`,
   - тіло: `return runStandardRule(import.meta.dirname, ctx)`,
   - JSDoc із описом «applies → JS-concerns → policy → mdc-refs», згадкою про library mode, `@param {RuleContext} [ctx]` і `@returns {Promise<number>}` (0 — OK, 1 — порушення).
4. Standalone-блок:
   - `if (isRunAsCli(import.meta.url)) { ... }`,
   - усередині: `process.exit(await runRuleCli(import.meta.dirname))`,
   - над `process.exit` — коментар-пояснення дволикої ролі fix.mjs та `eslint-disable-next-line n/no-process-exit, unicorn/no-process-exit` із причиною.
5. Файл не містить жодної додаткової логіки — усі перевірки правила живуть у сусідніх теках (`./js/`, `./lint/`, `./policy/`) та `./python.mdc`.
