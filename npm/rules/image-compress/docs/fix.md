# fix.mjs — entry-point правила `image-compress`

## Огляд

Файл `npm/rules/image-compress/fix.mjs` — це уніфікована точка входу (entry-point) для правила `image-compress` із набору правил `@nitra/cursor`. Він виконує дві ролі одночасно:

1. **Library mode** — експортує функцію `run(ctx)`, яку викликає CLI-оркестратор `@nitra/cursor` (через динамічний `import` модуля та виклик `run(ctx)`) разом з іншими правилами в межах одного загального прогону (з конфіг-завантаженням, whitelist та підсумковим звітом).
2. **Standalone mode** — якщо файл запущено напряму через `bun rules/image-compress/fix.mjs` (тобто є точкою входу процесу), він самостійно піднімає повний CLI-оркестратор для цього єдиного правила і завершує процес кодом виходу, придатним для CI/IDE.

Уся логіка правила (виявлення `applies`, перевірка JS-concerns, policy, валідація mdc-refs) делегується у `runStandardRule` зі спільної бібліотеки `scripts/lib/run-standard-rule.mjs`. Тобто сам `fix.mjs` правила `image-compress` не містить власної бізнес-логіки — він лише прив’язує спільний “стандартний” пайплайн правил до конкретної директорії цього правила через `import.meta.dirname`.

Правило `image-compress` належить до родини стандартних правил `@nitra/cursor`, де кожне правило живе у власній теці `npm/rules/<id>/` і має однаковий каркас: `fix.mjs` (цей файл), `check-*.mjs` (детектори порушень), `*.mdc` (людинозрозумілий опис правила) та інші артефакти, які `runStandardRule` автоматично знаходить за домовленостями про шляхи.

## Експорти / API

Модуль має один іменований експорт.

### `run(ctx?) → Promise<number>`

Function, що повертає `Promise<number>` — exit-code прогону правила:

- `0` — правило відпрацювало без порушень (OK).
- `1` — знайдено порушення політики/перевірок правила.

Параметри:

- `ctx` (необов’язковий) — об’єкт `RuleContext` з `scripts/lib/run-standard-rule.mjs`. Використовується для спільного стану між правилами в межах одного прогону, зокрема для кешу обходу файлової системи (`walkCache`) та інших оркестраційних метаданих. Якщо не передано — `runStandardRule` сам ініціалізує внутрішній контекст.

Призначення: викликається CLI-оркестратором `@nitra/cursor` як library API. Зовнішній код виконує `import { run } from '<абсолютний шлях>/npm/rules/image-compress/fix.mjs'` і потім `await run(ctx)`. Це дозволяє запускати багато правил в одному процесі з єдиним конфіг-завантаженням і єдиним звітом.

Модуль не має `export default`, не експортує жодних інших символів, констант чи типів.

## Функції

### `run(ctx)`

**Сигнатура:**

```js
export function run(ctx)
```

**JSDoc-тип (як у вихідному файлі):**

- `@param {import('../../scripts/lib/run-standard-rule.mjs').RuleContext} [ctx]` — контекст прогону (наприклад, `walkCache`); параметр опціональний.
- `@returns {Promise<number>}` — `0` означає OK, `1` — порушення.

**Параметри:**

- `ctx?: RuleContext` — необов’язковий контекст із зовнішнього оркестратора; пробрасується далі без модифікації.

**Що робить:**

1. Звертається до `import.meta.dirname` — це абсолютний шлях до директорії, у якій лежить сам `fix.mjs` (тобто до `npm/rules/image-compress/`).
2. Викликає `runStandardRule(import.meta.dirname, ctx)` — стандартну реалізацію пайплайну правила: applies → JS-concerns → policy → mdc-refs.
3. Повертає `Promise<number>`, який вирішить exit-code від `runStandardRule`.

**Повертає:** `Promise<number>` — exit-code пайплайна (`0` або `1`).

**Side effects:** прямих сайд-ефектів у самій функції немає; усі сайд-ефекти (читання файлів проєкту, виведення в `stdout`/`stderr`, формування підсумків звіту тощо) інкапсульовані всередині `runStandardRule`. Сама `run` лише делегує виклик.

### Standalone-блок (не функція, а top-level код)

**Сигнатура:**

```js
if (isRunAsCli(import.meta.url)) {
  process.exit(await runRuleCli(import.meta.dirname))
}
```

**Що робить:**

1. `isRunAsCli(import.meta.url)` повертає `true`, якщо поточний модуль завантажено як точку входу процесу (а не як імпортовану бібліотеку). Це стандартний для Node/Bun спосіб розпізнати, що файл стартував напряму.
2. Якщо так — викликає `runRuleCli(import.meta.dirname)`, який реалізує повний CLI-оркестратор саме для цього правила: завантаження конфігу, обчислення whitelist, виконання правила, друк підсумків. Він повертає `Promise<number>` — exit-code.
3. `await` чекає виконання promise. Це — top-level `await`, що дозволено в ES-модулях.
4. `process.exit(<code>)` передає отриманий exit-code операційній системі / CI / IDE. ESLint-правила `n/no-process-exit` і `unicorn/no-process-exit` тут свідомо вимкнено коментарем, оскільки standalone entry-point правомірно завершує процес явним кодом.

**Параметри / повертає:** немає (це side-effect блок верхнього рівня модуля).

**Side effects:**

