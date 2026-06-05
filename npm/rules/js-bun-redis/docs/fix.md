# fix.mjs — правило `js-bun-redis`

## Огляд

Файл `npm/rules/js-bun-redis/fix.mjs` — це тонкий **entry-point** правила `js-bun-redis` у системі `@nitra/cursor`. Він не містить власної бізнес-логіки перевірки/виправлення: уся робота (resolve `applies`, JS-concerns, policy, mdc-refs) делегується утиліті `runStandardRule`, а CLI-обгортка — `runRuleCli`.

Файл реалізує **дві ролі одночасно**:

1. **Library mode** — інші модулі імпортують функцію `run(ctx)` і запускають правило в межах загального оркестрування (наприклад, `npx @nitra/cursor fix` обходить набір правил, передаючи спільний `walkCache` через `ctx`).
2. **Standalone mode** — пряме виконання через `bun npm/rules/js-bun-redis/fix.mjs`. У цьому випадку модуль самостійно завантажує конфіг, застосовує whitelist і друкує summary, повертаючи коректний exit-code для CI/IDE.

Правило `js-bun-redis` належить до родини "standard rules" і параметризується тим, що `runStandardRule` отримує `import.meta.dirname` поточної теки — далі допоміжна бібліотека сама читає `meta.json`, `applies.mjs`, `check-*.mjs` тощо, які знаходяться поруч у каталозі `npm/rules/js-bun-redis/`.

## Експорти / API

| Експорт | Тип                                  | Опис                                                                                                                      |
| ------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| `run`   | `function (ctx?) => Promise<number>` | Іменований експорт. Запускає правило в library-режимі. Сумісний із загальним runner-ом, який очікує сигнатуру `run(ctx)`. |

Default-експорту немає. Side-effect-ний блок наприкінці файлу не експортується — він активний лише при прямому виконанні модуля як CLI.

## Функції

### `run(ctx)`

```js
export function run(ctx)
```

- **Сигнатура:** `run(ctx?: RuleContext): Promise<number>`
- **Параметри:**
  - `ctx` (необовʼязковий) — обʼєкт контексту прогону правила (`RuleContext`, тип реекспортовано з `../../scripts/lib/run-standard-rule.mjs`). Типово містить кешовані результати обходу файлової системи (`walkCache`) та інші спільні структури, які передаються між правилами під час оркестрованого прогону. Якщо викликати без аргументу — `runStandardRule` створить локальний контекст самостійно.
- **Повертає:** `Promise<number>` — exit-код:
  - `0` — правило пройшло без порушень,
  - `1` — знайдено порушення (`runStandardRule` сам формує summary з деталями знайдених проблем у stdout/stderr).
- **Side effects:**
  - Читання файлів проєкту, які матчаться `applies.mjs` цього правила.
  - Логування результатів (summary) у stdout залежить від внутрішньої поведінки `runStandardRule`.
  - Безпосередньо у `fix.mjs` ніяких глобальних мутацій, мережевих викликів чи запису у ФС немає — все інкапсульовано в делегованих бібліотеках.

### CLI-блок (top-level, без імені)

```js
if (isRunAsCli(import.meta.url)) {
  process.exit(await runRuleCli(import.meta.dirname))
}
```

- **Умова:** `isRunAsCli(import.meta.url)` повертає `true`, коли цей файл є entry-point поточного Node/Bun-процесу (а не імпортується з іншого модуля).
- **Дія:** виконує `await runRuleCli(import.meta.dirname)` — повний еквівалент `npx @nitra/cursor fix <id>`, включно з:
  - завантаженням конфігурації,
  - застосуванням whitelist,
  - друком підсумкового summary.
- **Завершення процесу:** результат (числовий exit-code) передається у `process.exit(...)`, що зупиняє процес із потрібним статусом для CI / IDE-інтеграції.
- **ESLint-винятки:**
  - `n/no-process-exit` та `unicorn/no-process-exit` локально відключено через те, що standalone-точка входу зобовʼязана повертати числовий exit-code (інакше CI не побачить статус правила).

## Залежності

### Внутрішні модулі

