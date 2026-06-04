# fix.mjs — точка входу правила `changelog`

## Огляд

Файл `npm/rules/changelog/fix.mjs` — тонкий **entry-point** для правила `changelog` у складі пакета `@nitra/cursor`. Він виконує дві ролі одночасно:

1. **Library mode** — експортує функцію `run(ctx)`, яку викликає зовнішній CLI-оркестратор (`scripts/cli/fix.mjs` або аналог), коли користувач запускає `npx @nitra/cursor fix changelog` (чи прогін усіх правил `fix`). У цьому режимі `runStandardRule` отримує контекст із кешем обходу файлової системи (`walkCache`), shared summary тощо.
2. **Standalone mode** — якщо файл запущено напряму (`bun npm/rules/changelog/fix.mjs`), виконується повноцінний CLI-сценарій із завантаженням конфігу, whitelist-фільтрацією й friendly summary — тобто еквівалент `npx @nitra/cursor fix changelog`.

Сам файл **не містить бізнес-логіки** правила: вся перевірка/автофікс ділиться між суб-модулями (`applies` → `JS-concerns` → `policy` → `mdc-refs`), які підтягуються конвенційно через `runStandardRule(import.meta.dirname, ctx)`. Поведінка повністю детермінована директорією, в якій лежить `fix.mjs` (`import.meta.dirname` вказує на `npm/rules/changelog/`).

Це шаблонний файл-обгортка — він повторюється для **кожного** правила в `npm/rules/<rule-id>/fix.mjs`. Зміни тут зазвичай небажані; натомість конкретна перевірка живе у сусідніх теках (`js/`, `lib/`, `meta.json`, `changelog.mdc`).

## Експорти / API

| Експорт | Тип | Призначення |
| --- | --- | --- |
| `run` | `function (ctx?: RuleContext) => Promise<number>` | Library-функція для виклику з зовнішнього CLI; повертає exit-code `0` (OK) або `1` (є порушення). |

Сторонніх іменованих експортів немає. Default export відсутній.

### Side-effect при імпорті

Файл містить **top-level умовний блок**:

```js
if (isRunAsCli(import.meta.url)) {
  process.exit(await runRuleCli(import.meta.dirname))
}
```

— якщо модуль виконується як точка входу процесу (`process.argv[1]` відповідає `import.meta.url`), він **завершить процес** через `process.exit(...)`. У звичайному library-імпорті (`import { run } from '.../fix.mjs'`) `isRunAsCli` повертає `false`, отже `process.exit` НЕ викликається — імпорт безпечний.

Зверніть увагу на `await` на top-level — файл потребує підтримки top-level await (ESM, Node ≥ 14.8 / Bun).

## Функції

### `run(ctx)`

```js
export function run(ctx) {
  return runStandardRule(import.meta.dirname, ctx)
}
```

- **Сигнатура:** `run(ctx?: RuleContext): Promise<number>`
- **Параметри:**
  - `ctx` *(optional)* — об'єкт `RuleContext`, тип якого імпортується з `../../scripts/lib/run-standard-rule.mjs`. Зазвичай несе спільний стан між кількома правилами: кеш обходу файлів (`walkCache`), accumulator для summary, прапорці dry-run/auto-fix тощо. Якщо `ctx` не передано — `runStandardRule` створить дефолтний контекст всередині.
- **Повертає:** `Promise<number>` — exit-code правила:
  - `0` — порушень немає (або всі автоматично виправлені);
  - `1` — є невиправні порушення / помилки.
- **Side effects:**
  - Делегує всю роботу до `runStandardRule(dir, ctx)`. Це може включати: обхід файлової системи (`walkdir`), читання/запис файлів-учасників правила (auto-fix), вивід у `stdout`/`stderr` через спільний логер, мутацію `ctx.walkCache` тощо.
  - **Не** викликає `process.exit` напряму.
- **Помилки:** будь-який reject від `runStandardRule` пробрасується нагору (caller відповідає за `try/catch`).

### Анонімний CLI-блок (top-level)

```js
if (isRunAsCli(import.meta.url)) {
  process.exit(await runRuleCli(import.meta.dirname))
}
```

- **Тригер:** виконується **лише** коли файл — точка входу процесу. Використовує `isRunAsCli(import.meta.url)` для надійного визначення (порівняння `import.meta.url` з `process.argv[1]` через `pathToFileURL`).
- **Дія:** делегує до `runRuleCli(import.meta.dirname)` — повноцінного CLI-обгортача, який:
  - завантажує конфіг (`.cursor/cursor.json` чи аналог);
  - застосовує whitelist/blacklist;
  - збирає friendly summary;
  - запускає `runStandardRule` всередині.
- **Завершення:** `process.exit(<exit-code>)` — пробрасує код у shell для CI/IDE-інтеграцій.
- **ESLint disables:**
  - `n/no-process-exit` та `unicorn/no-process-exit` свідомо вимкнено коментарем — standalone entry-point **зобов'язаний** повертати exit-code для CI/IDE.

