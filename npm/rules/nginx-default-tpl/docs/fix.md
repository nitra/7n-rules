---
docgen:
  source: npm/rules/nginx-default-tpl/fix.mjs
  crc: 12fc1644
---

# `fix.mjs` — точка входу правила `nginx-default-tpl`

## Огляд

Модуль `npm/rules/nginx-default-tpl/fix.mjs` є **точкою входу** (entry-point) для правила `nginx-default-tpl` у CLI-інструменті `@nitra/cursor`. Файл реалізує патерн «двох ролей» (dual-role module) для одного rule-файлу:

1. **Library mode** — експортує функцію `run(ctx)`, яку викликає зовнішня orchestration-логіка (наприклад, batch-прогін усіх правил через `n-cursor fix`).
2. **Standalone mode** — якщо файл запущено напряму через `bun rules/nginx-default-tpl/fix.mjs`, то відпрацьовує повний CLI-цикл (завантаження конфігурації, whitelist, summary) і завершує процес з відповідним exit-кодом для CI/IDE.

Сам файл **не містить специфічної логіки правила** — він є тонкою обгорткою (thin wrapper) над `runStandardRule`, яка делегує виконання стандартному пайплайну: `applies → JS-concerns → policy → mdc-refs`. Конкретна перевірена/виправлювана поведінка правила `nginx-default-tpl` описана в сусідніх артефактах теки (`check-*.mjs`, `.mdc`, конфіги), а цей файл забезпечує лише уніфікований інтерфейс запуску.

## Експорти / API

| Експорт | Тип                               | Призначення                                                                                   |
| ------- | --------------------------------- | --------------------------------------------------------------------------------------------- |
| `run`   | `function(ctx?): Promise<number>` | Library-API: виконує стандартний пайплайн правила; повертає exit-код (0 — OK, 1 — порушення). |

Файл також має **side-effect top-level await** на рівні модуля: при запуску як CLI він викликає `process.exit(await runRuleCli(...))`. Жодних інших іменованих експортів, default-експорту чи реекспортів немає.

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

- **Сигнатура:** `run(ctx?: RuleContext): Promise<number>`
- **Параметри:**
  - `ctx` _(необов’язковий)_ — об’єкт контексту прогону типу `RuleContext` з `../../scripts/lib/run-standard-rule.mjs`. Зазвичай містить кеші (наприклад, `walkCache` — спільний результат обходу файлової системи між кількома правилами), щоб не повторювати дорогі операції під час batch-прогону. Якщо `ctx` не передано — `runStandardRule` створює власне ізольоване оточення.
- **Повертає:** `Promise<number>`
  - `0` — правило не знайшло порушень (або всі порушення були автоматично виправлені).
  - `1` — правило знайшло порушення, які потрібно ескалувати у CI / IDE.
- **Side effects:**
  - Запускає стандартний пайплайн `runStandardRule`, який залежно від реалізації може **читати файли** проєкту, **писати fix-патчі**, **друкувати summary** у stdout/stderr.
  - Сам по собі `run` процес **не завершує** (`process.exit` викликається лише в standalone-гілці нижче).
- **Як обчислюється цільова тека:** перший аргумент `import.meta.dirname` — це абсолютний шлях до теки правила (`.../npm/rules/nginx-default-tpl/`). `runStandardRule` за цим шляхом резолвить supporting-артефакти: `meta.json`, `check-*.mjs`, MDC-документ, applies-конфіг тощо. Тому **категорично не можна** замінювати `import.meta.dirname` на CWD або жорстко закодований шлях — це зламає інкапсуляцію правила в монорепо.

### Top-level CLI-блок (не функція, а імперативний side-effect)

```js
if (isRunAsCli(import.meta.url)) {
  process.exit(await runRuleCli(import.meta.dirname))
}
```

- **Умова `isRunAsCli(import.meta.url)`** — детектор того, чи модуль є entry-point (`node fix.mjs` / `bun fix.mjs`), а не імпорт-залежністю. Реалізація утиліти стандартизована в `scripts/lib/run-rule-cli.mjs` (зазвичай порівнює `import.meta.url` з `process.argv[1]`).
- **`runRuleCli(import.meta.dirname)`** виконує **повний CLI-еквівалент** команди `npx @nitra/cursor fix nginx-default-tpl`:
  - завантаження конфігурації проєкту,
  - застосування whitelist / overrides,
  - друк summary-репорта.
- **`process.exit(...)`** з результатом `runRuleCli` (number) повертає **exit-code в shell**, щоб CI/IDE могли інтерпретувати «червоний» / «зелений» прогін. Лінт-директиви `n/no-process-exit` і `unicorn/no-process-exit` свідомо вимкнені рядковим коментарем — це задокументоване виключення для **standalone entry-point**, де exit-code є частиною контракту.
- **Top-level `await`** дозволений у ESM-модулях (`.mjs`) і використовується для уникнення обгортки `(async () => { … })()`.

## Залежності

### Внутрішні (relative imports)

