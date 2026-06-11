---
docgen:
  source: npm/rules/adr/fix.mjs
  crc: b46c541a
---

# `npm/rules/adr/fix.mjs`

## Огляд

Файл `fix.mjs` — це **entry-point правила `adr`** у складі пакета `@nitra/cursor`. Він виконує дві ролі одночасно й тримає мінімум власної логіки, делегуючи всю роботу до загальних бібліотечних функцій оркестрації правил:

1. **Library mode (бібліотечний режим).** Експортує функцію `run(ctx)`, яку викликає зовнішній оркестратор `@nitra/cursor` (наприклад, команда `npx @nitra/cursor fix adr` або агрегований прогін усіх правил). У цьому режимі правило виконує стандартну послідовність кроків `applies → JS-concerns → policy → mdc-refs` через `runStandardRule`, а контекст (наприклад, спільний `walkCache` для обходу файлів) передається ззовні.
2. **Standalone mode (самостійний запуск).** Якщо файл запущено напряму як CLI (наприклад, `bun npm/rules/adr/fix.mjs`), він повністю емулює виклик `npx @nitra/cursor fix adr`: завантажує конфіг, застосовує whitelist, виводить summary і повертає процесу exit-code 0/1 для CI/IDE.

Файл сам по собі **не містить** ні логіки перевірки правила ADR, ні визначень policy/mdc-refs — він лише підключає механіку, спільну для всіх правил у директорії `npm/rules/*/fix.mjs`. Власне поведінка правила `adr` визначається сусідніми файлами в каталозі `npm/rules/adr/` (наприклад, `check-adr.mjs`, `.mdc`-файл, конфіг правила), які `runStandardRule` підхоплює за конвенцією на основі `import.meta.dirname`.

## Експорти / API

Файл публікує один іменований експорт:

| Експорт | Тип / сигнатура | Призначення |
| --- | --- | --- |
| `run` | `(ctx?: RuleContext) => Promise<number>` | Запуск правила `adr` у library-режимі через `runStandardRule`. Повертає 0 (OK) або 1 (порушення). |

Окрім експорту, файл має **top-level side-effect**: блок `if (isRunAsCli(import.meta.url)) { … }` виконується одразу при імпорті/запуску модуля та, у разі прямого CLI-запуску, завершує процес викликом `process.exit(...)`. У бібліотечному режимі (`import { run } from '...'`) цей блок не спрацьовує, бо `isRunAsCli` повертає `false`.

Default-експортів, констант чи класів файл **не** надає.

## Функції

### `run(ctx)`

```js
export function run(ctx) {
  return runStandardRule(import.meta.dirname, ctx)
}
```