- `../../scripts/lib/run-rule-cli.mjs` — реекспортує:
  - `isRunAsCli(metaUrl)` — детектор того, чи виконується модуль як CLI entry-point.
  - `runRuleCli(dirname)` — повна CLI-обгортка для одного правила.
- `../../scripts/lib/run-standard-rule.mjs` — реекспортує:
  - `runStandardRule(dirname, ctx?)` — стандартний пайплайн для "звичайного" правила: `applies` → JS-concerns → policy → mdc-refs.
  - JSDoc-тип `RuleContext` (використовується лише в анотації параметра `ctx`).

### Сусідні артефакти правила (читаються опосередковано через `runStandardRule` / `runRuleCli`)

- `npm/rules/js-bun-redis/meta.json` — метаінформація правила (id, severity, applies-патерни, посилання на `.mdc` тощо).
- `npm/rules/js-bun-redis/applies.mjs` — фільтр файлів, до яких застосовується правило.
- `npm/rules/js-bun-redis/check-*.mjs` — конкретні перевірки JS-concerns.
- `npm/rules/js-bun-redis/policy.mjs` (за наявності) — policy-шар.
- Звʼязаний `.mdc` у каталозі `mdc/` — людинозрозумілий опис правила (`mdc-refs`-перевірка переконується, що посилання збігаються).

### Зовнішні залежності

Прямих імпортів npm-пакетів у файлі немає. Усі сторонні залежності (наприклад, `fs`, `path` тощо) приходять транзитивно через `runStandardRule` / `runRuleCli`.

### Глобалі та середовище виконання

- `import.meta.dirname` — абсолютний шлях до теки `npm/rules/js-bun-redis/`. Використовується як ідентифікатор правила (`runStandardRule` із `dirname` зчитує `meta.json` та інші файли поруч).
- `import.meta.url` — URL поточного модуля. Передається в `isRunAsCli` для детекту режиму запуску.
- `process.exit(code)` — глобальний Node/Bun API. Використовується **виключно** у standalone-режимі.
- Підтримка top-level `await` — обовʼязкова; код розрахований на ESM-runtime (Node ≥ 14.8 з ESM або Bun).

## Потік виконання / Використання

### Сценарій 1. Library mode (виклик з оркестратора)

1. Зовнішній runner (`npx @nitra/cursor fix`) імпортує `run` з цього файлу.
2. Передає підготовлений `ctx` (зазвичай зі спільним `walkCache`, аби не повторювати обхід файлової системи між правилами).
3. `run(ctx)` повертає `runStandardRule(import.meta.dirname, ctx)`.
4. `runStandardRule`:
   - читає `meta.json` поточної теки правила,
   - виконує `applies` → JS-concerns → policy → mdc-refs (стандартний пайплайн "стандартного" правила),
   - повертає `0`/`1`.
5. Runner агрегує exit-коди всіх правил і вирішує загальний статус.

### Сценарій 2. Standalone mode

1. Користувач/CI запускає:
   ```bash
   bun npm/rules/js-bun-redis/fix.mjs
   ```
2. Module-evaluation сягає блоку `if (isRunAsCli(import.meta.url))` — умова `true`.
3. Виконується `await runRuleCli(import.meta.dirname)`:
   - завантаження конфігу,
   - whitelist,
   - повний CLI-пайплайн (включно з summary),
   - повертає числовий exit-code.
4. `process.exit(<code>)` завершує процес із цим кодом — CI/IDE бачить fail (`1`) або success (`0`).

### Чому два режими в одному файлі

Це уніфікована конвенція системи правил `@nitra/cursor`: кожен `fix.mjs` є **і** імпортованим модулем (для оркестрованого прогону), **і** виконуваним скриптом (для локальної відладки конкретного правила). Завдяки `isRunAsCli` обидва шляхи безпечно співіснують: при імпорті side-effect-блок не спрацьовує.

### Типові команди

- Прогнати лише це правило локально: `bun npm/rules/js-bun-redis/fix.mjs`.
- Прогнати в межах усього набору правил: `npx @nitra/cursor fix` (runner викличе саме `run(ctx)`).
- Прогнати з конкретним id через CLI: `npx @nitra/cursor fix js-bun-redis` (виконує по суті те саме, що й standalone-режим цього файлу).
