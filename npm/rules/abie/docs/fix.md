# `npm/rules/abie/fix.mjs`

## Огляд

Файл `npm/rules/abie/fix.mjs` — це **entry-point правила `abie`** у системі правил `@nitra/cursor`. Він виконує дві ролі одночасно:

1. **Library mode** — експортує функцію `run(ctx)`, яку викликає вищерівнева CLI-оркестрація (`npx @nitra/cursor fix`) під час обходу всіх правил у monorepo.
2. **Standalone mode** — при прямому запуску (`bun npm/rules/abie/fix.mjs`) працює як самостійна CLI-команда, повний еквівалент `npx @nitra/cursor fix abie`, з власним load конфігу, whitelist-фільтрацією й summary-виводом.

Уся реальна логіка правила `abie` (послідовність фаз `applies → JS-concerns → policy → mdc-refs`) делегується у спільні helper-модулі `runStandardRule` та `runRuleCli`, що мешкають у `npm/scripts/lib/`. Сам `fix.mjs` тут — це **тонкий адаптер-shim**: декларує точку входу й передає директорію правила `import.meta.dirname` у стандартний раннер.

Файл написаний у форматі ESM (`.mjs`), з використанням `top-level await` (рядок 18) та `import.meta.dirname` / `import.meta.url` — отже потребує Node.js/Bun із підтримкою сучасних ESM-фіч.

## Експорти / API

Модуль `npm/rules/abie/fix.mjs` має **один named export**:

### `export function run(ctx)`

- **Сигнатура**: `function run(ctx?: RuleContext): Promise<number>`
- **Параметр `ctx`** (опціональний) — об'єкт `RuleContext`, тип якого визначений у `npm/scripts/lib/run-standard-rule.mjs`. Передає крізьрівневий контекст прогону: за коментарем у JSDoc — це включає `walkCache` (кеш обходу файлової системи, щоб уникнути повторного `fs.readdir` між правилами в одній CLI-сесії), а також інші поля, що декларуються в `run-standard-rule.mjs`.
- **Повертає**: `Promise<number>` — exit-code правила:
  - `0` — правило відпрацювало без порушень (OK).
  - `1` — виявлено порушення (правило-перевірка не пройшло; CI має фейлитись).
- **Поведінка**: викликає `runStandardRule(import.meta.dirname, ctx)`, де `import.meta.dirname` — абсолютний шлях до теки `npm/rules/abie/` (директорія, де лежить сам `fix.mjs`). Це той ідентифікатор правила, за яким `runStandardRule` шукає `applies.mjs`, `js/*`, `policy/*`, `*.mdc` й інші артефакти.

Інших експортів (default export, інші named) у файлі немає.

## Функції

Файл містить рівно одну власну функцію.

### `run(ctx)`

```js
export function run(ctx) {
  return runStandardRule(import.meta.dirname, ctx)
}
```

- Це **бібліотечна точка входу** правила `abie`.
- Не виконує жодної додаткової логіки — повністю прозоро прокидає виклик у `runStandardRule`.
- Перший аргумент `import.meta.dirname` — абсолютний шлях до теки правила (`.../npm/rules/abie/`). У ESM Node.js/Bun це властивість `import.meta`, яка повертає `dirname` поточного модуля.
- Другий аргумент `ctx` прокидається «as-is»: якщо викликач (CLI orchestration) дав контекст із `walkCache` — раннер скористається ним; якщо `ctx` undefined (наприклад при standalone-запуску) — раннер сам ініціалізує внутрішній стан.
- Повертає те, що повертає `runStandardRule` — `Promise<number>` із exit-code.

### Standalone-блок (анонімний top-level)

```js
if (isRunAsCli(import.meta.url)) {
  process.exit(await runRuleCli(import.meta.dirname))
}
```

- Не є окремою іменованою функцією, але це **другий повноцінний шлях виконання** модуля.
- `isRunAsCli(import.meta.url)` — helper з `run-rule-cli.mjs`, який перевіряє, чи модуль запущений як CLI-entry (порівнює `import.meta.url` з `process.argv[1]`/`pathToFileURL`), а не імпортований іншим модулем.
- При `true` викликає `runRuleCli(import.meta.dirname)` — повна CLI-обгортка: парсить аргументи, читає `.cursor/cursor.config.mjs`, застосовує whitelist/blacklist, друкує summary, повертає exit-code.
- `await` тут — **top-level await**: працює лише в ESM-модулях у Node ≥ 14.8 / Bun.
- `process.exit(...)` зупиняє процес із отриманим кодом. Два eslint-disable коментарі (`n/no-process-exit`, `unicorn/no-process-exit`) свідомо вимикають правила лінтера для цього випадку — standalone entry-point **повинен** повертати exit-code для CI/IDE-інтеграції.

## Залежності

### Імпорти (із зовнішнього коду)

Файл імпортує з двох модулів `npm/scripts/lib/`:

1. **`../../scripts/lib/run-rule-cli.mjs`** — звідси беруться:
   - `isRunAsCli(metaUrl)` — детекція standalone-режиму.
   - `runRuleCli(ruleDir)` — повна CLI-обгортка правила (config-loading + whitelist + summary), згідно з коментарем у коді.

