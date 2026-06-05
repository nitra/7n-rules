# fix.mjs — точка входу правила `worktree` (fix)

## Огляд

Файл `npm/rules/worktree/fix.mjs` — це **точка входу правила `worktree`** для пакета `@nitra/cursor`. Він реалізує **дві ролі одночасно** (dual role):

1. **Library mode** — експортує функцію `run(ctx)`, яку CLI-оркестратор `@nitra/cursor` (або інший runner) викликає через `import { run } from '.../fix.mjs'` для запуску правила в межах батч-прогону всіх правил.
2. **Standalone mode** — якщо файл запускається напряму через `bun npm/rules/worktree/fix.mjs`, він самостійно ініціалізує CLI-обгортку (config-loading, whitelist, summary) і завершує процес `exit-code`-ом, придатним для CI/IDE.

Сам файл **не містить власної логіки перевірки** — він лише делегує виконання стандартному раннеру `runStandardRule`, який послідовно виконує підкроки правила в наступному порядку:

- **applies** — детектор, чи застосовне правило до конкретного файлу/директорії;
- **JS-concerns** — JS-перевірки (зокрема `check-*.mjs` у директорії правила);
- **policy** — політики/декларативні перевірки;
- **mdc-refs** — перевірка посилань у відповідному `.mdc`-документі правила.

Каталог `worktree/` стосується доменного правила про **git worktree** (див. `.cursor/rules/n-worktree.mdc`) — конвенцій ізольованих робочих дерев у `.worktrees/<branch>/` та інвентарних описів. Сам `fix.mjs` не реалізує цих перевірок безпосередньо — він лише диспетчеризує їх через стандартний пайплайн.

## Експорти / API

| Експорт | Тип                                             | Призначення                                                                                                                                                         |
| ------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `run`   | `function (ctx?: RuleContext): Promise<number>` | Library-entry. Запускає стандартний пайплайн правила для директорії, в якій знаходиться `fix.mjs`. Повертає **exit-code**: `0` — порушень немає, `1` — є порушення. |

Файл також містить **side-effect блок** (виконується тільки при прямому запуску як CLI), який не є експортом, але є частиною контракту:

- При `isRunAsCli(import.meta.url) === true` модуль викликає `runRuleCli(import.meta.dirname)` і завершує процес `process.exit(<code>)`.

## Функції

### `run(ctx)`

**Сигнатура:**

```js
export function run(ctx)
```

**Параметри:**

| Параметр | Тип                                                         | Обов'язковий | Опис                                                                                                                                                                                                                                                             |
| -------- | ----------------------------------------------------------- | ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ctx`    | `RuleContext` (з `../../scripts/lib/run-standard-rule.mjs`) | Ні           | Контекст прогону правила. Передається оркестратором із `@nitra/cursor` і містить, зокрема, спільні структури на кшталт `walkCache` (кеш обходу файлової системи між кількома правилами в одному прогоні). Якщо не передано — раннер створить дефолтний контекст. |

**Повертає:** `Promise<number>` — exit-code:

- `0` — правило виконалося без порушень;
- `1` — знайдено порушення (інтерпретація залежить від `runStandardRule`).

**Side effects:**

- Сама `run` не пише в `stdout` напряму та не змінює FS — усі побічні ефекти інкапсульовані в `runStandardRule` (форматований вивід summary, потенційне читання `.mdc`/`check-*.mjs`-файлів сусідньої директорії, обхід проєктних файлів через `walkCache`).
- `run` **не** викликає `process.exit` — це відповідальність standalone-блоку нижче.

**Поведінкова ідіома:**

`run` — це тонкий **прокладочний шар**: він фіксує **директорію** правила (`import.meta.dirname`), бо саме за нею раннер визначає `id` правила (ім'я каталогу `worktree`), знаходить сусідні файли (`policy.mjs`, `applies.mjs`, `check-*.mjs`, `<id>.mdc`) та збирає пайплайн.

### Standalone-блок (top-level)

Анонімний side-effect блок, що виконується лише при прямому запуску:

```js
if (isRunAsCli(import.meta.url)) {
  process.exit(await runRuleCli(import.meta.dirname))
}
```

**Поведінка:**

- `isRunAsCli(import.meta.url)` повертає `true`, якщо модуль є **головним** entry-point процесу (а не імпортований). Це типова заміна паттерну `require.main === module` для ESM.
- `runRuleCli(import.meta.dirname)` — повна CLI-обгортка над `run`: завантажує проєктний config, застосовує whitelist (наприклад, виключення з `.cursorignore`/конфігу), друкує summary після виконання та повертає підсумковий exit-code.
- `process.exit(code)` — закриває процес з кодом, придатним для CI/IDE. Лінт-винятки `n/no-process-exit` та `unicorn/no-process-exit` свідомо вимкнені коментарем, бо standalone entry-point має лагідно виходити з конкретним кодом, інакше CI не отримає сигналу про fail.

## Залежності

Внутрішні залежності (відносні до `npm/scripts/lib/`):

| Імпорт            | З файлу                                   | Призначення                                                                                                                        |
| ----------------- | ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `isRunAsCli`      | `../../scripts/lib/run-rule-cli.mjs`      | Перевіряє, чи поточний модуль є головним процесом (заміна `require.main === module` для ESM).                                      |
| `runRuleCli`      | `../../scripts/lib/run-rule-cli.mjs`      | Standalone-обгортка: config-loading + whitelist + summary + exit-code. Еквівалент `npx @nitra/cursor fix <id>` для одного правила. |
| `runStandardRule` | `../../scripts/lib/run-standard-rule.mjs` | Стандартний пайплайн правила: applies → JS-concerns → policy → mdc-refs. Приймає директорію правила та опційний `RuleContext`.     |

Зовнішні залежності та глобальні API:

- `import.meta.dirname` — ESM-аналог `__dirname`; використовується для передачі шляху до каталогу правила раннерам.
- `import.meta.url` — використовується `isRunAsCli` для визначення головного модуля.
- `process.exit(code)` — Node.js/Bun runtime API для встановлення exit-code.

Файл **не залежить** напряму від конкретних `check-*.mjs`, `policy.mjs`, `<id>.mdc` сусідньої директорії — їх відкриває та інтерпретує `runStandardRule`.

## Потік виконання / Використання

### Сценарій A — Library mode (виклик з оркестратора)

```js
import { run } from '@nitra/cursor/rules/worktree/fix.mjs'

