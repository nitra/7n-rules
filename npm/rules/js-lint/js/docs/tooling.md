# tooling.mjs

## Огляд

Модуль `tooling.mjs` реалізує перевірку (check-частину) правила **`js-lint.mdc`** для проєктів-споживачів пакета `@nitra/cursor`. Він гарантує, що репозиторій налаштований на канонічний JS-toolchain Nitra:

- наявність та коректний вміст **flat ESLint config** (`eslint.config.js` або `eslint.config.mjs`) з виклику `getConfig` із `@nitra/eslint-config` та `ignores` для `**/auto-imports.d.ts`;
- **`.oxlintrc.json`** має збігатися з канонічним JSON у пакеті (`npm/rules/js-lint/js/data/tooling/oxlint-canonical.json`) — `plugins`, `jsPlugins`, `categories`, усі правила з канону, `settings`, `env`, `globals`, `ignorePatterns`; додаткові записи дозволені лише у блоці `rules`;
- кожен workspace-`package.json` має `"type": "module"`, `engines.node >= 24` та `engines.bun >= 1.3`;
- існує workflow `.github/workflows/lint-js.yml` (структуру валідує Rego-policy `js_lint.lint_js_yml`), а `.github/workflows/lint.yml` (якщо є) **не дублює** кроки `bunx oxlint` / `bunx eslint` / `jscpd`;
- існує `knip.json` (якщо відсутній — копіюється канонічний baseline з пакета);
- у репозиторії **немає** застарілих legacy-конфігів ESLint (`.eslintrc`, `.eslintrc.js`, `.eslintrc.json`, `.eslintrc.yml`).

Per-document вимоги (`lint-js` script, мінімальна версія `@nitra/eslint-config ≥ 3.10.0`, root `engines`, `.jscpd.json`, `.vscode/extensions.json`, структура `lint-js.yml`) вже **не** реалізуються тут — їх валідують Rego-policy-пакети `js_lint.*` (`npm/policy/js_lint/package_json/`, `npm/policy/js_lint/lint_js_yml/`). Це усуває дублювання істини між JS-перевіркою та Rego-політиками.

Модуль використовує спільний `createCheckReporter` зі скриптів пакета: збирає `pass` / `fail`-повідомлення та повертає числовий exit-код (0 — OK, 1 — є проблеми).

## Експорти / API

| Експорт | Тип | Призначення |
| --- | --- | --- |
| `OXLINT_CANONICAL_JSON_PATH` | `string` (named const) | Абсолютний шлях до канонічного `oxlint-canonical.json` у цьому пакеті (`<dirname>/data/tooling/oxlint-canonical.json`). Використовується перевіркою та тестами. |
| `KNIP_CANONICAL_JSON_PATH` | `string` (named const) | Абсолютний шлях до канонічного `knip-canonical.json` у цьому пакеті. Копіюється у корінь проєкту-споживача, якщо `knip.json` відсутній. |
| `verifyOxlintRcAgainstCanonical(cfg, canonical)` | `function` (named export) | Чиста функція звірення розпарсеного `.oxlintrc.json` із канонічним JSON. Повертає `{ ok: boolean, failures: string[] }`. |
| `check(cwd?)` | `async function` (named export) | Точка входу: запускає всі under-the-hood перевірки і повертає `Promise<number>` (0 — все добре, 1 — є fail). |

Усі решта функцій (`deepEqualOxlintCanonical`, `asRecordOrEmpty`, `compareOxlintRules`, `compareOxlintIgnorePatterns`, `checkEslintConfig`, `checkPackageJsonTypeModule`, `checkWorkspacePackages`, `checkEnginesNode`, `checkEnginesBun`, `checkPackageJsonJsLint`, `checkOxlintRc`, `checkLintJsWorkflows`, `checkKnipConfig`) — **module-private** (не експортуються).

## Функції

### `deepEqualOxlintCanonical(actual, expected)`

**Сигнатура:** `function deepEqualOxlintCanonical(actual: unknown, expected: unknown): boolean`

**Параметри:**
- `actual` — значення з `.oxlintrc.json` (будь-який тип);
- `expected` — еталонне значення з канону.