2. **`../../scripts/lib/run-standard-rule.mjs`** — звідси беруться:
   - `runStandardRule(ruleDir, ctx)` — оркестратор стандартного правила, який послідовно проганяє фази **applies → JS-concerns → policy → mdc-refs**.
   - Тип `RuleContext` — використовується лише як JSDoc-аннотація через `import('../../scripts/lib/run-standard-rule.mjs').RuleContext`.

Жодних інших залежностей (ні node-стандартних, ні зовнішніх npm-пакетів) у файлі немає.

### Зворотні залежності (що використовує цей файл)

- **CLI `@nitra/cursor fix`** (та `@nitra/cursor fix abie`) — при обході всіх правил викликає `import('npm/rules/abie/fix.mjs').then(m => m.run(ctx))`.
- **Прямий запуск розробником/CI** — `bun npm/rules/abie/fix.mjs` (або `node ...`) активує standalone-блок.

### Артефакти правила `abie`, які раннер очікує знайти у `import.meta.dirname`

Згідно з JSDoc-коментарем рядка 5 («applies → JS-concerns → policy → mdc-refs»), у директорії `npm/rules/abie/` мають бути присутні:
- `applies.mjs` (або еквівалент) — функція-фільтр «чи правило стосується цього файлу».
- `js/` — JS-concerns (перевірки/фікси для JS-файлів).
- `policy/` — policy-перевірки (rego/декларативні правила).
- `abie.mdc` — markdown-карта з посиланнями (mdc-refs).
- `meta.json` — метадані правила.

Сам `fix.mjs` не читає ці артефакти безпосередньо — їх читає `runStandardRule`.

## Потік виконання / Використання

### Сценарій 1: Library mode (виклик із CLI orchestration)

1. Користувач запускає `npx @nitra/cursor fix` (або `npm run fix` у корені monorepo).
2. CLI-orchestrator обходить усі правила, серед них — `abie`.
3. Для правила `abie` orchestrator робить `await import('npm/rules/abie/fix.mjs')`.
4. Викликає `mod.run(ctx)`, де `ctx` містить, зокрема, `walkCache`.
5. Усередині `run(ctx)` управління одразу передається у `runStandardRule(import.meta.dirname, ctx)`.
6. `runStandardRule` послідовно виконує фази:
   - **applies** — визначає, які файли потрапляють під правило `abie`.
   - **JS-concerns** — застосовує JS-фікси/перевірки з `npm/rules/abie/js/`.
   - **policy** — прогон policy-перевірок із `npm/rules/abie/policy/`.
   - **mdc-refs** — валідує/оновлює посилання у `abie.mdc`.
7. Раннер повертає `0` (OK) або `1` (порушення). Цей код Promise-резолвиться з `run(ctx)` та повертається orchestrator-у.
8. Standalone-блок (рядок 14–19) **не виконується**, бо `isRunAsCli(import.meta.url)` повертає `false` (модуль імпортовано, а не запущено як головний).

### Сценарій 2: Standalone mode (прямий запуск)

1. Розробник або CI запускає `bun npm/rules/abie/fix.mjs` (або через `node`).
2. ESM-модуль завантажується; `export function run` декларується, але **не викликається**.
3. Виконується перевірка `if (isRunAsCli(import.meta.url))` — повертає `true`, бо модуль є головним.
4. Виконується `await runRuleCli(import.meta.dirname)`:
   - читає `.cursor/cursor.config.mjs` (config-loading);
   - застосовує whitelist/blacklist із конфігу;
   - усередині все одно делегує у `runStandardRule` (через свої внутрішні механізми) — отже фази **applies → JS-concerns → policy → mdc-refs** проганяються так само;
   - друкує summary в stdout (кількість перевірених файлів, виправлень, порушень).
5. Отриманий exit-code (`0` або `1`) передається у `process.exit(...)` — процес одразу завершується з цим кодом, що читається CI/IDE.

### Дві ролі одного файлу

Коментар у коді (рядок 16) явно фіксує задум: «Дві ролі `fix.mjs`: library (`run`) + standalone (`main`)». Це уніфікований патерн усіх правил у `npm/rules/<id>/fix.mjs` — кожне правило має одночасно бути імпортовним модулем і самостійним CLI-скриптом без дублювання логіки.

### Типові способи виклику

| Контекст | Команда | Який шлях у `fix.mjs` |
|---|---|---|
| Повний прогон усіх правил | `npx @nitra/cursor fix` | `run(ctx)` (library) |
| Прогон лише `abie` через CLI | `npx @nitra/cursor fix abie` | `run(ctx)` (library) |
| Локальна налагодка правила | `bun npm/rules/abie/fix.mjs` | standalone-блок |
| Програмний виклик із тестів | `import { run } from 'npm/rules/abie/fix.mjs'; await run()` | `run(ctx)` (library) |

### Контракт exit-code

- `0` — правило завершилось успішно, порушень немає; CI продовжує pipeline.
- `1` — є порушення (або помилка перевірки); CI має фейлити job.
- Цей контракт є наскрізним і однаковим для library-mode (через Promise) і standalone-mode (через `process.exit`).