const ctx = { walkCache: new Map(/* ... */) }
const exitCode = await run(ctx)
// exitCode === 0 — OK, 1 — порушення
```

Послідовність:

1. Оркестратор (`@nitra/cursor fix` без аргументів або з переліком правил) проходить по списку правил і для кожного робить `import('.../fix.mjs')`.
2. Викликає `run(sharedCtx)`, де `sharedCtx.walkCache` спільний для всіх правил у прогоні (економить FS-обходи).
3. `run` делегує в `runStandardRule(import.meta.dirname, ctx)`.
4. `runStandardRule` послідовно виконує під-кроки правила `worktree`: `applies` → JS-перевірки → `policy` → `mdc-refs`.
5. Повертається `number` (0/1), оркестратор агрегує результати всіх правил у фінальний summary.

Жодних `process.exit` у цьому сценарії — control flow залишається в оркестратора.

### Сценарій B — Standalone mode (прямий запуск)

```bash
bun npm/rules/worktree/fix.mjs
# або (еквівалент)
npx @nitra/cursor fix worktree
```

Послідовність:

1. Bun завантажує файл; `import.meta.url` вказує на сам файл як головний entry-point.
2. `isRunAsCli(import.meta.url)` повертає `true`.
3. Виконується `await runRuleCli(import.meta.dirname)`:
   - читає проєктний config (`.cursor`/`package.json`);
   - застосовує whitelist (включення/виключення файлів);
   - формує `RuleContext` та викликає `run(ctx)` (опосередковано, через стандартний пайплайн);
   - друкує summary в stdout (кількість порушень, перелік фейлів тощо).
4. `process.exit(<exitCode>)` — процес закривається з кодом для CI/IDE.

### Чому така архітектура (dual role)

- Library mode дає **спільний батч**: один обхід FS, одна summary, паралельний прогін правил.
- Standalone mode зручний для **локальної налагодки** одного правила і для **IDE-інтеграцій** (Cursor запускає окремий `fix.mjs` й отримує exit-code).
- Логіка не дублюється — `runRuleCli` всередині все одно використовує той самий `runStandardRule`.

### Конвенція директорії правила

Для коректної роботи цього `fix.mjs` у сусідній директорії `npm/rules/worktree/` мають бути (опційно — будь-які з):

- `worktree.mdc` (або `<id>.mdc`) — людинозрозумілий опис правила;
- `applies.mjs` — детектор застосовності;
- `policy.mjs` — декларативні політики;
- `check-*.mjs` — JS-перевірки (детальна логіка);
- `meta.json` — метадані (у т.ч. `worktree: true` для skill-ів).

Сам `fix.mjs` нічого з цього не імпортує напряму — все шукає `runStandardRule` за `import.meta.dirname`.

## Rebuild Test

Перевірка, що файл можна відновити з цієї документації:

1. **Імпорти:** два named-імпорти — `isRunAsCli`, `runRuleCli` з `../../scripts/lib/run-rule-cli.mjs`; `runStandardRule` з `../../scripts/lib/run-standard-rule.mjs`.
2. **Export `run(ctx)`:** JSDoc з `@param ctx` (опційний, тип `RuleContext` із `run-standard-rule.mjs`) та `@returns {Promise<number>}` (0 — OK, 1 — порушення); тіло — `return runStandardRule(import.meta.dirname, ctx)`.
3. **Top-level `if`:** `if (isRunAsCli(import.meta.url)) { process.exit(await runRuleCli(import.meta.dirname)) }`.
4. **Eslint-disable коментар:** перед `process.exit` — `// eslint-disable-next-line n/no-process-exit, unicorn/no-process-exit -- standalone entry-point має повертати exit-code для CI/IDE`.
5. **Коментарі:** перед `if`-блоком — пояснення про standalone-режим та еквівалентність `npx @nitra/cursor fix <id>`; над `run` — JSDoc про послідовність applies → JS-concerns → policy → mdc-refs та library mode.
6. **Стиль:** ESM, без `;` у кінці рядків, single quotes, без default-експортів.
