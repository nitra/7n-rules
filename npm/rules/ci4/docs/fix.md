# fix.mjs — точка входу правила `ci4` (library + standalone CLI)

## Огляд

Файл `npm/rules/ci4/fix.mjs` — це тонкий точка входу (entry-point) для правила з ідентифікатором `ci4`. Він не містить власної прикладної логіки перевірки/виправлення: уся робота делегується утиліті `runStandardRule`, яка реалізує стандартний послідовний конвеєр прогону правила:

1. `applies` — перевірка, чи правило взагалі застосовне до поточного робочого дерева/конфігурації;
2. `JS-concerns` — перевірки/виправлення, специфічні для JS/TS-аспектів правила;
3. `policy` — політики (declarative rules), які описують стан, що має бути дотриманий;
4. `mdc-refs` — перевірка відповідності правила супровідній `.mdc`-документації (посилання та узгодженість).

Файл одночасно виконує дві ролі:

- **library mode** — інші модулі (зокрема CLI-оркестратор `@nitra/cursor`) імпортують named-export `run(ctx)` і викликають його з готовим контекстом (наприклад, із `walkCache`, щоб не повторювати обхід дерева між правилами);
- **standalone mode** — файл можна запустити напряму через `bun rules/ci4/fix.mjs`. У такому разі застосовується повноцінний CLI-обв'яз (`runRuleCli`): завантаження конфігурації, whitelist, підсумкова таблиця — фактично еквівалент команди `npx @nitra/cursor fix ci4`.

Сам файл містить лише делегування й сторожовий блок для standalone-запуску, тому всі побічні ефекти (виведення в stdout, читання конфігів, мутації файлів проекту) ховаються всередині `runStandardRule` та `runRuleCli`.

## Експорти / API

| Експорт | Тип | Призначення |
| --- | --- | --- |
| `run` | named export, функція `(ctx?) => Promise<number>` | Library-entry для виклику правила `ci4` з оркестратора. Повертає exit-код (0/1). |

Default export відсутній. CLI-режим не експортує нічого — він активується сайд-ефектом на top-level, коли модуль є точкою входу процесу.

## Функції

### `run(ctx)`

**Сигнатура.**

```js
export function run(ctx)
```

**Параметри.**

- `ctx` — `RuleContext` (опціональний). Тип посилається на `import('../../scripts/lib/run-standard-rule.mjs').RuleContext`. Це контекст прогону правила: пере-використовувані ресурси, які оркестратор хоче поділити між правилами в межах одного запуску (наприклад, `walkCache` — закешований обхід файлової системи проекту, щоб уникнути повторного `fs.readdir`).
- Параметр опціональний: якщо `ctx` не передано, `runStandardRule` створить/працюватиме без зовнішнього кешу.

**Повертає.**

- `Promise<number>` — exit-код прогону правила:
  - `0` — правило не знайшло порушень або всі порушення були автоматично виправлені;
  - `1` — є порушення, які залишилися після спроби виправлення (тобто правило вважається проваленим).

**Що робить.**

- Викликає `runStandardRule(import.meta.dirname, ctx)`. Перший аргумент `import.meta.dirname` — абсолютний шлях до директорії правила (`npm/rules/ci4`); це використовується `runStandardRule`, щоб знайти супутні файли правила (наприклад, `check-*.mjs`, `mdc`-документацію, ID правила тощо).
- Усі реальні дії (обхід проекту, читання/запис файлів, друк summary) виконуються всередині `runStandardRule` — у самому `run` побічних ефектів немає.

**Side effects.**

- Безпосередньо в коді функції — немає. Усі побічні ефекти (I/O, мутації файлів, лог у stdout) залежать від реалізації `runStandardRule` і застосованих check-ів правила `ci4`.

### Top-level standalone-блок (без імені)

**Сигнатура (умовно).**

```js
if (isRunAsCli(import.meta.url)) {
  process.exit(await runRuleCli(import.meta.dirname))
}
```

**Що робить.**

- `isRunAsCli(import.meta.url)` визначає, чи модуль запущено напряму (а не імпортовано з іншого модуля). Реалізація — у `npm/scripts/lib/run-rule-cli.mjs`.
- Якщо так — викликає `runRuleCli(import.meta.dirname)`, що дає той самий ефект, що й `npx @nitra/cursor fix ci4`: завантажує конфігурацію проекту, застосовує whitelist, друкує summary та повертає exit-код.
- Результат передається в `process.exit(...)` — щоб CI/IDE отримали коректний код завершення.

**Параметри / повертає.**

- Не функція як така — це топ-рівневий `await` із умовою. Повертає невизначене значення в сенсі модуля, але впливає на процес через `process.exit`.

**Side effects.**

- Завершує Node/Bun-процес із кодом, який повернув `runRuleCli`.
- Випуск `console.log`/`console.error` усередині `runRuleCli` (за реалізацією).
- Можливі мутації файлів проекту, якщо правило підтримує auto-fix.

**Лінт-винятки в коді.**

- Рядок із `process.exit` вимкнено для двох правил ESLint:
  - `n/no-process-exit` (плагін `eslint-plugin-n`) — забороняє прямий виклик `process.exit` у бібліотечному коді;
  - `unicorn/no-process-exit` (плагін `eslint-plugin-unicorn`) — те саме застереження.
