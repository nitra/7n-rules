# `fix.mjs` — entry-point правила `efes`

## Огляд

Файл `npm/rules/efes/fix.mjs` — це **уніфікований entry-point** одного з правил пакету `@nitra/cursor` (правило `efes`, директорія `npm/rules/efes/`). Він виконує дві ролі одночасно:

1. **Library mode** — експортує функцію `run(ctx)`, яку викликає CLI-оркестратор `@nitra/cursor` (через динамічний `import` модуля та виклик `run()` із підготовленим контекстом).
2. **Standalone mode** — якщо файл запущено напряму (наприклад, `bun npm/rules/efes/fix.mjs`), він виконує повний CLI-цикл правила (завантаження конфігу, whitelist, summary), еквівалентний `npx @nitra/cursor fix efes`, і завершує процес із відповідним exit-кодом для CI/IDE.

Сам файл навмисно мінімальний — уся реальна логіка (виконання `applies → JS-concerns → policy → mdc-refs`) делегована у спільну бібліотечну функцію `runStandardRule`, що живе у `npm/scripts/lib/run-standard-rule.mjs`. Тому цей файл слугує лише **тонкою обгорткою (shim)** для одного конкретного правила `efes`, прив’язуючись до власної директорії через `import.meta.dirname`.

Така архітектура — стандартна для всіх правил із сімейства `npm/rules/<id>/fix.mjs`: одне правило = одна директорія = один однаковий `fix.mjs`, який відрізняється від сусідів лише розміщенням (`import.meta.dirname` бере шлях до **цієї** директорії правила).

## Експорти / API

| Експорт | Тип                                      | Призначення                                                                                                                     |
| ------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `run`   | `(ctx?: RuleContext) => Promise<number>` | Library API — викликається CLI-оркестратором `@nitra/cursor` для запуску правила в межах одного спільного прогону над монорепо. |

Інших іменованих або дефолтних експортів файл не має. Окрім експорту, файл містить **side-effect блок** (top-level `if (isRunAsCli(...))`), що активується тільки коли файл запущено напряму.

### Сигнатура `run`

```js
export function run(ctx)
```

- **Параметри**:
  - `ctx` _(optional)_ — об’єкт типу `RuleContext`, імпортований із `npm/scripts/lib/run-standard-rule.mjs`. Містить розділяємий між правилами стан прогону: зокрема `walkCache` (кеш обходу файлів монорепо), а також іншу контекстну інформацію, передану CLI-оркестратором. Якщо `ctx` не передано (наприклад, при ad-hoc виклику), `runStandardRule` створює власний внутрішній контекст.
- **Повертає**: `Promise<number>` —
  - `0` — правило не знайшло порушень (OK);
  - `1` — є щонайменше одне порушення (fail).
- **Сторонні ефекти**:
  - Сам `run` нічого не пише в `stdout`/`stderr` напряму, проте делегована функція `runStandardRule` веде логування прогресу, виводить summary порушень і — за потреби — модифікує файли проєкту (`autofix`).
  - Може читати файлову систему монорепо (через walk), читати конфіг `@nitra/cursor` та `meta.json` правила.
  - Не викликає `process.exit` у library mode — exit-код доручений викликаючій стороні.

## Функції

### `run(ctx)`

#### Сигнатура

```js
/**
 * Запускає правило: applies → JS-concerns → policy → mdc-refs (через runStandardRule).
 * Library mode: викликається CLI orchestration через `import + run(ctx)`.
 * @param {import('../../scripts/lib/run-standard-rule.mjs').RuleContext} [ctx] контекст прогону (walkCache тощо)
 * @returns {Promise<number>} 0 — OK, 1 — порушення
 */
export function run(ctx) {
  return runStandardRule(import.meta.dirname, ctx)
}
```

#### Параметри