## Залежності

### Внутрішні (relative imports)

| Модуль | Що використано | Призначення |
| --- | --- | --- |
| `../../scripts/lib/run-rule-cli.mjs` | `isRunAsCli`, `runRuleCli` | Хелпери standalone-режиму: детект "запущено як CLI" та повноцінна CLI-обгортка. |
| `../../scripts/lib/run-standard-rule.mjs` | `runStandardRule` | Універсальний раннер, що виконує "стандартну" послідовність етапів правила: `applies → JS-concerns → policy → mdc-refs`. Також експортує тип `RuleContext` (через JSDoc-`import`). |

Шлях `../../` веде з `npm/rules/changelog/` до `npm/scripts/lib/`.

### Сусідні артефакти правила `changelog`

Не імпортуються напряму з цього файлу, але **використовуються `runStandardRule`** конвенційно (за іменами файлів у тій самій теці):

- `npm/rules/changelog/meta.json` — метадані правила (id, опис, теги, прапорці `worktree`/`policy`).
- `npm/rules/changelog/changelog.mdc` — людинозрозумілий зміст правила (Cursor MDC).
- `npm/rules/changelog/js/` — JS-concerns (перевірки/фікси для коду).
- `npm/rules/changelog/lib/` — допоміжні модулі правила.

### Зовнішні (Node/runtime)

- `import.meta.url` — стандарт ESM, для детекту CLI-режиму.
- `import.meta.dirname` — потребує Node ≥ 20.11 або Bun (Bun підтримує). Передається в обидва раннери як корінь правила.
- `process.exit` — глобал Node/Bun.
- Top-level `await` — ESM-фіча, потребує сумісного runtime.

## Потік виконання / Використання

### Library mode (типовий — виклик з оркестратора `fix`)

```text
npx @nitra/cursor fix
      │
      ▼
scripts/cli/fix.mjs (orchestrator)
      │  для кожного правила з whitelist:
      ▼
import { run } from 'npm/rules/<id>/fix.mjs'
      │
      ▼
run(ctx)
      │
      ▼
runStandardRule(import.meta.dirname, ctx)
      │
      ▼
applies → JS-concerns → policy → mdc-refs
      │
      ▼
Promise<0 | 1>
```

Приклад програмного виклику:

```js
import { run } from '@nitra/cursor/npm/rules/changelog/fix.mjs'

const code = await run({ walkCache: new Map(), summary: [] })
if (code !== 0) {
  // є порушення — обробити в caller
}
```

### Standalone mode (ручний запуск/debug)

```bash
bun npm/rules/changelog/fix.mjs
# еквівалент:
npx @nitra/cursor fix changelog
```

Послідовність:

1. ESM-модуль завантажується як entry-point.
2. Виконуються імпорти.
3. Експорт `run` реєструється (але ніхто не викликає).
4. Виконується умова `isRunAsCli(import.meta.url)` → `true`.
5. `await runRuleCli(import.meta.dirname)` — завантажує конфіг, фільтрує whitelist (тут — лише поточне правило, бо `dirname` фіксує id), запускає `runStandardRule`, друкує summary.
6. `process.exit(<code>)` — повертає exit-code у shell.

### Чому два режими в одному файлі?

- **DRY** — не дублювати entry-point на кожне правило.
- **DevEx** — розробник може дебажити одне правило: `bun npm/rules/<id>/fix.mjs`.
- **CI** — оркестратор `fix.mjs` імпортує `run` гуртом, ділить кеш обходу між правилами для прискорення.

## Rebuild Test (контекстна незалежність)

Файл можна відтворити, маючи лише цю документацію:

1. Створіть `npm/rules/changelog/fix.mjs`.
2. Імпортуйте `isRunAsCli` та `runRuleCli` з `../../scripts/lib/run-rule-cli.mjs`.
3. Імпортуйте `runStandardRule` з `../../scripts/lib/run-standard-rule.mjs`.
4. Експортуйте функцію `run(ctx)`, яка повертає результат `runStandardRule(import.meta.dirname, ctx)`.
5. Додайте JSDoc до `run` з типом `RuleContext` (через `import('../../scripts/lib/run-standard-rule.mjs').RuleContext`) і `Promise<number>` на повернення.
6. Внизу додайте умовний блок `if (isRunAsCli(import.meta.url)) { process.exit(await runRuleCli(import.meta.dirname)) }`.
7. Поряд із `process.exit(...)` додайте eslint-disable коментар для `n/no-process-exit` та `unicorn/no-process-exit` із обґрунтуванням "standalone entry-point має повертати exit-code для CI/IDE".

Результат має бути ідентичним за поведінкою оригіналу: library-імпорт безпечний, standalone-запуск завершує процес коректним exit-code.