| Імпорт            | Із                                        | Що використовується                                                                            |
| ----------------- | ----------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `isRunAsCli`      | `../../scripts/lib/run-rule-cli.mjs`      | Детектор entry-point — повертає `true`, якщо поточний модуль викликаний напряму CLI-рантаймом. |
| `runRuleCli`      | `../../scripts/lib/run-rule-cli.mjs`      | Standalone-orchestration: повний CLI-цикл одного правила (config + whitelist + summary).       |
| `runStandardRule` | `../../scripts/lib/run-standard-rule.mjs` | Library-pipeline правила: `applies → JS-concerns → policy → mdc-refs`.                         |

Шляхи відносні до `npm/rules/nginx-default-tpl/`; `../../scripts/lib/` резолвиться у `npm/scripts/lib/`.

### Зовнішні / runtime

- **Bun / Node.js ESM** — для `import.meta.dirname` потрібен рантайм з підтримкою `import.meta.dirname` (Node ≥ 20.11 або сучасний Bun). На старіших Node цей геттер повертає `undefined`, що зламає резолв шляхів.
- **`process.exit`** — глобал Node/Bun рантайму; використовується лише у CLI-гілці.

### Типи (JSDoc)

`@param {import('../../scripts/lib/run-standard-rule.mjs').RuleContext}` — тип контексту імпортується через JSDoc-тип-імпорт із того ж модуля `runStandardRule`. Це **не runtime-залежність** — лише підказка для TS/IDE.

## Потік виконання / Використання

### Сценарій 1 — Library mode (batch run)

```js
// Викликається з npm/scripts/run-all-rules.mjs або інших orchestrators
import { run } from '@nitra/cursor/rules/nginx-default-tpl/fix.mjs'

const exitCode = await run({ walkCache })
if (exitCode !== 0) violatedRules.push('nginx-default-tpl')
```

- Orchestrator передає спільний `walkCache` (чи інший контекст), щоб уникнути повторного обходу файлової системи між правилами.
- `run` повертає число — orchestrator сам вирішує, чи робити `process.exit` і коли.

### Сценарій 2 — Standalone (debug / IDE / CI per-rule)

```bash
bun npm/rules/nginx-default-tpl/fix.mjs
# еквівалент:
npx @nitra/cursor fix nginx-default-tpl
```

- Bun завантажує файл, бачить `isRunAsCli(...) === true`, входить у CLI-гілку.
- `runRuleCli` сам викликає **той самий** `runStandardRule` під капотом (через `run`-експорт або прямо), але додає завантаження конфігу й whitelist-фільтри.
- Процес завершується з відповідним exit-кодом — `0` для CI «зелений», `1` для «червоний».

### Логічна послідовність всередині `runStandardRule`

Згідно з JSDoc-коментарем у `run`, стандартний пайплайн послідовно виконує чотири фази:

1. **`applies`** — визначення множини файлів, до яких застосовне правило (за glob-патернами з конфігу правила).
2. **`JS-concerns`** — JS/TS-специфічні перевірки (синтаксис, AST, imports), якщо релевантно для правила.
3. **`policy`** — застосування policy-логіки правила (для `nginx-default-tpl` — перевірка/виправлення дефолт-шаблону nginx-конфігурації).
4. **`mdc-refs`** — крос-валідація з `.mdc`-документом правила (наявність refs, узгодженість прикладів тощо).

Деталі та точна семантика фаз залежать від реалізації `runStandardRule` й артефактів самого правила (`check-*.mjs`, `mdc`-файл).

### Контракти й нюанси

- **Ідемпотентність:** не гарантована на рівні цього wrapper-а — залежить від `runStandardRule`. Зазвичай fix-режим записує патчі на диск і повторний виклик уже повертає `0`.
- **Concurrency:** глобальне правило монорепо забороняє паралельний запуск кількох правил/лінтерів одночасно (див. CLAUDE.md «Лінт і ESLint (без паралельних запусків)»). У library-режимі orchestrator повинен серіалізувати виклики.
- **Захищеність від помилок:** wrapper не має власних `try/catch` — будь-який throw з `runStandardRule` чи `runRuleCli` поширюється нагору. У standalone-режимі неперехоплений throw призведе до ненульового exit-коду рантайму (без явного `process.exit(1)`).

## Rebuild Test

Документ описує **public-контракт** файлу (експорт `run`, його сигнатуру/повернення/побічні ефекти, CLI-гілку з `process.exit`, відносні залежності й послідовність фаз `applies → JS-concerns → policy → mdc-refs`). Цього достатньо для відновлення семантично-еквівалентного wrapper-файлу: створити `.mjs` модуль з ESM-імпортами трьох утиліт, експортувати `run(ctx)`, який повертає `runStandardRule(import.meta.dirname, ctx)`, і додати CLI-блок з `isRunAsCli` + `process.exit(await runRuleCli(import.meta.dirname))`. Сама бізнес-логіка правила `nginx-default-tpl` тут не міститься — вона делегована стандартному пайплайну й артефактам теки.
