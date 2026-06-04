# fix.mjs — entry-point правила `tauri`

## Огляд

Файл `npm/rules/tauri/fix.mjs` — це тонкий **entry-point** (точка входу) правила `tauri` у системі правил `@nitra/cursor`. Файл виконує дві ролі одночасно:

1. **Library mode** — експортує функцію `run(ctx)`, яку оркестратор CLI (`@nitra/cursor`) викликає через динамічний `import`, передаючи спільний контекст прогону (`RuleContext`, наприклад, `walkCache` для повторного використання обходу файлової системи між правилами).
2. **Standalone mode** — якщо файл запущено напряму через `bun npm/rules/tauri/fix.mjs`, виконується повний еквівалент команди `npx @nitra/cursor fix tauri` (з підвантаженням конфігу, обробкою whitelist та виведенням summary), а процес завершується з відповідним exit-code для CI/IDE.

Сам файл **не містить жодної доменної логіки правила** `tauri` — уся робота (steps `applies → JS-concerns → policy → mdc-refs`) делегується у бібліотечну функцію `runStandardRule()`. Цей файл лише підключає стандартний раннер до конкретної директорії правила (`import.meta.dirname`) і опціонально запускає CLI-обгортку.

Файл є **типовим шаблоном `fix.mjs`** для будь-якого правила в `npm/rules/<id>/`: майже всі правила в цій директорії мають ідентичний за структурою `fix.mjs`, що відрізняється лише доменом (`tauri`, `vue`, `python` тощо), який неявно визначається через шлях `import.meta.dirname`.

## Експорти / API

| Експорт | Тип | Опис |
| --- | --- | --- |
| `run` | `(ctx?: RuleContext) => Promise<number>` | Іменований експорт. Запускає стандартний пайплайн правила (`applies → JS-concerns → policy → mdc-refs`) для директорії, у якій знаходиться `fix.mjs`. Повертає `0` при відсутності порушень і `1` (або інший ненульовий код) у разі порушень. |

Файл **не має** `default`-експорту. Side-effect на верхньому рівні: якщо модуль завантажено як CLI-entry (`isRunAsCli(import.meta.url) === true`), виконується `await runRuleCli(...)` і `process.exit(...)`.

### Тип `RuleContext`

Тип параметра `ctx` імпортується (через JSDoc `@typedef`) з `../../scripts/lib/run-standard-rule.mjs`. Зазвичай містить:

- `walkCache` — кеш обходу файлової системи, щоб не сканувати дерево повторно для кожного правила.
- Інші поля, специфічні для оркестрації (логер, прапорці `dryRun`, тощо).

Параметр `ctx` опціональний: якщо файл запущено окремо (standalone), `ctx` буде `undefined`, і `runStandardRule()` сам створить локальний контекст.

## Функції

### `run(ctx)`

```js
export function run(ctx) {
  return runStandardRule(import.meta.dirname, ctx)
}
```

- **Сигнатура:** `function run(ctx?: RuleContext): Promise<number>`
- **Параметри:**
  - `ctx` *(опціональний, `RuleContext`)* — контекст прогону, який зазвичай передає оркестратор `@nitra/cursor`. У ньому, серед іншого, може бути `walkCache` для уникнення повторного сканування файлової системи між різними правилами.
- **Повертає:** `Promise<number>` — асинхронний код виходу:
  - `0` — правило відпрацювало без порушень (OK);
  - `1` (або інший ненульовий код, який повертає `runStandardRule`) — знайдено порушення.
- **Side effects:**
  - Викликає `runStandardRule()`, яка послідовно виконує етапи `applies → JS-concerns → policy → mdc-refs`. Ці етапи можуть:
    - читати файли у репозиторії;
    - запускати JS-перевірки (наприклад, статичні правила з директорії `js/`);
    - виконувати policy-перевірки (наприклад, `policy/`-перевірки правила `tauri`);
    - порівнювати посилання у `.mdc`-файлах (`mdc-refs`).
  - Сам по собі `run()` **не змінює** файли (правило `fix`-типу може здійснювати автозаміни всередині `runStandardRule`, якщо це закладено у бібліотеці; у самому `fix.mjs` цієї логіки немає).
- **Як використовується:** оркестратор CLI імпортує `fix.mjs` правила і викликає `await run(ctx)`. Результат складається у загальний summary прогону.

### Standalone-блок (top-level)

```js
if (isRunAsCli(import.meta.url)) {
  // eslint-disable-next-line n/no-process-exit, unicorn/no-process-exit -- standalone entry-point має повертати exit-code для CI/IDE
  process.exit(await runRuleCli(import.meta.dirname))
}
```

- **Призначення:** дозволяє запускати правило напряму, без проходження через головний CLI `@nitra/cursor`. Команда `bun npm/rules/tauri/fix.mjs` стає повним еквівалентом `npx @nitra/cursor fix tauri`.
- **Логіка:**
  - `isRunAsCli(import.meta.url)` повертає `true`, якщо поточний модуль є точкою входу процесу (а не imported-модулем). Це класична перевірка ESM-еквівалента `require.main === module`.
  - Якщо `true`, викликається `runRuleCli(import.meta.dirname)`, яка обгортає `runStandardRule` додатковою CLI-логікою: завантаження конфігу проєкту, обробка whitelist (виключень), виведення summary у консоль.
  - `process.exit(...)` із цим кодом — обов’язковий для CI/IDE: процес має повернути ненульовий код у разі порушень, щоб pipeline (наприклад, у `n-cursor` чи у GitHub Actions) міг це задетектити. Тому ESLint-правила `n/no-process-exit` і `unicorn/no-process-exit` навмисно вимкнено через inline-коментар.
