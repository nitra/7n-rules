# tooling.mjs

## Огляд

Модуль `tooling.mjs` реалізує **JS-частину перевірки правила `style-lint.mdc`** — тобто тих аспектів CSS/SCSS-лінтингу через `stylelint`, які **не вкриваються** Rego-політиками (`npx @nitra/cursor check`) і які потребують **файлової системи / cross-file** знання.

Конкретно перевіряє:

1. Наявність **конфігу stylelint** — або як поле `stylelint` у `package.json`, або як зовнішній файл (`.stylelintrc.json`, `.stylelintrc.js`, `stylelint.config.js`). Ця перевірка cross-file: треба порівняти, чи поле є, і якщо нема — чи є зовнішній файл.
2. Наявність файлу `.stylelintignore` у корені репозиторію.
3. Наявність workflow-файлу `.github/workflows/lint-style.yml` (структуру окремо валідовує rego-пакет `style_lint.lint_style_yml`).

Що **вже** покрила Rego (тому тут НЕ повторюється):

- `npm/policy/style_lint/package_json/` — наявність скрипта `lint-style` через `npx stylelint`, `@nitra/stylelint-config` у `devDependencies`, поле `stylelint.extends`.
- `npm/policy/style_lint/lint_style_yml/` — рядок `npx stylelint` у `run` workflow-файлу.
- `npm/policy/style_lint/vscode_extensions/` — `stylelint.vscode-stylelint` у `recommendations` файлу `.vscode/extensions.json`.
- `npm/policy/style_lint/vscode_settings/` — `css.validate`/`scss.validate`/`less.validate: false` у `.vscode/settings.json`.

JS-копії перевірок VS Code було **видалено**, щоб не було двох джерел істини — все, що може Rego, лишається тільки у Rego.

## Експорти / API

| Експорт | Тип                                                | Призначення                                                                                                                                     |
| ------- | -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `check` | `async function (cwd?: string) => Promise<number>` | Основна точка входу: запускає всі перевірки конфігурації stylelint у заданому корені репозиторію та повертає exit-код (0 — OK, 1 — є проблеми). |

Внутрішня (НЕ експортується) функція:

| Функція                                       | Призначення                                                                            |
| --------------------------------------------- | -------------------------------------------------------------------------------------- |
| `checkStylelintConfigPresence(reporter, cwd)` | Перевіряє наявність конфігурації stylelint (поле в `package.json` або зовнішній файл). |

## Функції

### `check(cwd?)`

**Сигнатура:**

```js
export async function check(cwd = process.cwd()): Promise<number>
```

**Параметри:**

- `cwd` (`string`, опціональний) — абсолютний шлях до кореня репозиторію, який треба перевірити. За замовчуванням використовується `process.cwd()` (поточна робоча директорія процесу).

**Повертає:**

- `Promise<number>` — exit-код процесу:
  - `0` — усі перевірки пройдено (відсутні `fail`-події у репортера);
  - `1` — хоч одна перевірка зафейлилась.

Конкретне значення береться з виклику `reporter.getExitCode()`, який інкапсульований у `createCheckReporter()`.

**Що робить:**

1. Створює репортер через `createCheckReporter()` — він збирає події `pass`/`fail` і виводить їх у консоль під час виконання.
2. Викликає `checkStylelintConfigPresence(reporter, cwd)` — перевірка №1 (конфіг stylelint).
3. Перевіряє наявність файлу `.stylelintignore` у корені:
   - якщо є — звітує `pass('.stylelintignore існує')`;
   - якщо нема — `fail('.stylelintignore не існує — створи з вмістом: dist/')`.
4. Перевіряє наявність workflow-файлу `.github/workflows/lint-style.yml`:
   - якщо є — `pass` із зауваженням, що структуру файлу валідовує `npx @nitra/cursor fix → style_lint.lint_style_yml`;
   - якщо нема — `fail` із вимогою його створити.
5. Повертає `reporter.getExitCode()`.

**Side effects:**

- Виконує **синхронні** виклики `existsSync` (читає файлову систему).
- Через репортер пише у консоль (stdout/stderr) повідомлення `pass`/`fail` (поведінка інкапсульована у `check-reporter.mjs`).
- Не змінює файли. Не виконує мережевих запитів. Не змінює стану процесу (не викликає `process.exit`) — повертає exit-код, а викликаюча сторона сама вирішує, як його використати.

---

### `checkStylelintConfigPresence(reporter, cwd)` _(внутрішня)_

**Сигнатура:**

```js
async function checkStylelintConfigPresence(
  reporter: CheckReporter,
  cwd: string,
): Promise<void>
```

**Параметри:**

- `reporter` (`CheckReporter`) — об'єкт-репортер, створений `createCheckReporter()`, з полями `{ pass, fail, getExitCode }`. У функції використовуються лише `pass` і `fail`.
- `cwd` (`string`) — корінь репозиторію.

**Повертає:**

- `Promise<void>` — нічого не повертає; результат виражається через виклики `reporter.pass(...)` / `reporter.fail(...)`.

**Логіка:**

