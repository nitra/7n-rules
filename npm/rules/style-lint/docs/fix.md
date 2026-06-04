# fix.mjs — точка входу правила `style-lint`

## Огляд

Файл `npm/rules/style-lint/fix.mjs` — це точка входу (entry-point) правила з ідентифікатором `style-lint` у системі `@nitra/cursor`. Він виконує дві ролі одночасно:

1. **Library mode** — експортує функцію `run(ctx)`, яку зовнішній CLI-оркестратор (`npx @nitra/cursor fix <id>` чи внутрішній диспетчер правил) імпортує й запускає в межах загального прогону пакета правил.
2. **Standalone mode** — якщо файл запущено напряму через `bun rules/style-lint/fix.mjs`, він самостійно ініціалізує конфіг, whitelist, summary та повертає exit-code, повністю еквівалентний виклику `npx @nitra/cursor fix style-lint`.

Сам файл навмисно тонкий: вся логіка перевірок винесена у спільні утиліти `runStandardRule` (стандартний пайплайн правила: `applies → JS-concerns → policy → mdc-refs`) і `runRuleCli` (обгортка для standalone-запуску). Це канонічна форма entry-point для будь-якого правила в монорепо `@nitra/cursor`, що дозволяє додавати нові правила, не дублюючи orchestration-код.

Правило `style-lint` оперує над стилями (Style/CSS-частина) — деталі його перевірок мешкають у сусідніх теках (`js/`, `policy/`, `style-lint.mdc`), але сам цей файл їх не імпортує: пайплайн виявляє їх автоматично за конвенцією директорії `import.meta.dirname`.

## Експорти / API

| Експорт | Тип | Призначення |
|---------|-----|-------------|
| `run` | `function (ctx?: RuleContext) => Promise<number>` | Запускає стандартний пайплайн правила `style-lint`. Повертає `0` за відсутності порушень, `1` — за наявності. |

Експорт `run` — це **публічний контракт правила**. Будь-який оркестратор, що знає лише шлях до директорії правила, може динамічно імпортувати `fix.mjs` і викликати `run(ctx)`.

Жодних інших іменованих експортів, default-експорту, констант чи класів файл не надає.

## Функції

### `run(ctx)`

```js
export function run(ctx) {
  return runStandardRule(import.meta.dirname, ctx)
}
```