| Ім’я  | Тип                                          | Обов’язковий | Опис                                                                                                                                                                                                                             |
| ----- | -------------------------------------------- | ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ctx` | `RuleContext` (див. `run-standard-rule.mjs`) | ні           | Спільний контекст прогону, який оркестратор `@nitra/cursor` створює один раз для всієї пачки правил. Дозволяє ділити дорогий стан (наприклад, `walkCache` — список відсканованих файлів) між правилами без повторного обходу ФС. |

#### Повертає

`Promise<number>` — `0` або `1`. Семантика — звичайна для UNIX exit codes:

- `0` — все добре, правило `efes` не зафіксувало порушень.
- `1` — правило знайшло хоча б одне порушення (CI має впасти).

#### Логіка

Функція складається з єдиного рядка — `return runStandardRule(import.meta.dirname, ctx)`. Тобто:

1. Беремо абсолютний шлях директорії, у якій лежить **цей** `fix.mjs` (`import.meta.dirname` дає `.../npm/rules/efes`).
2. Передаємо цей шлях як перший аргумент у `runStandardRule` — щоб бібліотечна функція знала, **яке саме правило** запускає (звідки читати `meta.json`, `efes.mdc`, `policy/*` тощо).
3. Передаємо отриманий `ctx` (або `undefined`).
4. Повертаємо отриману `Promise<number>` — без обгортки, без додаткової обробки.

#### Сторонні ефекти

Усі побічні ефекти зосереджені всередині `runStandardRule` (читання файлів, walk, виконання checks, можливі autofix-записи). Сам `run` лише проксує виклик.

### Top-level CLI-блок (без імені, не функція)

```js
if (isRunAsCli(import.meta.url)) {
  // eslint-disable-next-line n/no-process-exit -- standalone entry-point має повертати exit-code для CI/IDE
  process.exit(await runRuleCli(import.meta.dirname))
}
```

#### Поведінка

- Виконується **тільки** коли модуль запущено як CLI-точку входу (`bun npm/rules/efes/fix.mjs` або `node ...`). Перевірка `isRunAsCli(import.meta.url)` порівнює URL модуля з `process.argv[1]` (стандартна ідіома для ESM).
- Якщо умова виконалась — асинхронно (через `await` на top-level, що дозволяє ESM) викликає `runRuleCli(import.meta.dirname)`, який реалізує **повний CLI-цикл**:
  - завантаження конфігу `@nitra/cursor`;
  - застосування whitelist/ignore;
  - запуск самого правила (через ту саму `runStandardRule` або еквівалентний механізм);
  - друк summary;
  - повернення exit-коду.
- Завершує процес через `process.exit(...)` із отриманим кодом (0 або 1).

#### Чому є коментар `eslint-disable-next-line`

У проєкті заборонено `process.exit` (`n/no-process-exit`, `unicorn/no-process-exit`) — але standalone entry-point **повинен** повертати exit-код, інакше CI не зрозуміє результат. Виключення оформлене явним коментарем із поясненням («standalone entry-point має повертати exit-code для CI/IDE»), щоб лінт не падав.

#### Чому є подвійний кінець рядка / два правила в одному disable

Бо обидва правила (`n/no-process-exit` від `eslint-plugin-n` і `unicorn/no-process-exit` від `eslint-plugin-unicorn`) забороняють те саме незалежно — disable має покривати обидва.

## Залежності

### Внутрішні (з того ж монорепо)

| Шлях                                      | Що імпортується                                    | Призначення                                                                                                                                       |
| ----------------------------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `../../scripts/lib/run-rule-cli.mjs`      | `isRunAsCli`, `runRuleCli`                         | `isRunAsCli` — детектор «модуль виконано напряму». `runRuleCli` — повний CLI-обгортка для standalone-режиму (config loading, whitelist, summary). |
| `../../scripts/lib/run-standard-rule.mjs` | `runStandardRule`, тип `RuleContext` (через JSDoc) | Бібліотечна реалізація стандартного потоку правила: `applies → JS-concerns → policy → mdc-refs`.                                                  |

Шляхи з `../../` ведуть на `npm/scripts/lib/` (бо файл лежить у `npm/rules/efes/`).

### Зовнішні

Жодних `npm`-залежностей файл не імпортує напряму — усі вони транзитивно підвантажуються через `runStandardRule` / `runRuleCli`.

### Файли поруч (через `import.meta.dirname`)

Бібліотечні функції очікують у директорії правила (`npm/rules/efes/`) певні файли — їх імпортує не `fix.mjs` напряму, а саме `runStandardRule`/`runRuleCli`:

- `meta.json` — метадані правила (id, applies, policy hints, тощо);
- `efes.mdc` — людиночитаний опис правила (Markdown + frontmatter);
- `policy/` — директорія з policy-чеками правила.

## Потік виконання / Використання

### Сценарій A — виклик з CLI `@nitra/cursor` (library mode)

```text
$ npx @nitra/cursor fix
└─ CLI оркестратор будує список правил і прогонить кожне:
   └─ import('npm/rules/efes/fix.mjs')
      └─ run(ctx)
         └─ runStandardRule('.../npm/rules/efes', ctx)
            ├─ читає meta.json + efes.mdc
            ├─ застосовує applies-фільтри
            ├─ запускає JS-concerns (eslint-подібні чеки)
            ├─ запускає policy/* (специфічні чеки правила)
            └─ перевіряє mdc-refs (узгодженість документації)
         └─ повертає 0 / 1
      └─ оркестратор агрегує exit-коди всіх правил
```

У цьому сценарії **жодних виходів через `process.exit`** із цього файлу — exit-код повертає оркестратор уже наприкінці всього прогону.

### Сценарій B — прямий запуск файлу (standalone mode)

```text
$ bun npm/rules/efes/fix.mjs

1. ESM завантажує модуль.
2. На етапі імпорту виконуються top-level statements.
3. `isRunAsCli(import.meta.url)` -> true.
4. `await runRuleCli(import.meta.dirname)`:
   - повністю емулює `npx @nitra/cursor fix efes`;
   - завантажує конфіг проєкту, whitelist;
   - запускає правило;
   - виводить summary в stdout/stderr.
5. `process.exit(<code>)` — повертає exit-код shell-у / CI / IDE.
```

Це зручно для:

- швидкого ad-hoc запуску однієї конкретної перевірки під час дебагу правила;
- інтеграції в IDE-таски (наприклад, окремі run configurations VSCode/JetBrains);
- ізольованого прогону в pre-commit hook на одне правило.

### Сценарій C — імпорт із тестів

```js
import { run } from 'npm/rules/efes/fix.mjs'

const code = await run() // 0 або 1
```

CLI-блок **не запускається** (бо файл не є entry-point процесу), а `run` доступний як звичайна функція. Це дає змогу писати unit/e2e-тести правила без spawn-у дочірнього процесу.

### Інваріанти / нюанси

- `import.meta.dirname` доступний у Node ≥ 20.11 та Bun. Якщо середовище старіше — потрібен fallback через `path.dirname(fileURLToPath(import.meta.url))`. У монорепо `@nitra/cursor` офіційно підтримується Bun-середовище, тому це не проблема.
- Top-level `await` працює тільки в ESM (`.mjs`) — саме тому файл має розширення `.mjs`, а не `.js`.
- Дві ролі файлу (library + standalone) — це усвідомлений патерн «dual entry-point»: ESM-import не запускає CLI-блок, бо `isRunAsCli` повертає `false`.
- Файл навмисно ідентичний по структурі з усіма іншими `npm/rules/<id>/fix.mjs`. Уся специфіка правила `efes` живе в сусідніх файлах (`meta.json`, `efes.mdc`, `policy/`) — у самому `fix.mjs` нічого правило-специфічного немає, окрім розташування.

## Rebuild Test

Уявно «перебудувавши» файл лише за цією документацією, маємо отримати:

- ESM-модуль `.mjs` із двома імпортами зі спільної бібліотеки `npm/scripts/lib/`:
  - `{ isRunAsCli, runRuleCli }` із `../../scripts/lib/run-rule-cli.mjs`;
  - `{ runStandardRule }` із `../../scripts/lib/run-standard-rule.mjs`.
- Один іменований експорт `run(ctx)` із JSDoc, що описує параметр `ctx` як `RuleContext` (тип взято через `import('...')` JSDoc-нотацію) і повертає `Promise<number>` (`0` — OK, `1` — порушення). Тіло — один рядок `return runStandardRule(import.meta.dirname, ctx)`.
- Top-level guard `if (isRunAsCli(import.meta.url)) { process.exit(await runRuleCli(import.meta.dirname)) }` із коментарем-disable для двох ESLint-правил (`n/no-process-exit`, `unicorn/no-process-exit`) і поясненням «standalone entry-point має повертати exit-code для CI/IDE».
- Жодних інших declarations, експортів чи побічних ефектів.

Такий «реконструйований» файл функціонально й текстово збігається з оригіналом `npm/rules/efes/fix.mjs`.