**Повертає:** `true`, якщо `actual` повністю збігається з `expected` за правилами канону:
- примітиви — `===`;
- масиви — однакові за `JSON.stringify` (тобто **порядок** теж важливий);
- об’єкти — **той самий набір ключів** (`expKeys.length === actKeys.length` і всі ключі канону присутні в actual) та рекурсивно рівні значення.

**Side effects:** немає (чиста функція).

---

### `asRecordOrEmpty(v)`

**Сигнатура:** `function asRecordOrEmpty(v: unknown): Record<string, unknown>`

**Параметри:**
- `v` — будь-яке значення.

**Повертає:** саме значення (із cast-коментарем), якщо це plain-object (`typeof v === 'object'`, не `null`, не масив); інакше — `{}`.

**Side effects:** немає.

---

### `compareOxlintRules(expected, actual, failures)`

**Сигнатура:** `function compareOxlintRules(expected: unknown, actual: unknown, failures: string[]): void`

**Параметри:**
- `expected` — канонічний об’єкт `rules`;
- `actual` — значення `rules` з поточного `.oxlintrc.json`;
- `failures` — буфер-масив, у який функція **дописує** повідомлення про невідповідності.

**Поведінка:** ітерує по ключах канону; якщо `actual[ruleKey] !== expected[ruleKey]` (строге `!==` — отже об’єктні значення правил мають бути тим самим референсом, що рідко зустрічається — на практиці значення правил у oxlint це числа / рядки / прості масиви), додає повідомлення у форматі:

```
.oxlintrc.json: rules["<key>"] очікується <expected>, зараз <actual>
```

Додаткові ключі правил у `actual` **дозволені** (не повідомляються).

**Повертає:** `undefined`.

**Side effects:** мутує `failures`.

---

### `compareOxlintIgnorePatterns(expected, actual, failures)`

**Сигнатура:** `function compareOxlintIgnorePatterns(expected: unknown, actual: unknown, failures: string[]): void`

**Параметри:**
- `expected` — канонічний масив `ignorePatterns`;
- `actual` — поточний масив `ignorePatterns`;
- `failures` — буфер для повідомлень.

**Поведінка:**
- якщо `expected` не є масивом — функція мовчки виходить (канон не задає очікувань);
- якщо `actual` не є масивом — додає повідомлення про обов’язковість масиву;
- порівнює як **підмножину**: усі канонічні патерни мають бути в `actual` (через `Set`); відсутні патерни перелічуються одним повідомленням. Додаткові локальні патерни **дозволені**.

**Повертає:** `undefined`.

**Side effects:** мутує `failures`.

---

### `verifyOxlintRcAgainstCanonical(cfg, canonical)` *(експортовано)*

**Сигнатура:** `function verifyOxlintRcAgainstCanonical(cfg: unknown, canonical: unknown): { ok: boolean, failures: string[] }`

**Параметри:**
- `cfg` — розпарсений корінь `.oxlintrc.json`;
- `canonical` — розпарсений `oxlint-canonical.json`.

**Поведінка:**
1. Якщо `cfg` чи `canonical` не є plain-object — повертає `ok: false` з відповідним повідомленням (для `cfg` — про невалідний корінь; для `canonical` — як «внутрішня помилка»).
2. Для кожного ключа канону:
   - `rules` → делегує `compareOxlintRules`;
   - `ignorePatterns` → делегує `compareOxlintIgnorePatterns`;
   - решта ключів → перевіряється через `deepEqualOxlintCanonical`; при невідповідності в `failures` додається повідомлення, що поле має збігатися з каноном пакета `@nitra/cursor`.
3. Повертає `{ ok: failures.length === 0, failures }`.

**Повертає:** результат-об’єкт із прапором `ok` і масивом fail-повідомлень для подальшого репортинга.

**Side effects:** немає (чиста функція; працює з аргументами, не читає файли).

---

### `checkEslintConfig(passFn, failFn, cwd)`

**Сигнатура:** `async function checkEslintConfig(passFn: (msg:string)=>void, failFn: (msg:string)=>void, cwd: string): Promise<void>`

**Параметри:**
- `passFn` — колбек успіху;
- `failFn` — колбек помилки;
- `cwd` — корінь репозиторію.

**Поведінка:**
- шукає `eslint.config.js`, потім `eslint.config.mjs`; якщо жодного — fail і ранній вихід;
- читає вміст знайденого файла як `utf8` і застосовує три суто **текстові** перевірки наявності підрядків:
  1. `getConfig` — обов’язковий виклик;
  2. `@nitra/eslint-config` — обов’язковий імпорт;
  3. `**/auto-imports.d.ts` — обов’язковий запис у `ignores`.

