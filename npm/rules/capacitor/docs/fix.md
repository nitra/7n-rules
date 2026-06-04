# fix.mjs — Capacitor rule entry-point

## Огляд

Файл `npm/rules/capacitor/fix.mjs` — це уніфікована точка входу для правила `capacitor` у системі правил `@nitra/cursor`. Файл виконує дві ролі одночасно:

1. **Library mode** — експортує функцію `run(ctx)`, яку зовнішній CLI-оркестратор (наприклад, `npx @nitra/cursor fix capacitor` або інший composite-агент) імпортує й викликає, передаючи спільний контекст прогону (`ctx`) з кешем обходу файлової системи (`walkCache`) тощо.
2. **Standalone mode** — якщо файл запущено напряму (`bun npm/rules/capacitor/fix.mjs`), він самостійно піднімає повну CLI-обв'язку (`runRuleCli`), включно з завантаженням конфігурації, whitelist-фільтрами, друком summary та завершенням процесу з відповідним exit-кодом.

Сама логіка правила винесена в загальний раннер `runStandardRule`, який поетапно виконує стандартний пайплайн правила:

1. **applies** — перевірка, чи правило взагалі релевантне для поточного проєкту.
2. **JS-concerns** — прогін JS/TS перевірок із підкатки `js/` правила.
3. **policy** — прогін policy-перевірок із підкатки `policy/` правила (Rego/OPA або інші policy-файли).
4. **mdc-refs** — валідація посилань у `capacitor.mdc` (правило-документ).

Цей файл свідомо тонкий: він не містить доменної логіки правила, а лише підключає правило до інфраструктури `runStandardRule` / `runRuleCli`. Доменна частина живе в каталогах `js/`, `policy/` та у файлі `capacitor.mdc` поряд.

## Експорти / API

| Експорт | Тип | Призначення |
|--------|-----|------------|
| `run` | `(ctx?: RuleContext) => Promise<number>` | Запуск правила в library-режимі. Повертає `0` (OK) або `1` (порушення). |

Інших іменованих експортів немає. Default-експорту немає.

Файл також має **side-effect виконання на верхньому рівні**: блок `if (isRunAsCli(import.meta.url))` запускає CLI, якщо модуль виконується безпосередньо, а не імпортується.

## Функції

### `run(ctx)`

Запускає правило `capacitor` у library-режимі — той самий пайплайн, який виконує standalone `fix.mjs <id>`, але без CLI-обв'язки (без завантаження зовнішнього конфіга, без друку summary, без `process.exit`).

- **Сигнатура:** `function run(ctx)`
- **Параметри:**
  - `ctx` — необов'язковий об'єкт типу `RuleContext` (тип імпортується з `../../scripts/lib/run-standard-rule.mjs`). Призначений для передачі спільного стану між кількома правилами в одному прогоні (наприклад, `walkCache` — кеш обходу файлової системи, щоб не сканувати дерево повторно). Якщо не передано — раннер створить дефолтний контекст усередині.
- **Повертає:** `Promise<number>` — exit-код правила:
  - `0` — правило пройшло (порушень нема).
  - `1` — є щонайменше одне порушення.
- **Side effects:**
  - Читання файлів проєкту (через `walkCache` усередині `runStandardRule`).
  - Можливе записування виправлень у файли проєкту (якщо правило має fix-логіку у фазі `js`/`policy`).
  - Друк діагностичних повідомлень у stdout/stderr через раннер.
  - НЕ викликає `process.exit` — це задача CLI-обгортки.
- **Реалізація:** делегує виклик до `runStandardRule(import.meta.dirname, ctx)`, передаючи абсолютний шлях до директорії правила (`npm/rules/capacitor/`), щоб раннер міг автоматично знайти підкаталоги `js/`, `policy/`, файл `capacitor.mdc` та `meta.json`.

### Top-level CLI-блок

```
if (isRunAsCli(import.meta.url)) {
  process.exit(await runRuleCli(import.meta.dirname))
}
```

