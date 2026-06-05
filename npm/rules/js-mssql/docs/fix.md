# `npm/rules/js-mssql/fix.mjs`

## Огляд

Цей файл — точка входу правила `js-mssql` у бібліотеці правил пакета `@nitra/cursor`. Він має **дві ролі одночасно**:

1. **Library mode** — експортує функцію `run(ctx)`, яку CLI-оркестратор (`bun n-cursor fix` / `bun n-cursor check`) імпортує разом з іншими правилами й послідовно викликає для одного спільного проходу по робочому дереву (з кешем `walkCache` тощо).
2. **Standalone mode** — якщо файл запущено напряму (`bun rules/js-mssql/fix.mjs`), він самотужки виконує повний CLI-цикл правила (завантаження конфігу, whitelist, summary) — еквівалент `npx @nitra/cursor fix js-mssql`.

Сама логіка перевірки/виправлення у файлі **не реалізується** — це лише тонкий «launcher», який делегує роботу у спільний оркестратор `runStandardRule`. Завдяки цьому всі правила-«standard» (applies → JS-concerns → policy → mdc-refs) мають єдиний, передбачуваний і кешований pipeline.

Каталог правила `npm/rules/js-mssql/` містить:

- `fix.mjs` — цей файл (entry-point).
- `js-mssql.mdc` — людиночитна специфікація правила.
- `meta.json` — мета-інформація правила (id, version, тощо).
- `js/` — JS-concerns: фіксери/чекери, що працюють на рівні окремих JS/MJS/TS-файлів.
- `policy/` — policy-перевірки на рівні всього проєкту (зріз даних, агреговані інваріанти).
- `lib/` — допоміжні модулі правила.

## Експорти / API

| Експорт | Тип                                  | Призначення                                                                                                               |
| ------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| `run`   | `function (ctx?) => Promise<number>` | Library-режим: одинична точка входу для зовнішнього оркестратора. Повертає exit-code правила (`0` — OK, `1` — порушення). |

Окрім експорту, файл має **top-level side-effect** під CLI-режимом — див. секцію «Потік виконання».

### `run(ctx)`

```js
export function run(ctx) {
  return runStandardRule(import.meta.dirname, ctx)
}
```

- **Сигнатура:** `run(ctx?: RuleContext): Promise<number>`
- **Параметри:**
  - `ctx` _(optional)_ — об’єкт контексту прогону, який передає CLI-оркестратор. Тип імпортується JSDoc-посиланням з `../../scripts/lib/run-standard-rule.mjs` (`RuleContext`). Зазвичай несе спільні кешовані ресурси між правилами (наприклад, `walkCache` — кеш обходу файлів), щоб не повторювати дорогі IO-операції для кожного правила окремо.
- **Повертає:** `Promise<number>` — exit-code:
  - `0` — порушень не знайдено;
  - `1` — є порушення (правило фейлиться).
- **Side effects:** залежать від `runStandardRule`: читання файлів проєкту, потенційні автофікси на диску (якщо правило підтримує fix-mode), запис у summary-репорти, оновлення кешів у `ctx`.
- **Як визначається «корінь правила»:** через `import.meta.dirname` — повний шлях до директорії, де лежить цей `fix.mjs` (тобто `…/npm/rules/js-mssql/`). Саме цей шлях `runStandardRule` використовує, щоб знайти суміжні підтеки `js/`, `policy/`, файл `js-mssql.mdc` та `meta.json`.

## Функції

### `run(ctx)` — див. вище

Єдина функція, оголошена в цьому файлі. Жодних інших публічних чи приватних функцій модуль не містить — уся доменна логіка винесена у бібліотеку `scripts/lib/`.

## Залежності

### Внутрішні (відносні імпорти)

- `../../scripts/lib/run-rule-cli.mjs`
  - `isRunAsCli(importMetaUrl): boolean` — детектує, чи запущено модуль як CLI-ентрі (а не імпортовано як бібліотеку). Порівнює `import.meta.url` поточного модуля з `process.argv[1]` (URL viewpoint).
  - `runRuleCli(ruleDir): Promise<number>` — повний standalone-цикл одного правила: config-loading, whitelist, summary, повернення exit-коду.
- `../../scripts/lib/run-standard-rule.mjs`
  - `runStandardRule(ruleDir, ctx?): Promise<number>` — узагальнений «standard» pipeline правила: `applies → JS-concerns → policy → mdc-refs`. Використовує `ctx` (наприклад, спільний `walkCache`), коли його передає зовнішній оркестратор.
  - Експортує JSDoc-тип `RuleContext`, на який посилається анотація `run`.