- Якщо файл імпортовано як бібліотеку — гілка не виконується, бо `isRunAsCli` поверне `false`.
- Якщо файл запущено напряму — повний CLI-оркестратор виконує власні I/O (читання конфігу, обхід проєкту, друк звіту) і потім завершує процес через `process.exit`.

## Залежності

### Внутрішні модулі проєкту

- `../../scripts/lib/run-rule-cli.mjs` — постачає:
  - `isRunAsCli(metaUrl)` — детектор, чи модуль є entry-point процесу (за `import.meta.url`).
  - `runRuleCli(ruleDirname)` — standalone CLI-оркестратор для одного правила: конфіг + whitelist + summary + exit-code. Аналогічний за поведінкою до `npx @nitra/cursor fix <id>`.
- `../../scripts/lib/run-standard-rule.mjs` — постачає:
  - `runStandardRule(ruleDirname, ctx?)` — стандартний пайплайн правила: applies → JS-concerns → policy → mdc-refs.
  - Тип `RuleContext` (через JSDoc-`import('...')`), який описує спільний контекст прогону (зокрема `walkCache`).

Шляхи відносні: `../../scripts/lib/...` з директорії `npm/rules/image-compress/` веде до `npm/scripts/lib/...`.

### Платформенні API

- `import.meta.dirname` — стандартна властивість ES-модулів у сучасних рантаймах (Node.js та Bun), містить абсолютну директорію поточного модуля.
- `import.meta.url` — стандартна властивість ES-модулів; URL-форма шляху поточного модуля; використовується для розпізнавання запуску як CLI.
- `process.exit(code)` — глобальний Node/Bun API завершення процесу з кодом виходу.
- Top-level `await` — підтримується в ESM.

### Зовнішні npm-пакети

Прямих імпортів зовнішніх npm-пакетів у файлі немає. Уся залежність на зовнішнє API проходить транзитивно через `run-rule-cli.mjs` та `run-standard-rule.mjs`.

### ESLint-директиви

У файлі присутній один inline-disable: `n/no-process-exit, unicorn/no-process-exit` навколо `process.exit(...)`. Він локалізований лише до одного рядка і обґрунтований у коментарі: standalone entry-point має повертати exit-code для CI/IDE.

## Потік виконання / Використання

### Сценарій A: library-режим (через CLI `@nitra/cursor`)

1. CLI `@nitra/cursor` (наприклад, `npx @nitra/cursor fix` без аргументу-id) збирає список правил, серед яких є `image-compress`.
2. Оркестратор робить `import` модуля `npm/rules/image-compress/fix.mjs` і отримує іменований експорт `run`.
3. Викликає `await run(ctx)`, передаючи спільний `RuleContext` (з `walkCache` тощо).
4. `run` делегує виконання в `runStandardRule(import.meta.dirname, ctx)`, який виконує стандартний пайплайн правила (applies → JS-concerns → policy → mdc-refs) для теки `npm/rules/image-compress/`.
5. `run` повертає `Promise<number>`; оркестратор агрегує exit-коди всіх правил у загальний підсумок.

У цьому сценарії гілка `if (isRunAsCli(...))` НЕ виконується — `process.exit` не викликається, оскільки модуль завантажено як бібліотеку, а не як entry-point процесу.

### Сценарій B: standalone-режим (`bun rules/image-compress/fix.mjs`)

1. Користувач/CI запускає файл напряму: `bun rules/image-compress/fix.mjs` (або еквівалентна команда рантайму).
2. Виконується top-level код модуля, у тому числі гілка `if (isRunAsCli(import.meta.url))`.
3. Оскільки модуль — entry-point процесу, `isRunAsCli` повертає `true`.
4. Викликається `await runRuleCli(import.meta.dirname)`, який повністю відтворює оркестрацію `@nitra/cursor fix <id>` для саме цього правила: завантажує конфіг, обчислює whitelist, прогонить правило, друкує summary, повертає exit-code.
5. `process.exit(<code>)` завершує процес із цим кодом — придатним для CI-пайплайнів та IDE-інтеграцій.

Експорт `run` у цьому сценарії існує, але не викликається з самого файлу — він залишається доступним для зовнішніх імпортів.

### Як файл вписаний у репозиторій

- Тека `npm/rules/image-compress/` — це “контейнер” правила: разом із `fix.mjs` тут (за конвенцією родини стандартних правил) лежать `check-*.mjs` детектори, `.mdc`-опис та інші артефакти, які `runStandardRule` зчитує за відомими шаблонами імен.
- Усі стандартні правила пакета `@nitra/cursor` мають однаковий каркас `fix.mjs` із цим самим патерном (експорт `run` + standalone-блок). Тобто цей файл — фактично шаблонний адаптер між конкретним правилом і спільною бібліотекою прогону.

### Rebuild Test (відтворюваність документації)

За цією документацією без перегляду початкового коду можна відновити поведінку файлу:

- Експортує лише функцію `run(ctx?)` з делегуванням у `runStandardRule(import.meta.dirname, ctx)` і поверненням `Promise<number>` (`0|1`).
- Standalone-гілка: `if (isRunAsCli(import.meta.url)) process.exit(await runRuleCli(import.meta.dirname))` — з inline-disable для `n/no-process-exit, unicorn/no-process-exit`.
- Імпортує `isRunAsCli` та `runRuleCli` зі `../../scripts/lib/run-rule-cli.mjs`, і `runStandardRule` зі `../../scripts/lib/run-standard-rule.mjs`.
- Жодних інших експортів, констант чи побічних дій верхнього рівня.

Цього достатньо, щоб точно відтворити структуру та контракт оригінального файлу.
