# fix.mjs — entry-point правила `docker` (fix-режим)

## Огляд

Файл `npm/rules/docker/fix.mjs` — це тонкий **entry-point** правила `docker` у пакеті `@nitra/cursor` для режиму `fix` (автоматичне виправлення порушень). Він не містить власної логіки перевірки чи виправлень: уся реальна робота делегується у спільні бібліотечні функції з `npm/scripts/lib/`.

Файл виконує **дві ролі** одночасно (патерн dual-role module, прийнятий в усіх `rules/<id>/fix.mjs` цього репозиторію):

1. **Library role** — експортує іменовану функцію `run(ctx)`, яку викликає CLI-оркестратор `@nitra/cursor` (`bin/cursor.mjs` → `cmd-fix.mjs` / `cmd-fix-all.mjs`). У цьому режимі правило вбудовується в загальний прогін «всіх правил» зі спільним кешем обходу файлів (`walkCache`), агрегованим summary та глобальним whitelist.
2. **Standalone role** — якщо файл запущений напряму (`bun npm/rules/docker/fix.mjs` або через `import.meta.url` як головний модуль), він виконується як автономний CLI-ентрі: завантажує конфіг, застосовує whitelist, друкує summary та повертає exit-code, повністю еквівалентний `npx @nitra/cursor fix docker`.

Сам алгоритм виправлень розкладений у сусідніх теках цього правила (`js/`, `lint/`, `policy/`) і запускається уніфіковано через `runStandardRule`, яке прокручує чотири стандартні фази:

1. **applies** — перевірка, чи правило взагалі релевантне для поточного workspace.
2. **JS-concerns** — JS-специфічні fix-перевірки (з теки `js/`).
3. **policy** — політики/policy-перевірки правила.
4. **mdc-refs** — узгодження посилань у файлі `docker.mdc` (опис правила для Cursor).

ID правила (`docker`) визначається автоматично з імені директорії-носія через `import.meta.dirname` — у `fix.mjs` немає жодного хардкоду ID.

## Експорти / API

| Експорт     | Тип                      | Призначення                                                                                                                                    |
| ----------- | ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `run(ctx?)` | named export, `function` | Library-API: запустити стандартний fix-pipeline правила `docker`. Повертає `Promise<number>` з exit-кодом (`0` — OK, `1` — порушення/помилка). |

Інших іменованих або default-експортів файл не має.

Окрім експорту, модуль містить **top-level side-effect-блок** (поза `run`), який спрацьовує лише коли файл є точкою входу процесу — див. секцію _Потік виконання_.

### Сигнатура `run`

```js
export function run(ctx)
```

- **Параметри:**
  - `ctx` _(optional)_ — об’єкт типу `RuleContext` (з `../../scripts/lib/run-standard-rule.mjs`). Передається оркестратором, коли правило запускають у складі загального прогону «всіх правил». Може містити, зокрема, спільний `walkCache` (для уникнення повторного `walk`/`glob` файлів кожним правилом), накопичений summary, прапори дебагу тощо.
- **Повертає:** `Promise<number>` — exit-код прогону: `0` коли правило не знайшло порушень або успішно їх виправило, `1` коли лишились незавершені порушення чи виникла помилка.
- **Side effects:** делегуються у `runStandardRule` — це може бути запис у файли проєкту (auto-fix), читання конфіга/файлів, запис у stdout/stderr (summary, прогрес-логи), а також модифікація переданого `ctx` (наприклад, заповнення `walkCache`).

## Функції

### `run(ctx)`

**Сигнатура:** `export function run(ctx) → Promise<number>`

**Призначення:** library-API правила `docker` для CLI-оркестратора `@nitra/cursor`. Виконує повний fix-pipeline правила: `applies → JS-concerns → policy → mdc-refs`.

**Параметри:**