### Зовнішні (npm)

Прямих імпортів з npm у цьому файлі **немає**. Усі зовнішні залежності інкапсульовані в `scripts/lib/*`.

### Платформенні / runtime

- **Bun ≥ 1.x** (або Node.js з підтримкою `import.meta.dirname`) — використовується `import.meta.dirname` та `import.meta.url`.
- **ESM** — файл написано як ES-модуль (`.mjs`), використовується `export` + top-level `await`.
- `process.exit` — глобал Node/Bun, явно лінт-проігноровано для CLI-сценарію.

## Потік виконання / Використання

### Library mode (типовий шлях у CI/IDE)

1. CLI `bun n-cursor fix` (або `check`) сканує `npm/rules/*/fix.mjs`.
2. Для кожного правила робить `import('…/fix.mjs')` і викликає `mod.run(ctx)` з підготовленим спільним контекстом.
3. Для `js-mssql`: `run(ctx)` робить **один-рядковий** делегат у `runStandardRule(import.meta.dirname, ctx)`.
4. `runStandardRule` усередині:
   1. Читає `meta.json` і `*.mdc` поруч із `fix.mjs`.
   2. Етап **applies** — визначає, чи правило взагалі застосовне до поточного дерева.
   3. Етап **JS-concerns** — викликає всі чекери/фіксери з `./js/`.
   4. Етап **policy** — викликає policy-перевірки з `./policy/` (агреговані інваріанти проєкту).
   5. Етап **mdc-refs** — звіряє наявні зв’язки/посилання у `.mdc`-документі.
5. Повертає `0` / `1`, оркестратор зводить це у спільний звіт.

### Standalone mode (точкова перевірка людиною)

1. Розробник запускає файл напряму, наприклад:
   ```bash
   bun npm/rules/js-mssql/fix.mjs
   ```
2. Перевірка `isRunAsCli(import.meta.url)` повертає `true`.
3. Виконується top-level `await runRuleCli(import.meta.dirname)`:
   - Завантажує конфіг проєкту.
   - Застосовує whitelist (які файли/директорії перевіряти).
   - Викликає той самий стандартний pipeline (під капотом — `runStandardRule`).
   - Друкує людиночитний summary.
4. Результат передається в `process.exit(...)` — потрібний для IDE-інтеграції та CI-pipeline’ів, щоб non-zero exit-code сигналізував про порушення.

### Чому окремо `run` і CLI-блок

Розділення на дві ролі дозволяє:

- **уникати дубльованого I/O** у бібліотечному режимі (один обхід дерева, кеш у `ctx`);
- **зберігати самодостатність** файлу для швидкого «прогнати правило одне, без всього іншого»;
- **тримати entry-point незмінним** для CLI-оркестратора — той знає лише, що у файлі є експорт `run`.

### Лінт-винятки

Рядок `process.exit(await runRuleCli(import.meta.dirname))` має директивну «глушилку»:

- `n/no-process-exit` (eslint-plugin-n) — за замовчуванням забороняє `process.exit`.
- `unicorn/no-process-exit` (eslint-plugin-unicorn) — аналогічно.

Обидва правила свідомо відключені **лише** для standalone entry-point: CLI/IDE очікують exit-код для рішення «зелено/червоно».

## Rebuild Test

З опису у цьому документі файл `fix.mjs` для правила `js-mssql` можна відтворити так:

1. Створити ES-модуль `.mjs`.
2. Імпортувати з `../../scripts/lib/run-rule-cli.mjs` дві іменовані функції: `isRunAsCli` та `runRuleCli`.
3. Імпортувати з `../../scripts/lib/run-standard-rule.mjs` функцію `runStandardRule`.
4. Оголосити іменований експорт `run(ctx)`, який повертає `runStandardRule(import.meta.dirname, ctx)`. JSDoc описує `ctx` як `RuleContext` (з того ж модуля) і повернення як `Promise<number>` (`0` — OK, `1` — порушення).
5. Після експорту перевірити `isRunAsCli(import.meta.url)`; якщо `true` — виконати `process.exit(await runRuleCli(import.meta.dirname))`, попередньо вимкнувши коментарем правила `n/no-process-exit` та `unicorn/no-process-exit` для цього рядка (зі стислою причиною: standalone entry-point потребує exit-коду для CI/IDE).
6. Не додавати жодних інших експортів і жодної доменної логіки — увесь pipeline `applies → JS-concerns → policy → mdc-refs` лишається в `runStandardRule`.
