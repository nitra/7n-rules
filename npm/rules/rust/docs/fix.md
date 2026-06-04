# `fix.mjs` — entry-point правила `rust`

## Огляд

Файл `npm/rules/rust/fix.mjs` — мінімальний adapter, який реєструє правило `rust` у двох ролях одночасно:

- **library mode** — модуль експортує функцію `run(ctx)`, яку викликає CLI-оркестратор пакета `@nitra/cursor` (через `import + run(ctx)`), передаючи спільний контекст прогону (наприклад, `walkCache` для шерингу обходу файлів між правилами).
- **standalone mode** — якщо файл запущено напряму (`bun npm/rules/rust/fix.mjs`), він поводиться як повний еквівалент команди `npx @nitra/cursor fix rust`: підвантажує конфіг, застосовує whitelist, друкує summary та повертає процесу exit-code.

Уся реальна логіка правила (порядок фаз: `applies → JS-concerns → policy → mdc-refs`) інкапсульована у двох helper-модулях зі спільної бібліотеки `npm/scripts/lib/`. Цей файл — лише тонкий wrapper, що з'єднує конвенцію розташування (`npm/rules/<id>/fix.mjs`) із цими helpers і не містить власної бізнес-логіки правила `rust`.

Файл слідує усталеному в репозиторії патерну "двох ролей `fix.mjs`": library + standalone — тому самий код використовується і коли правило виконується як частина мульти-rule прогону, і коли його запускають окремо для дебагу/CI.

## Експорти / API

Модуль експортує одну іменовану функцію:

| Експорт | Тип | Призначення |
| --- | --- | --- |
| `run` | `(ctx?: RuleContext) => Promise<number>` | Library-mode entry: запуск правила `rust` зі стандартним pipeline. |

Default-експорту немає. Імпортний шлях для зовнішніх споживачів — `@nitra/cursor/rules/rust/fix.mjs` (або еквівалентний relative-шлях усередині монорепо).

Тип `RuleContext` визначений у `npm/scripts/lib/run-standard-rule.mjs` і реекспортується через JSDoc-`import('...')`-тип у сигнатурі `run`.

## Функції

### `run(ctx)`

```js
export function run(ctx)
```

- **Сигнатура:** `run(ctx?: RuleContext): Promise<number>`
- **Параметри:**
  - `ctx` — *(опційний)* контекст прогону, який передає CLI-оркестратор. Структура задана в `run-standard-rule.mjs` (`RuleContext`); типове поле — `walkCache`, що дозволяє декільком правилам розділяти один обхід файлової системи в межах однієї сесії. Якщо `ctx` не передано (наприклад, у standalone), `runStandardRule` сам ініціалізує внутрішні структури.
- **Повертає:** `Promise<number>`
  - `0` — правило завершилось успішно, порушень не знайдено.
  - `1` — знайдено порушення (стандартний exit-code для CI/IDE).
- **Алгоритм:** делегує виконання у `runStandardRule(import.meta.dirname, ctx)`. Перший аргумент — абсолютний шлях до каталогу правила (`npm/rules/rust/`), завдяки якому `runStandardRule` сам читає `meta.json`, виявляє підкаталоги `js/`, `policy/`, `coverage/`, `lib/` і відповідний `.mdc`-файл (`rust.mdc`) для розв'язання refs.
- **Side effects:**
  - Власних side effects не має; усі ефекти (I/O, лог, walk-cache) виникають усередині `runStandardRule`.
  - Не модифікує `process.exit`, не пише в `process.stderr/stdout` напряму — це робить уже helper або стандартний CLI summary.

### Standalone entry-block

```js
if (isRunAsCli(import.meta.url)) {
  process.exit(await runRuleCli(import.meta.dirname))
}
```

- **Тип:** top-level side-effect блок (виконується при імпорті модуля).
- **Умова входу:** `isRunAsCli(import.meta.url)` повертає `true`, тобто файл виконано як головний модуль (`bun fix.mjs` / `node fix.mjs`), а не імпортовано з іншого модуля.
- **Що робить:** викликає `runRuleCli(import.meta.dirname)` — повний CLI-pipeline пакета `@nitra/cursor` для одного правила: завантаження конфіга, застосування whitelist, друк summary, повернення числового exit-code. Результат передається у `process.exit(...)`, щоб процес завершився з відповідним кодом для CI/IDE.
- **Чому два eslint-disable:**
  - `n/no-process-exit` (плагін `eslint-plugin-n`) — забороняє виклик `process.exit` у бібліотечному коді.
  - `unicorn/no-process-exit` (плагін `eslint-plugin-unicorn`) — теж забороняє `process.exit`.
  Тут вони відключені свідомо: standalone entry-point має повертати exit-code, інакше неможливо коректно інтегруватися з CI/IDE runners (вони чекають саме на код виходу процесу).