- `ctx` — _(optional, об’єкт)_ контекст прогону, який передає зовнішній оркестратор. Тип описаний у JSDoc-import-посиланні `import('../../scripts/lib/run-standard-rule.mjs').RuleContext`. Може містити:
  - `walkCache` — спільний кеш обходу/glob файлів, щоб правила не дублювали I/O;
  - інші службові поля (summary-агрегатор, прапори, конфіг), залежно від реалізації `run-standard-rule.mjs`.
  - Якщо викликати без аргументу, `runStandardRule` створить свій локальний контекст за замовчуванням.

**Повертає:** `Promise<number>` — exit-код. За конвенцією репозиторію: `0` — порушень не знайдено / усе виправлено, `1` — лишились порушення або сталася помилка.

**Side effects:** не виконує жодних побічних ефектів безпосередньо — лише повертає результат виклику `runStandardRule(import.meta.dirname, ctx)`. Усе I/O й auto-fix належить `runStandardRule` (читання файлів проєкту, потенційні модифікації файлів, запис у stdout, мутація `ctx.walkCache`).

**Ключова деталь:** першим аргументом у `runStandardRule` передається `import.meta.dirname` — абсолютний шлях до теки, в якій лежить цей `fix.mjs`. Звідти `runStandardRule` витягує ID правила (`docker` — остання частина шляху) і завантажує підкомпоненти з `js/`, `lint/`, `policy/`. Завдяки цьому `fix.mjs` цілком універсальний і не містить літерала `"docker"`.

## Залежності

### Внутрішні (з самого пакета `@nitra/cursor`)

| Імпорт            | Звідки                                    | Призначення                                                                                                                                     |
| ----------------- | ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `isRunAsCli`      | `../../scripts/lib/run-rule-cli.mjs`      | Детектор «чи запущено цей файл як головний модуль процесу (CLI)». Зазвичай порівнює `import.meta.url` з `pathToFileURL(process.argv[1])`.       |
| `runRuleCli`      | `../../scripts/lib/run-rule-cli.mjs`      | Standalone-обгортка: завантаження конфігу, застосування whitelist, друк summary, повернення exit-коду. Еквівалент `npx @nitra/cursor fix <id>`. |
| `runStandardRule` | `../../scripts/lib/run-standard-rule.mjs` | Універсальний fix-pipeline правила: послідовно прогоняє фази `applies → JS-concerns → policy → mdc-refs`, читаючи реалізації з підтек правила.  |

Розв’язання шляхів:

- `../../scripts/lib/...` від `npm/rules/docker/fix.mjs` → `npm/scripts/lib/run-rule-cli.mjs` і `npm/scripts/lib/run-standard-rule.mjs`.

### Зовнішні

Власних `node:`/npm-залежностей файл не імпортує. Опосередковано (через `runStandardRule` і `runRuleCli`) використовуються стандартні модулі для роботи з FS/процесом, але до цього файлу це не належить.

### Структурні залежності (runtime-конвенції)

Хоч `fix.mjs` нічого з них не імпортує статично, для коректної роботи правила в директорії `npm/rules/docker/` мають існувати:

- `meta.json` — метадані правила (ID, опис, applies-умови);
- `docker.mdc` — Cursor rule-документ, на який звіряються mdc-refs;
- `js/` — JS-специфічні fix-чеки правила (фаза _JS-concerns_);
- `lint/` — lint-перевірки (читаються відповідним check-режимом);
- `policy/` — policy-перевірки (фаза _policy_).

`runStandardRule` сам шукає й підвантажує ці компоненти за `import.meta.dirname`.

## Потік виконання / Використання

### Сценарій 1 — Library mode (виклик з оркестратора)

Так правило запускає `@nitra/cursor` під час команд типу `npx @nitra/cursor fix` (усі правила) або `npx @nitra/cursor fix docker` (одне правило, але через диспетчер):