**Повертає:** `Promise<void>`.

**Side effects:** читає файли з ФС (`existsSync`, `readFile`); викликає `passFn`/`failFn`.

---

### `checkPackageJsonTypeModule(label, pkg, passFn, failFn)`

**Сигнатура:** `function checkPackageJsonTypeModule(label: string, pkg: { type?: string }, passFn: (msg:string)=>void, failFn: (msg:string)=>void): void`

**Поведінка:** якщо `pkg.type === 'module'` → `passFn`; інакше → `failFn` з вимогою додати поле.

**Side effects:** виклики переданих колбеків.

---

### `checkWorkspacePackages(workspaces, passFn, failFn, cwd)`

**Сигнатура:** `async function checkWorkspacePackages(workspaces: unknown[], passFn, failFn, cwd: string): Promise<void>`

**Поведінка:** для кожного запису workspaces:
- будує шлях `<ws>/package.json`;
- якщо файл існує — читає та парсить JSON; запускає послідовно `checkPackageJsonTypeModule`, `checkEnginesNode`, `checkEnginesBun`.

**Side effects:** читання ФС, виклики колбеків.

---

### `checkEnginesNode(label, pkg, passFn, failFn)`

**Сигнатура:** `function checkEnginesNode(label: string, pkg: { engines?: { node?: string } }, passFn, failFn): void`

**Поведінка:** дістає `pkg.engines?.node`; через регекс `NON_DIGITS_RE = /\D+/u` бере **перший** числовий токен (наприклад, з `">=24"` → `"24"`); якщо це число ≥ 24 → pass, інакше → fail; якщо поле відсутнє → fail з пропозицією додати `"engines": { "node": ">=24" }`.

**Side effects:** виклики колбеків.

---

### `checkEnginesBun(label, pkg, passFn, failFn)`

**Сигнатура:** `function checkEnginesBun(label: string, pkg: { engines?: { bun?: string } }, passFn, failFn): void`

**Поведінка:** дістає `pkg.engines?.bun`; розбиває рядок по `NON_DIGITS_RE`, фільтрує порожні токени, бере перші два як `[major, minor]`; pass якщо `major > 1` або `major === 1 && minor >= 3`; інакше fail; відсутнє поле → fail з пропозицією додати `"engines": { "bun": ">=1.3" }`.

**Side effects:** виклики колбеків.

---

### `checkPackageJsonJsLint(passFn, failFn, cwd)`

**Сигнатура:** `async function checkPackageJsonJsLint(passFn, failFn, cwd: string): Promise<void>`

**Поведінка:** читає кореневий `package.json` (якщо відсутній — мовчки виходить); бере поле `workspaces` (масив або `[]`) і делегує `checkWorkspacePackages`. Кореневий `package.json` тут **не** валідується — це робить Rego-policy `npm/policy/js_lint/package_json/`.

**Side effects:** читання ФС, виклики колбеків.

---

### `checkOxlintRc(passFn, failFn, cwd)`

**Сигнатура:** `async function checkOxlintRc(passFn, failFn, cwd: string): Promise<void>`

**Поведінка:**
1. Якщо `.oxlintrc.json` відсутній → fail і ранній вихід.
2. Спроба JSON-парсингу; при помилці → fail про невалідний JSON.
3. Pass-повідомлення про наявність файла.
4. Читає канонічний `oxlint-canonical.json` (шлях `OXLINT_CANONICAL_JSON_PATH`); при помилці → fail-повідомлення «внутрішня помилка».
5. Викликає `verifyOxlintRcAgainstCanonical(oxCfg, canonical)`; pass якщо `ok`, інакше — повторно викликає `failFn` для кожного повідомлення зі списку `failures`.

**Side effects:** читання ФС, виклики колбеків.

---

### `checkLintJsWorkflows(passFn, failFn, cwd)`

**Сигнатура:** `async function checkLintJsWorkflows(passFn, failFn, cwd: string): Promise<void>`