- Причина (вказана в коментарі): standalone entry-point має повертати exit-code для CI/IDE — без `process.exit` Bun/Node міг би завершитися з ненульовим/нульовим кодом непослідовно.

## Залежності

### Внутрішні (відносні імпорти)

- `../../scripts/lib/run-rule-cli.mjs`
  - `isRunAsCli(importMetaUrl)` — детектор «модуль запущено напряму»;
  - `runRuleCli(ruleDir)` — повний CLI-обв'яз для одного правила (config + whitelist + summary).
- `../../scripts/lib/run-standard-rule.mjs`
  - `runStandardRule(ruleDir, ctx?)` — стандартна послідовність `applies → JS-concerns → policy → mdc-refs`;
  - JSDoc-тип `RuleContext` — структура контексту, який передається в `run`.

### Зовнішні

- Прямих зовнішніх npm-залежностей немає. Усі залежності — внутрішні модулі пакета `@nitra/cursor` (`npm/scripts/lib/...`).

### Платформа

- Очікується середовище Node.js/Bun з підтримкою:
  - ESM-модулів (`import`/`export`, `import.meta.dirname`, `import.meta.url`);
  - top-level `await` (для рядка `await runRuleCli(...)`);
  - `process.exit` (Node/Bun).
- `import.meta.dirname` потребує сучасних версій Node.js (≥ 20.11 / 21.2) або Bun, де ця властивість підтримується.

## Потік виконання / Використання

### Library mode (виклик з оркестратора)

1. Інший модуль (CLI-агрегатор правил, наприклад, диспетчер `@nitra/cursor fix`) імпортує named-export:
   ```js
   import { run } from '@nitra/cursor/rules/ci4/fix.mjs'
   ```
2. Підготовляє спільний контекст `ctx` (наприклад, спільний `walkCache`).
3. Викликає:
   ```js
   const exitCode = await run(ctx)
   ```
4. `run` делегує виклик у `runStandardRule(ruleDir, ctx)`, який послідовно:
   - перевіряє `applies` (чи правило застосовне);
   - якщо так — виконує JS-concerns, policy, mdc-refs;
   - агрегує результат і повертає 0/1.
5. Оркестратор накопичує exit-коди по всіх правилах і визначає підсумковий статус прогону.

### Standalone mode (CLI)

1. Користувач/CI запускає файл напряму:
   ```bash
   bun npm/rules/ci4/fix.mjs
   ```
2. `isRunAsCli(import.meta.url)` повертає `true`, оскільки модуль є entry-point процесу.
3. Викликається `runRuleCli(import.meta.dirname)`:
   - завантажується конфігурація проекту;
   - застосовується whitelist (які файли/директорії обходити);
   - усередині використовується той самий `runStandardRule`, що й у library-режимі;
   - друкується підсумкова таблиця (summary).
4. Результат (0/1) передається в `process.exit(...)` — процес завершується відповідним кодом.

Цей режим є повним функціональним еквівалентом команди:

```bash
npx @nitra/cursor fix ci4
```

### Інваріанти й типові помилки

- Файл свідомо порожній від прикладної логіки: будь-яка зміна поведінки правила `ci4` має робитися в супутніх файлах (`check-*.mjs`, `applies.mjs`, тощо) — а не тут.
- Дві ролі (library + standalone) реалізовано в одному файлі навмисно — щоб уникнути дублікатів і щоб CLI-режим завжди узгоджувався з library-режимом.
- Якщо файл імпортують як модуль (не як entry-point), `isRunAsCli` повертає `false` і блок `process.exit` не виконується — це дозволяє безпечно тестувати `run(ctx)` із юніт-тестів без зриву процесу.

## Rebuild Test

Якщо файл відновлювати «з нуля» за цією документацією, мінімальна реалізація має містити:

1. Імпорт `isRunAsCli, runRuleCli` з `../../scripts/lib/run-rule-cli.mjs`.
2. Імпорт `runStandardRule` з `../../scripts/lib/run-standard-rule.mjs`.
3. Named-export `run(ctx)`, який повертає `runStandardRule(import.meta.dirname, ctx)`.
4. JSDoc для `run` з типом `ctx` (`RuleContext` із `run-standard-rule.mjs`) і `@returns {Promise<number>}`.
5. Сторожовий блок:
   ```js
   if (isRunAsCli(import.meta.url)) {
     process.exit(await runRuleCli(import.meta.dirname))
   }
   ```
6. ESLint-disable коментар над `process.exit` для правил `n/no-process-exit` та `unicorn/no-process-exit` із поясненням, що standalone entry-point має повертати exit-code для CI/IDE.

Поведінкові інваріанти, які мають бути збережені:

- Імпорт модуля без запуску не повинен викликати `process.exit`.
- `run()` без аргументів має працювати (опціональний `ctx`).
- `run(ctx)` повертає саме те значення, яке повернув `runStandardRule`, без додаткової обробки.
- Standalone-запуск має повертати той самий exit-код, що й `runRuleCli(...)`.
