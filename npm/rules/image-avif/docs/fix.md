# `fix.mjs` — entry-point правила `image-avif`

## Огляд

Файл `npm/rules/image-avif/fix.mjs` — це **подвійний entry-point** одного з правил пакета `@nitra/cursor`. Він входить до інфраструктури «standard rules», де кожне правило живе в окремій теці (`npm/rules/<id>/`) і складається з:

- `fix.mjs` — тонкий wrapper-orchestrator (цей файл);
- `meta.json` — метадані (наприклад, `auto`-залежності, тут `{"auto": ["vue", "image-compress"]}`);
- `<id>.mdc` — людино-зрозумілий опис правила для Cursor;
- підтек `js/` (concerns на рівні JS-AST/тексту) і `policy/` (rego-policy).

Конкретно цей файл виконує дві ролі:

1. **Library-режим.** Експортує функцію `run(ctx)`, яку CLI-orchestrator вищого рівня (`@nitra/cursor fix`) імпортує й викликає для прогону правила в межах загального пайплайну (з кешем walk-обходу й спільним підсумком).
2. **Standalone-режим.** Якщо файл запущено напряму (`bun npm/rules/image-avif/fix.mjs` або еквівалент), він самостійно піднімає повний CLI-цикл (`runRuleCli`) — з підвантаженням конфігурації, whitelist та виведенням підсумку — і завершує процес кодом 0/1.

Сам файл **не містить** логіки перевірки контенту: уся робота делегується в `runStandardRule`, який послідовно проганяє чотири фази правила — `applies → JS-concerns → policy → mdc-refs`.

## Експорти / API

| Експорт | Тип                                               | Призначення                                                                                                                                     |
| ------- | ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `run`   | `function (ctx?: RuleContext) => Promise<number>` | Library-точка входу правила. Викликається CLI-orchestratorом для запуску правила `image-avif`. Повертає exit-код (`0` — OK, `1` — є порушення). |

Інших іменованих чи default-експортів файл не має.

Окрім експорту, у файлі є **top-level side-effect**: блок `if (isRunAsCli(import.meta.url)) { … process.exit(await runRuleCli(...)) }`. Він спрацьовує **лише** коли цей `.mjs` запущено як CLI-entry (а не імпортовано як модуль), і завершує процес кодом, який повернув `runRuleCli`.

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
  - `ctx` — необов'язковий контекст прогону (`RuleContext`), імпортується з `../../scripts/lib/run-standard-rule.mjs`. У документації самого файла зазначено, що в `ctx` передається, наприклад, `walkCache` — спільний кеш обходу файлової системи, щоб не повторювати walk між правилами в межах одного CLI-прогону. Якщо `ctx` не передано, `runStandardRule` сам ініціалізує необхідне.
- **Повертає:** `Promise<number>` — числовий exit-код:
  - `0` — правило виконано без порушень;
  - `1` — знайдені порушення (несумісність із `image-avif`).
- **Що робить усередині:** єдиним викликом делегує всю роботу в `runStandardRule(dir, ctx)`. Перший аргумент — `import.meta.dirname`, тобто **абсолютний шлях до теки `npm/rules/image-avif/`** на диску. Саме цей шлях `runStandardRule` використовує, щоб знайти сусідні `meta.json`, теку `js/` (JS-concerns) та теку `policy/` (rego-policy) і прогнати їх по конвеєру.
- **Side effects:** прямих side-effects сама функція не виконує. Усі ефекти (читання файлів, виклик `opa`, форматування звіту) інкапсульовано в `runStandardRule`. Функція асинхронна (повертає `Promise`), бо `runStandardRule` повертає `Promise`.

### Top-level CLI-блок (не функція, але важливий side-effect)

```js
if (isRunAsCli(import.meta.url)) {
  // eslint-disable-next-line n/no-process-exit
  process.exit(await runRuleCli(import.meta.dirname))
}
```

- **Умова входу:** `isRunAsCli(import.meta.url)` повертає `true`, лише якщо файл стартовано напряму як скрипт (Node.js/Bun), а не імпортовано як модуль. Це класичний `__main__`-патерн для ESM.
- **Що робить:** викликає `runRuleCli(import.meta.dirname)` — повноцінний CLI-обгортувач, який, на відміну від `runStandardRule`, додатково підтягує конфігурацію проєкту, застосовує whitelist і друкує summary (як коментар у файлі: «повний еквівалент `npx @nitra/cursor fix <id>`»). Результатом є `Promise<number>` із exit-кодом.
- **Завершення:** `process.exit(...)` примусово завершує процес із отриманим exit-кодом. Це навмисно — для CI/IDE інтеграцій, які зчитують exit-код. Через це поряд стоять директиви `eslint-disable-next-line n/no-process-exit, unicorn/no-process-exit` із поясненням («standalone entry-point має повертати exit-code для CI/IDE»).
- **`await` на top-level:** доступний завдяки тому, що файл є ESM-модулем (`.mjs`) і виконується в середовищі з підтримкою top-level await (Node.js ≥ 14.8 / Bun).

## Залежності

### Імпорти з сусідніх модулів пакета