**Поведінка:**
- перевіряє існування `.github/workflows/lint-js.yml` → pass з нагадуванням, що структуру валідує Rego (`js_lint.lint_js_yml`); відсутність → fail;
- якщо існує `.github/workflows/lint.yml` — читає його як текст і перевіряє, що він **не містить одночасно** трьох підрядків `bunx oxlint`, `bunx eslint`, `jscpd`. Якщо містить — fail (дубль кроків JS-лінта), інакше — pass.

**Side effects:** читання ФС, виклики колбеків.

---

### `checkKnipConfig(passFn, failFn, cwd)`

**Сигнатура:** `async function checkKnipConfig(passFn, failFn, cwd: string): Promise<void>`

**Поведінка:**
- якщо `knip.json` існує у корені — pass і вихід;
- якщо відсутній і канонічний шаблон `KNIP_CANONICAL_JSON_PATH` теж недоступний (`existsSync` повертає false) — fail з пропозицією перевстановити `@nitra/cursor`;
- інакше — **копіює** канонічний JSON у `cwd/knip.json` через `copyFile` і повідомляє pass.

**Side effects:** читання ФС, **запис** нового файла `knip.json`, виклики колбеків. Це єдина функція модуля з write-side-effect.

---

### `check(cwd?)` *(експортовано — публічна точка входу)*

**Сигнатура:** `async function check(cwd?: string): Promise<number>` (за замовчуванням `cwd = process.cwd()`).

**Поведінка:**
1. Створює репортер через `createCheckReporter()` і отримує `pass` / `fail` колбеки.
2. Послідовно `await`-ить:
   - `checkEslintConfig` — flat-config;
   - `checkPackageJsonJsLint` — workspace-`package.json`;
   - `checkOxlintRc` — `.oxlintrc.json` vs canonical;
   - `checkLintJsWorkflows` — `lint-js.yml` + дубль у `lint.yml`;
   - `checkKnipConfig` — `knip.json` (з можливим створенням).
3. Перевіряє наявність legacy-файлів у списку `['.eslintrc', '.eslintrc.js', '.eslintrc.json', '.eslintrc.yml']`; для кожного знайденого — `fail`.
4. Повертає `reporter.getExitCode()` — `0` якщо не було жодного `fail`, інакше `1`.

**Повертає:** `Promise<number>` — exit-код для CLI.

**Side effects:** усі ефекти із дочірніх функцій (читання ФС, можливий запис `knip.json`, виведення pass/fail через репортер).

## Залежності

### Стандартна бібліотека Node.js

- `node:fs` → `existsSync` — синхронна перевірка наявності файлів.
- `node:fs/promises` → `copyFile`, `readFile` — асинхронні файлові операції.
- `node:path` → `dirname`, `join` — побудова шляхів.
- `node:url` → `fileURLToPath` — перетворення `import.meta.url` для отримання абсолютної директорії модуля.

### Внутрішні

- `../../../scripts/lib/check-reporter.mjs` → `createCheckReporter` — фабрика репортера зі стандартними `pass` / `fail` колбеками та методом `getExitCode()`.

### Канонічні артефакти даних (читаються/копіюються, але не імпортуються як JS-модулі)

- `data/tooling/oxlint-canonical.json` — еталон `.oxlintrc.json`.
- `data/tooling/knip-canonical.json` — baseline для `knip.json` (копіюється у проєкт-споживач).

### Зовнішні

Жодних рантайм-залежностей з `node_modules` модуль не використовує. (Перевірки на наявність `@nitra/eslint-config` виконуються **текстово** як пошук підрядка у файлі ESLint-конфіга.)

## Потік виконання / Використання

### Типовий запуск

Модуль використовується інфраструктурою `@nitra/cursor` як check-частина правила `js-lint`. Виклик:

```js
import { check } from '@nitra/cursor/rules/js-lint/js/tooling.mjs'

const exitCode = await check(process.cwd())
process.exit(exitCode)
```

або через загальний раннер пакета, який ітерує всі `check-*.mjs` правил.

### Послідовність кроків у середині `check`