- **Side effects:**
  - Може писати у `stdout`/`stderr` (summary, помилки).
  - Завершує процес викликом `process.exit(...)` — після цього рядка код не виконується.
  - **Не виконується** у library mode (коли файл імпортовано іншим скриптом).

## Залежності

### Внутрішні (relative imports)

| Імпорт | Шлях | Призначення |
| --- | --- | --- |
| `isRunAsCli` | `../../scripts/lib/run-rule-cli.mjs` | Утиліта-перевірка: чи запущено файл як головний модуль (entry-point), а не як `import`. |
| `runRuleCli` | `../../scripts/lib/run-rule-cli.mjs` | Standalone-обгортка над `runStandardRule`: завантаження конфігу, whitelist, summary, exit-code. |
| `runStandardRule` | `../../scripts/lib/run-standard-rule.mjs` | Бібліотечна функція, що виконує стандартний пайплайн правила: `applies → JS-concerns → policy → mdc-refs`. |

Усі шляхи відносні: `../../scripts/lib/` → `npm/scripts/lib/`.

### Зовнішні

Файл **не має** прямих залежностей від npm-пакетів. Усі npm-залежності, якщо такі є, прихилені всередині бібліотечних функцій (`runStandardRule`, `runRuleCli`).

### Контекст домену

Директорія `npm/rules/tauri/` містить також:

- `tauri.mdc` — людиночитна специфікація правила (формат Cursor `.mdc`);
- `meta.json` — метадані правила (наприклад, прапорці `worktree`, опис);
- `js/` — JS-частина перевірок правила (запускається на етапі JS-concerns);
- `policy/` — policy-перевірки (rego/інші) на етапі policy.

`runStandardRule` неявно «знає», як обробити кожен з цих артефактів, через переданий `import.meta.dirname`.

## Потік виконання / Використання

### Library mode (типовий, через оркестратор)

1. Користувач запускає `npx @nitra/cursor fix` (або підкоманду, що зачіпає правило `tauri`).
2. Оркестратор `@nitra/cursor`:
   1. Знаходить директорію `npm/rules/tauri/`.
   2. Виконує `const mod = await import('npm/rules/tauri/fix.mjs')`.
   3. Перевірка `isRunAsCli(import.meta.url)` повертає `false` (бо це import, а не entry-point) — standalone-блок **не виконується**.
   4. Викликає `await mod.run(ctx)`, передаючи спільний контекст (з `walkCache` тощо).
3. `run(ctx)` → `runStandardRule(import.meta.dirname, ctx)` → послідовно виконуються етапи:
   - **applies** — фільтрація: чи правило взагалі застосовне до поточного репозиторію/файлів.
   - **JS-concerns** — JS-перевірки з директорії `js/` правила.
   - **policy** — policy-перевірки з директорії `policy/` правила.
   - **mdc-refs** — перевірка посилань у `.mdc` файлах правила.
4. Повертається `Promise<number>` із кодом виходу для цього правила, який оркестратор агрегує у summary всіх правил.

### Standalone mode (debug / прямий запуск)

```bash
bun npm/rules/tauri/fix.mjs
```

1. Bun завантажує файл як головний модуль.
2. `import { isRunAsCli, runRuleCli, runStandardRule }` — підвантажуються залежності.
3. Експорт `run` стає доступним (але ніхто його не викликає у цьому режимі).
4. Виконується top-level `if (isRunAsCli(import.meta.url))`:
   - `isRunAsCli(...) === true`.
   - `await runRuleCli(import.meta.dirname)`:
     - завантажує конфіг проєкту;
     - застосовує whitelist;
     - всередині викликає `runStandardRule(dir, ctx)` (з локально-створеним контекстом);
     - виводить summary у консоль.
   - `process.exit(<code>)` — процес завершується з кодом `0` (OK) або `1` (порушення).

### Дві ролі одного файлу

Архітектурний прийом — **«library + main» в одному файлі** — закладений у коментарі коду:

> Дві ролі fix.mjs: library (run) + standalone (main).

Це дозволяє:

- розробнику швидко налагоджувати правило окремо (`bun rules/tauri/fix.mjs`);
- оркестратору повторно використовувати кеш обходу (`walkCache`) між правилами під час масового прогону.

## Rebuild Test

Файл є **тонким адаптером** і не містить доменної логіки — його можна повністю відтворити за цією документацією. Структура:

1. Два іменовані імпорти з `../../scripts/lib/run-rule-cli.mjs`: `isRunAsCli`, `runRuleCli`.
2. Один іменований імпорт з `../../scripts/lib/run-standard-rule.mjs`: `runStandardRule`.
3. JSDoc-блок із описом, типом параметра `ctx` (через `@param {import('...')...}`) і типом результату (`Promise<number>`).
4. `export function run(ctx) { return runStandardRule(import.meta.dirname, ctx) }`.
5. Top-level `if (isRunAsCli(import.meta.url))` з викликом `process.exit(await runRuleCli(import.meta.dirname))` і inline-коментарем-вимкненням ESLint-правил `n/no-process-exit` та `unicorn/no-process-exit`.

Жодних інших артефактів (інших експортів, констант, побічних `console.log`, мутації глобального стану) у файлі немає.