- **Сигнатура:** `run(ctx?: RuleContext): Promise<number>`
- **Параметри:**
  - `ctx` (необов'язковий) — об'єкт контексту прогону типу `RuleContext` (визначений у `../../scripts/lib/run-standard-rule.mjs`). Містить, зокрема, `walkCache` — кеш обходу файлової системи, який оркестратор переюзує між правилами, щоб не сканувати дерево повторно. Якщо `ctx` не передано — `runStandardRule` створить дефолтний контекст самостійно.
- **Повертає:** `Promise<number>` — exit-code:
  - `0` — правило виконано, порушень не знайдено;
  - `1` — знайдено порушення (CI має зафейлити збірку).
- **Side effects:**
  - Звертається до файлової системи через `runStandardRule` (читає файли проєкту, що підпадають під `applies`-фільтр правила).
  - Може писати у stdout/stderr (summary, помилки) через утиліти всередині `runStandardRule`.
  - Сам по собі функція **не** мутує жодного файлу — навіть для правил із суфіксом `fix.mjs` пайплайн у режимі звичайного прогону є read-only (модифікації виконуються в окремих fix-режимах, які тут не задіяні).
- **Як працює:** делегує всю роботу `runStandardRule`, передаючи їй власну директорію (`import.meta.dirname` = абсолютний шлях до `npm/rules/style-lint/`). Пайплайн всередині послідовно прогонить чотири фази:
  1. **applies** — визначення, які файли проєкту підпадають під дію правила;
  2. **JS-concerns** — JS/MJS-перевірки (логіка з `js/`);
  3. **policy** — Rego/політики (логіка з `policy/`);
  4. **mdc-refs** — звірення посилань у `style-lint.mdc` (актуальність документації).

### Standalone-блок (top-level `if`)

```js
if (isRunAsCli(import.meta.url)) {
  process.exit(await runRuleCli(import.meta.dirname))
}
```

- **Не функція**, а top-level guard, що виконується лише коли файл стартує безпосередньо як CLI-точка (а не імпортується іншим модулем).
- **Детект:** `isRunAsCli(import.meta.url)` повертає `true`, коли `import.meta.url` відповідає аргументу запуску процесу (тобто `bun npm/rules/style-lint/fix.mjs` чи `node npm/rules/style-lint/fix.mjs`).
- **Дія:** викликає `runRuleCli(import.meta.dirname)`, яка проганяє повний цикл CLI (config-loading, whitelist, summary, exit-code) і завершує процес через `process.exit` зі здобутим кодом.
- **Чому `await` на верхньому рівні:** файл — ES-модуль `.mjs`, top-level `await` дозволений.
- **Eslint-винятки:** `n/no-process-exit` та `unicorn/no-process-exit` навмисно відключені рядковим коментарем, бо для standalone entry-point явний `process.exit` — єдиний коректний спосіб віддати exit-code CI/IDE.

## Залежності

### Внутрішні (relative imports)

| Модуль | Що з нього імпортовано | Роль |
|--------|-----------------------|------|
| `../../scripts/lib/run-rule-cli.mjs` | `isRunAsCli`, `runRuleCli` | Утиліти standalone-режиму: детект CLI-запуску та повний CLI-цикл (config + whitelist + summary). |
| `../../scripts/lib/run-standard-rule.mjs` | `runStandardRule` | Стандартний пайплайн правила (applies → JS-concerns → policy → mdc-refs). Також надає тип `RuleContext` (через JSDoc-typedef). |

Шляхи `../../scripts/lib/...` обчислюються відносно `npm/rules/style-lint/` і вказують на `npm/scripts/lib/`.

### Зовнішні

- **Жодних** npm-пакетів файл напряму не імпортує. Усі залежності — внутрішні.
- **Runtime:** Node.js / Bun з підтримкою ESM, `import.meta.url`, `import.meta.dirname` та top-level `await`.

### Сусідні артефакти правила (не імпортуються тут, але задіяні через пайплайн)

- `npm/rules/style-lint/meta.json` — метадані правила (id, applies-патерни тощо), читається `runStandardRule`/`runRuleCli`.
- `npm/rules/style-lint/style-lint.mdc` — людиночитна специфікація правила (target для mdc-refs-фази).
- `npm/rules/style-lint/js/` — JS-частина перевірок (підвантажується JS-concerns-фазою).
- `npm/rules/style-lint/policy/` — Rego-політики (підвантажуються policy-фазою).

## Потік виконання / Використання

### Сценарій A — імпорт оркестратором (library mode)

```text
@nitra/cursor CLI (або інший runner)
        │
        │ dynamic import('npm/rules/style-lint/fix.mjs')
        ▼
fix.mjs → export run(ctx)
        │
        │ runStandardRule(import.meta.dirname, ctx)
        ▼
run-standard-rule.mjs
        │
        ├── applies-фаза (фільтр файлів)
        ├── JS-concerns-фаза (js/)
        ├── policy-фаза (policy/)
        └── mdc-refs-фаза (style-lint.mdc)
        │
        ▼
        return 0 | 1
```

Оркестратор зазвичай передає `ctx` із попередньо побудованим `walkCache`, щоб уникнути повторного обходу файлового дерева між десятками правил.

### Сценарій B — пряма CLI-точка (standalone mode)

```text
$ bun npm/rules/style-lint/fix.mjs
        │
        │ Node/Bun завантажує fix.mjs як головний модуль
        ▼
import-блок виконано → run експортовано
        │
        ▼
top-level if (isRunAsCli(import.meta.url))   // true
        │
        │ await runRuleCli(import.meta.dirname)
        ▼
run-rule-cli.mjs
        │
        ├── завантажує конфіг проєкту
        ├── застосовує whitelist
        ├── викликає внутрішньо аналог run(ctx)
        ├── друкує summary
        └── повертає number (exit-code)
        │
        ▼
process.exit(<exit-code>)
```

Цей режим використовується розробником локально (`bun npm/rules/style-lint/fix.mjs`) або IDE-інтеграцією, що очікує POSIX exit-code.

### Інваріанти та контракт

- Файл — **stateless**: жодних модульних змінних, кешів, синглтонів. Усе передається через `ctx`.
- Функція `run` **ідемпотентна** щодо файлової системи (read-only прогон).
- `run` **завжди** повертає `Promise<number>` зі значенням `0` або `1` — оркестратор не повинен очікувати інших значень чи кидків.
- Standalone-блок виконується **виключно** коли файл — головний модуль; при `import` із іншого коду блок мовчазно пропускається завдяки `isRunAsCli`.

### Як додати аналогічний entry-point для нового правила

1. Створити теку `npm/rules/<new-rule-id>/`.
2. Скопіювати цей `fix.mjs` без змін (шляхи відносні до `npm/rules/<id>/` ідентичні).
3. Покласти поруч `meta.json`, `<new-rule-id>.mdc`, `js/`, `policy/` за потреби.
4. Пайплайн `runStandardRule` підхопить нове правило автоматично, без правок самого `fix.mjs`.

Це і є цінність «тонкого» entry-point: правила додаються декларативно, без дублювання orchestration-логіки.