1. **ESLint config** → шукаємо `eslint.config.js`/`.mjs`, перевіряємо вміст на `getConfig`, `@nitra/eslint-config`, `**/auto-imports.d.ts`.
2. **package.json workspaces** → ітеруємо `workspaces[]`, перевіряємо `type: "module"` + `engines.node` + `engines.bun` у кожному.
3. **.oxlintrc.json** → читаємо JSON, парсимо канон із пакета, повне дерев’яне порівняння через `verifyOxlintRcAgainstCanonical` (особливі правила для `rules` і `ignorePatterns`).
4. **GitHub workflows** → перевіряємо існування `lint-js.yml`; перевіряємо, що `lint.yml` не дублює `bunx oxlint` + `bunx eslint` + `jscpd`.
5. **knip.json** → якщо відсутній, копіюємо канонічний baseline; інакше — лише фіксуємо наявність.
6. **Legacy ESLint configs** → fail для будь-якого з `.eslintrc`, `.eslintrc.js`, `.eslintrc.json`, `.eslintrc.yml` у корені.
7. Повертаємо `0` або `1` через репортер.

### Розподіл відповідальності з Rego-policies

| Що перевіряється | Де живе |
| --- | --- |
| Наявність `eslint.config.{js,mjs}` + ключові підрядки | **тут** (`checkEslintConfig`) |
| `type: "module"`, `engines.{node,bun}` у workspace-пакетах | **тут** (`checkWorkspacePackages`) |
| Той самий набір полів у кореневому `package.json`, мінімальна версія `@nitra/eslint-config`, `lint-js`-script, `prettier`, `@nitra/prettier-config` | Rego: `npm/policy/js_lint/package_json/`, `npm/policy/text/package_json/` |
| Збіг `.oxlintrc.json` з канонічним JSON | **тут** (`checkOxlintRc` + `verifyOxlintRcAgainstCanonical`) |
| Наявність `lint-js.yml`, заборона дубля у `lint.yml` | **тут** (`checkLintJsWorkflows`) |
| Структура `lint-js.yml` (`actions/checkout@v6`, `persist-credentials: false`, `setup-bun-deps`, заборона `--fix`) | Rego: `npm/policy/js_lint/lint_js_yml/` |
| Bootstrap `knip.json` (копіювання канону) | **тут** (`checkKnipConfig`) |
| Заборона legacy `.eslintrc*` | **тут** (`check`, фінальний цикл) |

### Семантика звіту

- Кожна перевірка дописує **окремі** повідомлення у репортер; `check` не зупиняється на першому `fail`, а збирає повний набір проблем — це навмисно, щоб CI-користувач бачив усі порушення одним прогоном.
- Винятки JSON-парсингу `.oxlintrc.json` ловляться локально та трансформуються у fail-повідомлення; невдала зчитка канону також не кидає виняток назовні (стає «внутрішня помилка»). Інші помилки (наприклад, `JSON.parse` для workspace-`package.json`) **не** ловляться і прокидаються через `Promise<number>` як rejection — це сигналізує про серйозну поломку (битий JSON у відомому файлі).

### Rebuild Test

Документ описує одиничний файл `tooling.mjs`. Перебудова за документом має містити:

- два названих експорти-шляхи (`OXLINT_CANONICAL_JSON_PATH`, `KNIP_CANONICAL_JSON_PATH`), обчислені через `dirname(fileURLToPath(import.meta.url))` + `data/tooling/<name>.json`;
- регекс `NON_DIGITS_RE = /\D+/u` як модульну константу;
- експорт `verifyOxlintRcAgainstCanonical(cfg, canonical)` із семантикою «`rules` — підмножина значень, `ignorePatterns` — підмножина елементів, решта полів — повний `deepEqualOxlintCanonical`»;
- допоміжні приватні функції `deepEqualOxlintCanonical`, `asRecordOrEmpty`, `compareOxlintRules`, `compareOxlintIgnorePatterns` з описаною семантикою (для масивів — порівняння через `JSON.stringify`; для об’єктів — однаковий розмір ключів і рекурсія; primitives — `===`);
- приватні чекери (`checkEslintConfig`, `checkPackageJsonTypeModule`, `checkWorkspacePackages`, `checkEnginesNode`, `checkEnginesBun`, `checkPackageJsonJsLint`, `checkOxlintRc`, `checkLintJsWorkflows`, `checkKnipConfig`) з зазначеними сигнатурами та повідомленнями;
- експорт `check(cwd = process.cwd())`, який створює репортер через `createCheckReporter`, послідовно `await`-ить п’ять чекерів у порядку *ESLint → package.json → oxlint → workflows → knip*, потім перевіряє legacy-конфіги ESLint і повертає `reporter.getExitCode()`.