1. Оркестратор робить динамічний `import('npm/rules/docker/fix.mjs')`.
2. Отримує функцію `run` з експортів.
3. Підготовлює спільний `ctx` (наприклад, з `walkCache`) і викликає `await run(ctx)`.
4. `run` повертає управління у `runStandardRule(import.meta.dirname, ctx)`, який:
   - визначає ID правила як `basename(import.meta.dirname)` = `docker`;
   - читає `meta.json` правила;
   - виконує фазу `applies` — пропускає правило, якщо воно нерелевантне;
   - запускає JS-concerns → policy → mdc-refs;
   - повертає exit-код (`0`/`1`).
5. Оркестратор додає результат до загального summary й переходить до наступного правила.

Гілка `if (isRunAsCli(...))` у цьому сценарії **не виконується**, бо файл імпортовано як модуль, а не запущено напряму.

### Сценарій 2 — Standalone mode (прямий запуск)

Використовується розробником або IDE/CI-кроком напряму, без проходу через головний `bin/cursor.mjs`:

```bash
bun npm/rules/docker/fix.mjs
# або
node npm/rules/docker/fix.mjs
```

1. Node/Bun виконує файл як модуль-точку входу.
2. Імпорти на верхньому рівні підтягують `isRunAsCli`, `runRuleCli`, `runStandardRule`.
3. Експорт `run` реєструється (на випадок, якщо хтось одночасно імпортує цей файл).
4. Виконується top-level блок:

   ```js
   if (isRunAsCli(import.meta.url)) {
     process.exit(await runRuleCli(import.meta.dirname))
   }
   ```

   - `isRunAsCli(import.meta.url)` повертає `true`, бо файл є головним модулем процесу.
   - `await runRuleCli(import.meta.dirname)` виконує повноцінний standalone-pipeline: завантаження конфіга, whitelist, виклик внутрішнього аналогу `run` (тобто `runStandardRule`), друк summary.
   - `process.exit(<code>)` завершує процес із отриманим exit-кодом, щоб CI / IDE могли правильно інтерпретувати успіх/помилку.

5. Коментарі в коді явно фіксують виняток ESLint: `n/no-process-exit` і `unicorn/no-process-exit` свідомо вимкнено саме для цього рядка, бо standalone-ентрі **зобов’язаний** повертати exit-код процесу.

### Інваріанти / контракти

- ID правила завжди дорівнює імені теки, де лежить `fix.mjs` (тут — `docker`). Хардкод відсутній — переміщення в іншу теку автоматично змінить ID, тому файл не можна копіювати без перейменування теки.
- `run` має лишатися **named export** `run` (не default) — оркестратор шукає саме це ім’я.
- Top-level `await runRuleCli(...)` працює завдяки тому, що файл є ES-модулем (`.mjs`) із підтримкою top-level await.
- Гілка `isRunAsCli` повинна лишатися **єдиним** side-effect блоком на верхньому рівні; будь-яка інша робота на модульному рівні зламає library mode.

## Rebuild Test

З цієї документації можна реконструювати файл-еквівалент:

```js
import { isRunAsCli, runRuleCli } from '../../scripts/lib/run-rule-cli.mjs'
import { runStandardRule } from '../../scripts/lib/run-standard-rule.mjs'

/**
 * Запускає правило: applies → JS-concerns → policy → mdc-refs.
 * Library mode: викликається CLI orchestration через `import + run(ctx)`.
 * @param {import('../../scripts/lib/run-standard-rule.mjs').RuleContext} [ctx]
 * @returns {Promise<number>} 0 — OK, 1 — порушення
 */
export function run(ctx) {
  return runStandardRule(import.meta.dirname, ctx)
}

if (isRunAsCli(import.meta.url)) {
  // Standalone-ентрі: повний еквівалент `npx @nitra/cursor fix <id>`.
  // eslint-disable-next-line n/no-process-exit
  process.exit(await runRuleCli(import.meta.dirname))
}
```

Семантично та функціонально такий код тотожний оригіналу: дві ролі модуля (library `run` + standalone main), делегування у `runStandardRule`/`runRuleCli`, ID правила визначається через `import.meta.dirname`, exit-код процесу повертається лише у standalone-режимі.