- **Призначення:** якщо файл запущено напряму через `bun` / `node` (а не імпортовано з іншого модуля), піднімає повну CLI-обв'язку.
- **Як визначається CLI-запуск:** утиліта `isRunAsCli(import.meta.url)` зіставляє URL поточного модуля з `process.argv[1]` (стандартна ідіома для ESM).
- **Що робить `runRuleCli`:** завантажує конфіг проєкту (whitelist/ignore-list), запускає правило (той самий пайплайн, що й `run`), формує summary та повертає exit-код.
- **`process.exit(await ...)`** — обов'язковий для CLI/CI/IDE інтеграції, щоб батьківський процес отримав коректний код виходу. Лінт-правила `n/no-process-exit` та `unicorn/no-process-exit` свідомо відключені одним коментарем — це задокументовано як винятковий standalone entry-point.

## Залежності

Файл імпортує дві внутрішні утиліти-раннера:

| Шлях | Що береться | Роль |
|------|-------------|-----|
| `../../scripts/lib/run-rule-cli.mjs` | `isRunAsCli`, `runRuleCli` | Детектор CLI-режиму та повна CLI-обв'язка (config, whitelist, summary, exit-code). |
| `../../scripts/lib/run-standard-rule.mjs` | `runStandardRule` (+ тип `RuleContext` у JSDoc) | Уніфікований пайплайн правила: `applies → JS-concerns → policy → mdc-refs`. |

Зовнішніх npm-залежностей немає. Файл використовує лише стандартні ESM-можливості: `import.meta.url`, `import.meta.dirname`.

Сусідні артефакти правила, на які спирається `runStandardRule` через `import.meta.dirname`:

- `npm/rules/capacitor/capacitor.mdc` — людинозрозумілий опис правила (для фази `mdc-refs`).
- `npm/rules/capacitor/meta.json` — метадані правила (id, applies-маркери, версія тощо).
- `npm/rules/capacitor/js/` — підкаталог з JS/TS-перевірками (`check-*.mjs`, fix-логіка).
- `npm/rules/capacitor/policy/` — підкаталог з policy-файлами правила.

## Потік виконання / Використання

### Сценарій 1. Library-виклик (з оркестратора)

```js
import { run } from '@nitra/cursor/rules/capacitor/fix.mjs'

const exitCode = await run({ walkCache })
// exitCode: 0 → OK, 1 → порушення
```

Потік:

1. Оркестратор імпортує `run` (CLI-блок НЕ виконується, бо `isRunAsCli` повертає `false`).
2. Викликає `run(ctx)` зі спільним контекстом.
3. Усередині `runStandardRule(dirname, ctx)` поетапно виконує `applies → JS-concerns → policy → mdc-refs`.
4. Повертає `Promise<number>` — оркестратор сам вирішує, що робити з кодом (агрегувати, друкувати, тощо).

### Сценарій 2. Standalone-виклик (CLI/CI/IDE)

```bash
bun npm/rules/capacitor/fix.mjs
# або еквівалент
npx @nitra/cursor fix capacitor
```

Потік:

1. Bun/Node стартує модуль як entry-point.
2. `isRunAsCli(import.meta.url)` повертає `true`.
3. Виконується `await runRuleCli(import.meta.dirname)`:
   - завантажується конфіг проєкту;
   - застосовується whitelist/ignore;
   - запускається той самий пайплайн правила;
   - друкується summary;
   - повертається числовий exit-code.
4. `process.exit(<code>)` завершує процес із цим кодом для CI/IDE.

### Інваріанти

- **Один файл — дві ролі:** library (`run`) і standalone (top-level CLI-блок). Жоден інший правило-специфічний код у файлі не з'являється — все має йти в `js/`, `policy/`, або в `capacitor.mdc`.
- **`process.exit` лише в standalone-гілці.** Library-режим повертає число, не вбиває процес.
- **Контракт ідентичний для всіх правил:** будь-яке інше правило `@nitra/cursor` має такий самий `fix.mjs` (тонкий wrapper над `runStandardRule` + `runRuleCli`) — це домовленість архітектури правил.