| Імпорт            | Звідки                                    | Призначення                                                                                                                                                          |
| ----------------- | ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `isRunAsCli`      | `../../scripts/lib/run-rule-cli.mjs`      | Предикат: чи поточний модуль виконано напряму як CLI (порівнює `import.meta.url` зі скриптом, який стартував процес).                                                |
| `runRuleCli`      | `../../scripts/lib/run-rule-cli.mjs`      | Standalone CLI-обгортка: завантажує конфігурацію, формує whitelist, прогоняє правило (через той самий `runStandardRule` усередині) і повертає exit-код.              |
| `runStandardRule` | `../../scripts/lib/run-standard-rule.mjs` | Стандартний пайплайн правила: послідовно виконує фази **applies → JS-concerns → policy → mdc-refs**, базуючись на структурі теки правила (передано через `dirname`). |

Шляхи відносні: `../../scripts/lib/...` означає `npm/scripts/lib/...` (з огляду на розташування файла в `npm/rules/image-avif/`).

### JSDoc-залежності типів

У JSDoc вказано тип `import('../../scripts/lib/run-standard-rule.mjs').RuleContext` для параметра `ctx`. Це **type-only** імпорт: на runtime він не існує, лише підказує IDE/типчекеру форму об'єкта контексту.

### Сусідні артефакти правила (не імпортуються тут, але необхідні `runStandardRule`)

- `npm/rules/image-avif/meta.json` — `{ "auto": ["vue", "image-compress"] }`. Поле `auto` декларує, які інші правила автоматично «тягнуться» разом із `image-avif`.
- `npm/rules/image-avif/js/` — каталог JS-concerns (тек з функціями перевірки/трансформації).
- `npm/rules/image-avif/policy/` — каталог rego-policy для фази `policy`.
- `npm/rules/image-avif/image-avif.mdc` — людинозрозумілий опис правила (для Cursor) — використовується у фазі `mdc-refs`.

### Зовнішні залежності

Прямих імпортів зовнішніх npm-пакетів у файлі немає. Усі залежності — внутрішні до пакета `@nitra/cursor`.

## Потік виконання / Використання

### Сценарій 1. Library-режим (через CLI-orchestrator)

Коли користувач запускає `npx @nitra/cursor fix` (або відповідну скіл-команду на кшталт `/n-fix`), верхньорівневий orchestrator:

1. Обходить теку `npm/rules/`, знаходить правило `image-avif`.
2. Динамічно імпортує `npm/rules/image-avif/fix.mjs` як ESM-модуль. У цей момент top-level `if (isRunAsCli(...))` повертає `false` (файл не запущено напряму), тож `process.exit` **не** викликається.
3. Викликає `run(ctx)`, передаючи спільний контекст (наприклад, із заздалегідь побудованим `walkCache`).
4. Усередині `run` делегує в `runStandardRule(import.meta.dirname, ctx)`, який послідовно проходить чотири фази:
   - **applies** — визначає, до яких файлів проєкту правило взагалі застосовне;
   - **JS-concerns** — запускає функції з теки `js/` для AST/текстових перевірок;
   - **policy** — викликає `opa` з rego-файлами з `policy/`;
   - **mdc-refs** — звіряє посилання у `.mdc`.
5. Отримує `0`/`1`, передає назад orchestratorу, який агрегує результати всіх правил у спільний summary.

### Сценарій 2. Standalone-режим (для дебагу/CI)

Користувач (або IDE/CI) запускає файл напряму:

```bash
bun npm/rules/image-avif/fix.mjs
```

1. Бунт/Node стартує файл як ESM-скрипт. Виконуються імпорти.
2. Експорт `run` зареєстровано, але **не викликається** — поза CLI-orchestratorом нікому його смикати.
3. Виконується top-level `if`: `isRunAsCli(import.meta.url)` повертає `true`.
4. Викликається `await runRuleCli(import.meta.dirname)` — повний еквівалент `npx @nitra/cursor fix image-avif`: завантаження конфігурації проєкту, whitelist, прогін правила (через той самий `runStandardRule` усередині `runRuleCli`), друк summary.
5. `process.exit(<exitCode>)` завершує процес із кодом, який бачить CI/IDE.

### Дизайн-патерн: dual-role entry-point

У коментарі автор файла прямо називає цей патерн: «Дві ролі fix.mjs: library (run) + standalone (main)». Це повторюваний патерн для всіх правил пакета — кожне правило має свій `fix.mjs` із такою ж двоїстою структурою. Завдяки цьому:

- CLI-orchestrator може **переюзати** ту саму функцію `run`, не дублюючи виклик `process.exit`;
- розробник може **локально дебажити** одне правило, запустивши його `fix.mjs` напряму;
- логіка пайплайну живе в одному місці (`runStandardRule`), а entry-point залишається тонким.

### Що цей файл **не** робить

- Не визначає, **які саме** файли проєкту порушують `image-avif` — це робить тека `js/` і `policy/`.
- Не парсить аргументи CLI — це робить `runRuleCli`.
- Не пише в stdout/stderr напряму — увесь вивід формує `runStandardRule`/`runRuleCli`.
- Не модифікує файли проєкту — назва `fix` тут історична (контракт стандартного правила); фактична семантика — це check + (потенційно) auto-fix усередині concerns, але сам `fix.mjs` лише оркеструє.