- **Призначення.** Виконати стандартний конвеєр правила `adr`: `applies → JS-concerns → policy → mdc-refs`. Уся механіка делегується бібліотечній функції `runStandardRule`; локальної логіки немає, окрім прокидання директорії правила й контексту.
- **Параметри.**
  - `ctx` (необов'язковий) — `RuleContext` із `../../scripts/lib/run-standard-rule.mjs`. Контекст переноситься між викликами різних правил у межах одного запуску оркестратора й може містити, наприклад, кешований обхід файлової системи (`walkCache`), що дозволяє не повторювати дорогі операції для кожного правила. Якщо `ctx` не передано, `runStandardRule` створює власний контекст за замовчуванням.
- **Повертає.** `Promise<number>` — `0`, якщо порушень правила немає; `1`, якщо знайдено хоча б одне порушення. Це **exit-code-сумісний** код, який далі використовується CLI-обгорткою для `process.exit`.
- **Side effects.** У межах самого `run` побічних ефектів **не вводить**; усі ефекти (читання файлів, друк звіту, кешування) виконуються всередині `runStandardRule`. Identифікатор правила визначається неявно через `import.meta.dirname` — тобто директорія, у якій лежить цей `fix.mjs` (`npm/rules/adr`), стає каноном для пошуку всіх supplementary-файлів правила (checks, mdc, конфіг).
- **Помилки.** Власних `try/catch` немає. Якщо `runStandardRule` кидає виняток, він проростає до викликача незмінно. У standalone-режимі винятки обробляються вже не `run`, а `runRuleCli`.

### Top-level CLI-блок (не функція, але виконуваний код модуля)

```js
if (isRunAsCli(import.meta.url)) {
  process.exit(await runRuleCli(import.meta.dirname))
}
```

- **Призначення.** Якщо файл запущено як головний модуль (тобто `import.meta.url` відповідає `argv[1]`), активується standalone-режим — еквівалент `npx @nitra/cursor fix adr`.
- **Логіка.**
  1. `isRunAsCli(import.meta.url)` визначає, чи модуль є entry-point процесу (а не імпортовано бібліотечно).
  2. `runRuleCli(import.meta.dirname)` виконує повний CLI-pipeline для правила в цій директорії: завантаження конфігу, застосування whitelist, виклик внутрішнього `run`, друк summary, повернення numeric exit-code.
  3. `process.exit(...)` завершує процес із цим exit-кодом — це потрібно, аби CI/IDE могли інтерпретувати успіх/невдачу.
- **Top-level `await`.** Виклик `await runRuleCli(...)` працює завдяки ESM top-level await (`.mjs`).
- **Pragma-коментар.** Над `process.exit` стоїть `eslint-disable-next-line n/no-process-exit, unicorn/no-process-exit` із поясненням: standalone entry-point **повинен** повертати exit-code, тому загальна заборона `process.exit` тут свідомо відключена.
- **Чому два режими в одному файлі.** В коментарі прямо зазначено: "Дві ролі fix.mjs: library (run) + standalone (main)". Це конвенція пакета `@nitra/cursor` — кожне правило має один `fix.mjs`, який можна і `import`-ити, і запускати безпосередньо.

## Залежності

### Внутрішні (workspace `@nitra/cursor`)

| Шлях | Імпортовані символи | Роль |
| --- | --- | --- |
| `../../scripts/lib/run-rule-cli.mjs` | `isRunAsCli`, `runRuleCli` | `isRunAsCli` — перевірка, чи модуль є CLI entry-point. `runRuleCli` — повний CLI-pipeline (config + whitelist + summary + exit-code). |
| `../../scripts/lib/run-standard-rule.mjs` | `runStandardRule` | Реалізація стандартного конвеєра правила: `applies → JS-concerns → policy → mdc-refs`. Також звідси походить JSDoc-тип `RuleContext`. |

Шляхи відносні: з `npm/rules/adr/` два рівні вгору ведуть у `npm/`, далі — `scripts/lib/`.

### Зовнішні (npm-пакети)

Прямих імпортів зовнішніх пакетів файл **не** має. Опосередковано, через бібліотечні модулі, можуть бути задіяні стандартні утиліти Node (`node:fs`, `node:path` тощо) — але це деталь реалізації `runStandardRule` / `runRuleCli`, а не цього файла.

### Платформенні вимоги

- **ESM**. Розширення `.mjs` + використання `import.meta.dirname` і `import.meta.url`.
- **`import.meta.dirname`** — доступне в Node.js ≥ 20.11 та Bun. Без цієї властивості модуль не запрацює.
- **Top-level `await`** — для standalone-блоку.

## Потік виконання / Використання

### Сценарій 1. Library-режим (виклик із оркестратора)

```js
import { run } from '@nitra/cursor/rules/adr/fix.mjs'

const code = await run({ walkCache /*, … */ })
if (code !== 0) {
  // знайдені порушення правила adr
}
```

Послідовність кроків усередині `run`:

1. `runStandardRule` отримує абсолютний шлях директорії правила (`import.meta.dirname` → `…/npm/rules/adr`).
2. За конвенціями цієї директорії бібліотека сама знаходить:
   - `applies`-фільтр (які файли підпадають під правило),
   - JS-concerns-перевірки,
   - policy-частину (rego/правила політики, якщо є),
   - `mdc-refs` (перевірка посилань на `.mdc`-файли).
3. Кожен крок виконується послідовно; якщо хоч один знаходить порушення — фінальний exit-code = `1`.
4. Promise резолвиться числом `0` або `1`.

Сам файл `fix.mjs` у цьому потоці — **тонка обгортка**: він не приймає рішень і не друкує нічого власноруч.

### Сценарій 2. Standalone-режим (запуск напряму)

```bash
bun npm/rules/adr/fix.mjs
# або
node npm/rules/adr/fix.mjs
```

Послідовність:

1. Модуль завантажується, `run` стає експортованим.
2. Виконується top-level умова `isRunAsCli(import.meta.url)` → `true`.
3. `runRuleCli(import.meta.dirname)` бере на себе:
   - читання конфігу (наприклад, `.cursor`-конфіг або CLI-параметри),
   - застосування whitelist (обмеження файлів, які проходять перевірку),
   - виклик внутрішньої функції `run` цього ж правила,
   - друк підсумкового summary (скільки файлів, скільки порушень),
   - повернення exit-code (`0` або `1`).
4. `process.exit(...)` зупиняє процес із цим кодом — CI/IDE отримують стандартний сигнал успіху/невдачі.

Цей режим — еквівалент `npx @nitra/cursor fix adr`, але без потреби у глобально встановленому CLI: достатньо мати checkout репозиторію.

### Сценарій 3. Імпорт без виконання (рідкісний)

Якщо файл імпортується умовами, де `import.meta.url !== argv[1]`, спрацьовує лише експорт `run`; CLI-блок мовчазно пропускається. Це і є основою «двох ролей»: ESM-модуль безпечно імпортувати з будь-якого місця без сайд-ефекту запуску процесу.

### Контекст у системі правил

Файл вписується у плаский набір правил `npm/rules/<id>/fix.mjs`. Кожне правило має такий самий каркас, відрізняючись лише іменем директорії (а отже — `import.meta.dirname`) та допоміжними файлами поруч (`check-*.mjs`, `*.mdc` тощо). Логіка спільного pipeline винесена у `scripts/lib/run-standard-rule.mjs` і `scripts/lib/run-rule-cli.mjs`, що робить `fix.mjs` максимально декларативним: він — «адаптер» між директорією правила та оркестратором.

## Rebuild Test

Якщо знищити цей файл і реконструювати з документації вище, відновлювана версія повинна:

1. Бути ESM-модулем (`.mjs`).
2. Імпортувати з `../../scripts/lib/run-rule-cli.mjs` дві іменовані функції: `isRunAsCli` та `runRuleCli`.
3. Імпортувати з `../../scripts/lib/run-standard-rule.mjs` іменовану функцію `runStandardRule`.
4. Експортувати функцію `run(ctx)`, яка повертає результат виклику `runStandardRule(import.meta.dirname, ctx)` (без `await`, бо promise повертається як є).
5. Мати JSDoc-блок до `run` з посиланням на тип `RuleContext` з `run-standard-rule.mjs` та описом `@returns {Promise<number>}` із семантикою `0 — OK, 1 — порушення`.
6. Містити top-level умову `if (isRunAsCli(import.meta.url))`, всередині якої виконується `process.exit(await runRuleCli(import.meta.dirname))`.
7. Над `process.exit` мати ESLint-disable-коментар для `n/no-process-exit` та `unicorn/no-process-exit` із поясненням, що standalone entry-point повинен повертати exit-code для CI/IDE.
8. **Не** містити жодної додаткової логіки правила `adr` всередині — уся механіка делегована бібліотечним функціям.

Реконструйована версія за цими інваріантами буде функціонально еквівалентною оригіналу.