1. Будує шлях до `package.json` через `join(cwd, 'package.json')`.
2. Якщо `package.json` **немає** — мовчки повертається з функції (`return`). Це означає: для тек без `package.json` перевірка пропускається (вона нерелевантна).
3. Читає `package.json` через `readFile(pkgPath, 'utf8')` і парсить як JSON.
4. Перевіряє `hasField` — `pkg.stylelint && typeof pkg.stylelint === 'object'` (саме поле-об'єкт; формат `extends: "@nitra/stylelint-config"` валідовує Rego).
5. Перевіряє `hasExternalCfg` — наявність хоча б одного з файлів:
   - `.stylelintrc.json`
   - `.stylelintrc.js`
   - `stylelint.config.js`
6. Якщо `hasField || hasExternalCfg` — `pass('Конфіг stylelint є — у package.json або окремим файлом')`.
7. Інакше — `fail('Немає конфігу stylelint — додай "stylelint": { "extends": "@nitra/stylelint-config" } до package.json')`.

**Side effects:**

- Синхронно: `existsSync` для `package.json` та для трьох можливих зовнішніх конфіг-файлів.
- Асинхронно: `readFile` для `package.json`.
- Через репортер пише до консолі результат.
- Може кинути виняток, якщо `package.json` існує, але містить невалідний JSON (`JSON.parse` кине `SyntaxError`) — функція **не** обробляє цю помилку.

**Зауваження щодо файлів-конфігів:**

Список перевірюваних зовнішніх конфігів **не** охоплює всі можливі формати, які підтримує stylelint (наприклад, `.stylelintrc`, `.stylelintrc.yaml`, `.stylelintrc.yml`, `.stylelintrc.cjs`). Перевіряються лише три найпопулярніші: `.stylelintrc.json`, `.stylelintrc.js`, `stylelint.config.js`.

## Залежності

### Імпорти із Node.js

| Модуль             | Що використовується                                 |
| ------------------ | --------------------------------------------------- |
| `node:fs`          | `existsSync` — синхронна перевірка існування файлу. |
| `node:fs/promises` | `readFile` — асинхронне читання файлу як рядка.     |
| `node:path`        | `join` — крос-платформне склеювання шляхів.         |

### Внутрішні імпорти

| Шлях                                      | Що дає                                                                                                                                                                                                                      |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `../../../scripts/lib/check-reporter.mjs` | `createCheckReporter()` — фабрика репортера, який має методи `pass(msg)`, `fail(msg)` та `getExitCode()`. Тип `CheckReporter` тягнеться JSDoc-посиланням `import('../../../scripts/lib/check-reporter.mjs').CheckReporter`. |

### Зв'язані артефакти (НЕ імпортуються, але важливі контекстно)

- `npm/rules/style-lint/style-lint.mdc` — людино-зрозуміле формулювання правила.
- `npm/policy/style_lint/package_json/` — Rego-пакет, що покриває валідацію формату полів `package.json`.
- `npm/policy/style_lint/lint_style_yml/` — Rego-пакет, що валідовує вміст workflow-файлу.
- `npm/policy/style_lint/vscode_extensions/` — Rego для `.vscode/extensions.json`.
- `npm/policy/style_lint/vscode_settings/` — Rego для `.vscode/settings.json`.

## Потік виконання / Використання

### Контекст виклику

Модуль є частиною ланцюжка перевірок правил `@nitra/cursor`. Експортована функція `check` викликається диспетчером перевірок (зазвичай через CLI `npx @nitra/cursor check`), який ітерує rule-теки і для кожної шукає файл `js/tooling.mjs` з експортованим `check`.

### Послідовність дій усередині `check`

1. **Створення репортера:**
   ```js
   const reporter = createCheckReporter()
   const { pass, fail } = reporter
   ```
   (`pass`/`fail` деструктуруються, але в `check` напряму не використовуються — лише як алії; всередині `checkStylelintConfigPresence` вони беруться зі свого деструктурування.)
2. **Перевірка конфігу stylelint** — `await checkStylelintConfigPresence(reporter, cwd)`.
3. **Перевірка `.stylelintignore`** — `existsSync(join(cwd, '.stylelintignore'))`.
4. **Перевірка workflow `lint-style.yml`** — `existsSync(join(cwd, '.github/workflows/lint-style.yml'))`.
5. **Повернення exit-коду** — `return reporter.getExitCode()`.

### Приклад використання

```js
import { check } from '@nitra/cursor/rules/style-lint/js/tooling.mjs'

const exitCode = await check(process.cwd())
process.exit(exitCode)
```

Або через CLI-обгортку:

```bash
npx @nitra/cursor check
```

(CLI сам знайде цей модуль за конвенцією `npm/rules/<rule>/js/tooling.mjs` і викличе `check()` без аргументів, тож буде використано `process.cwd()`.)

### Гарантії та межі відповідальності

- Модуль **не змінює** файли (немає `fix`-режиму) — він тільки **репортує**.
- Він **не дублює** перевірок, які вже робить Rego. Розділення: FS / cross-file → JS (тут); формат / структура одного файлу → Rego.
- Виклик `check` із `cwd`, де немає `package.json`, — валідний сценарій: перевірка конфігу stylelint буде пропущена (мовчки), решта перевірок (`.stylelintignore`, workflow) — виконається.
- Якщо `package.json` містить невалідний JSON — функція впаде з `SyntaxError` (це не пере́хоплюється навмисно: гнилий JSON — це самостійна проблема, яку треба чути одразу).

## Rebuild Test

З цього документа можна повністю відновити поведінку файлу:

- Знаючи список перевірок (конфіг stylelint, `.stylelintignore`, `lint-style.yml`), повідомлення `pass`/`fail` і допустимі імена файлів-конфігів — реалізація відтворюється 1:1.
- Деталі контракту функцій (типи параметрів, тип повернення, side effects, поведінка за відсутності `package.json`) описані явно.
- Експорти та їх кількість (єдиний експорт `check`) зафіксовано.
- Імпорти Node-модулів і внутрішні залежності перераховано вичерпно.