- **Side effects:** завершує процес викликом `process.exit(code)`.

## Залежності

### Внутрішні (relative imports)

| Шлях | Що використовується | Роль |
| --- | --- | --- |
| `../../scripts/lib/run-rule-cli.mjs` | `isRunAsCli`, `runRuleCli` | Helpers для standalone-режиму: детекція "запущено як CLI" та повний CLI-pipeline одного правила. |
| `../../scripts/lib/run-standard-rule.mjs` | `runStandardRule` | Стандартний рантайм правила: оркестрація фаз `applies → JS-concerns → policy → mdc-refs`. JSDoc-тип `RuleContext` теж імпортується звідси. |

### Зовнішні

Прямих залежностей від npm-пакетів немає. Усі external-залежності (наприклад, `fast-glob`, ESLint API тощо) інкапсульовані всередині `runStandardRule` / `runRuleCli` і сюди не "протікають".

### Runtime/Node API

- `import.meta.dirname` — стандартний Node.js / Bun API; використовується для передачі абсолютного шляху до каталогу правила в helpers.
- `import.meta.url` — використовується `isRunAsCli` для порівняння з `process.argv[1]`.
- `process.exit(code)` — завершення процесу в standalone-режимі.
- `await` на top level — потребує Node ≥ 14.8 (ESM top-level await) або Bun (підтримує з коробки).

### Конвенції розташування

Файл лежить за конвенцією `npm/rules/<id>/fix.mjs`, де `<id> = rust`. Поряд із ним мають існувати:

- `meta.json` — метадані правила (читається `runStandardRule`/`runRuleCli`).
- `rust.mdc` — людинозрозумілий опис правила (для mdc-refs).
- Підкаталоги `js/`, `policy/`, `coverage/`, `lib/` — фази правила.
- `docs/` — каталог із згенерованою документацією (включно з цим файлом).

## Потік виконання / Використання

### Сценарій A: виклик з CLI-оркестратора (library mode)

1. Оркестратор `@nitra/cursor` сканує `npm/rules/*/fix.mjs`.
2. Для правила `rust` виконує `import('npm/rules/rust/fix.mjs')`.
3. Викликає `run(ctx)`, передаючи спільний `RuleContext` (включно з `walkCache`).
4. `run` повертає `runStandardRule(import.meta.dirname, ctx)`, який послідовно виконує фази:
   - **applies** — фільтрує файли, до яких правило застосовне.
   - **JS-concerns** — запускає JS-аспекти правила (`js/`-фолдер).
   - **policy** — застосовує policy-checks (`policy/`-фолдер).
   - **mdc-refs** — валідує посилання в `rust.mdc`.
5. Результуючий `Promise<number>` (`0` або `1`) повертається оркестратору.
6. Оркестратор агрегує exit-коди всіх правил і повертає єдиний summary.

### Сценарій B: standalone-запуск

1. Користувач/CI виконує `bun npm/rules/rust/fix.mjs` (або `node npm/rules/rust/fix.mjs`).
2. Модуль завантажується; `isRunAsCli(import.meta.url)` повертає `true`.
3. Виконується `await runRuleCli(import.meta.dirname)`:
   - читає конфіг проєкту,
   - застосовує whitelist шляхів,
   - усередині сам викликає `runStandardRule` (або еквівалент),
   - друкує summary в stdout.
4. Отриманий числовий exit-code передається в `process.exit(code)`.
5. Процес завершується кодом `0` (ok) або `1` (порушення) — CI/IDE підхоплюють статус.

### Як додавати/змінювати поведінку

- **НЕ** додавати бізнес-логіку правила прямо в цей файл — він має лишатись тонким wrapper'ом.
- Зміни порядку фаз або їх складу — у `runStandardRule` (спільно для всіх стандартних правил).
- Зміни CLI-флагів / summary / whitelist — у `runRuleCli`.
- Зміни специфічні для правила `rust` — у відповідних підкаталогах (`js/`, `policy/`, `coverage/`, `lib/`) і файлі `rust.mdc`.

### Контракт із оркестратором

- Експорт `run` повинен бути **функцією** (не stream/generator) і повертати `Promise<number>`.
- Не повинен викидати unhandled rejections — усі помилки обгортаються всередині `runStandardRule`.
- Exit-коди суворо `0` або `1` (інші значення оркестратор може інтерпретувати як збій).
