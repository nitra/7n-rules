# tooling.mjs — перевірка інструментарію Tauri

## Огляд

Модуль `npm/rules/tauri/js/tooling.mjs` реалізує JS-orchestrator для правила `tauri.mdc`. Його єдина мета — перевірити, чи правильно налаштовано VSCode-конфіг `.vscode/extensions.json` у проєктах, де є Tauri.

Особливості:

- **Cross-file gating**. Перевірка вмикається лише за наявності маркера Tauri у проєкті. Якщо проєкт не використовує Tauri — модуль одразу повертає успіх і нічого не валідує.
- **Маркер Tauri** шукається в усіх workspace-пакетах монорепо (включно з кореневим) через `getMonorepoPackageRootDirs()` за п'ятьма ознаками: наявність каталогу `src-tauri/`, файлів `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json`, `tauri.conf.json` (legacy flat-layout) або префікса `@tauri-apps/` у `dependencies`/`devDependencies` файла `package.json`.
- **Plan B архітектура**. Це conditional-правило: Rego-полісі лежить глобально без `target.json` поруч і **не** є auto-discoverable через `n-cursor fix`. Тому JS-orchestrator робить FS-існування файла самостійно, а content-валідацію делегує в Rego через `runConftestBatch` (namespace `tauri.vscode_extensions`).
- **Звітування** іде через `createCheckReporter` — стандартний reporter з `pass`/`fail` повідомленнями та `getExitCode()` (0 — OK, 1 — є порушення).

## Експорти / API

| Символ  | Тип                     | Опис                                                                                                                                                       |
| ------- | ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `check` | `() => Promise<number>` | **Єдиний публічний експорт.** Запускає перевірку правил `tauri.mdc` і повертає exit-код процесу: `0` — все добре або Tauri-маркера немає, `1` — порушення. |

Внутрішні (не експортовані) функції модуля:

- `packageHasTauriDep(pkg)` — детектор `@tauri-apps/*` залежностей у `package.json`.
- `workspaceHasTauriMarker(cwd, ws)` — перевірка одного workspace-пакета на ознаки Tauri.
- `projectHasTauriMarker()` — обхід усіх workspaces для агрегованого результату.

## Функції

### `packageHasTauriDep(pkg)`

**Сигнатура.**

```js
function packageHasTauriDep(pkg: Record<string, unknown> | null | undefined): boolean
```

**Параметри.**

- `pkg` — розпарсений вміст `package.json`. Допускає `null`, `undefined` або не-об'єктне значення — у цих випадках повертається `false`.

**Повертає.**

- `boolean` — `true`, якщо серед ключів `pkg.dependencies` або `pkg.devDependencies` знайдено хоча б один ключ із префіксом `@tauri-apps/`. Інакше — `false`.

**Логіка.**

1. Якщо `pkg` falsy або не object — `false`.
2. Перебирає два поля: `'dependencies'` і `'devDependencies'`.
3. Для кожного, якщо поле є object — ітерує `Object.keys()` і перевіряє `name.startsWith('@tauri-apps/')`.
4. Перший збіг → негайне `true` (early return).

**Side effects.** Немає — чиста функція. Працює лише з вхідним об'єктом.

---

### `workspaceHasTauriMarker(cwd, ws)`

**Сигнатура.**

```js
async function workspaceHasTauriMarker(cwd: string, ws: string): Promise<boolean>
```

**Параметри.**

- `cwd` — абсолютний шлях до кореня репо (зазвичай `process.cwd()`).
- `ws` — відносний шлях workspace-пакета від кореня. Спеціальне значення `'.'` означає сам корінь (тоді `base = cwd`); для решти — `base = join(cwd, ws)`.

**Повертає.**

- `Promise<boolean>` — `true`, якщо в зазначеному workspace знайдено будь-який з маркерів Tauri:
  1. Існує каталог `<base>/src-tauri/` (`existsSync` + `statSync(...).isDirectory()`).
  2. Існує файл `<base>/src-tauri/Cargo.toml`.
  3. Існує файл `<base>/src-tauri/tauri.conf.json`.
  4. Існує файл `<base>/tauri.conf.json` (legacy flat-layout).
  5. `<base>/package.json` існує, парситься як JSON і `packageHasTauriDep(pkg)` повертає `true`.

Якщо `package.json` не існує — повертає `false` (умова `if (!existsSync(pkgPath)) return false`).

**Side effects.**

- Синхронні FS-виклики `existsSync`, `statSync` для каталогів і файлів.
- Асинхронне читання файла `readFile(pkgPath, 'utf8')`.
- `JSON.parse` — кидає виключення на некоректному JSON у `package.json` (без явного `try/catch` всередині). Викидається вгору як rejected promise.

---

### `projectHasTauriMarker()`

**Сигнатура.**

```js
async function projectHasTauriMarker(): Promise<boolean>
```

**Параметри.** Немає.

**Повертає.**

- `Promise<boolean>` — `true`, якщо хоча б один workspace (включаючи корінь) має маркер Tauri.

**Логіка.**

1. Бере `cwd = process.cwd()`.
2. Викликає `getMonorepoPackageRootDirs(cwd)` — отримує масив workspace-шляхів (корінь `'.'` + всі workspaces з `package.json#workspaces`).
3. Послідовно (через `for...of`) перевіряє кожен workspace через `workspaceHasTauriMarker`. На першому `true` — короткозамикає й повертає `true`.
4. Якщо жоден workspace не має маркера — повертає `false`.

**Side effects.** Опосередковано — через FS-виклики у `workspaceHasTauriMarker` та `getMonorepoPackageRootDirs`.

---

### `check()` — публічний експорт

**Сигнатура.**

```js
export async function check(): Promise<number>
```

**Параметри.** Немає.

**Повертає.**

- `Promise<number>` — exit-код перевірки, отриманий через `reporter.getExitCode()`:
  - `0` — успіх (немає маркера Tauri, або всі канонічні конфіги відповідають правилам).
  - `1` — є помилки (наприклад, `.vscode/extensions.json` не існує або не пройшов Rego-валідацію).

**Логіка покроково.**

1. Створює reporter: `const reporter = createCheckReporter()` і виймає шорткати `{ pass, fail }`.
2. Викликає `projectHasTauriMarker()`. Якщо маркера немає:
   - Записує `pass('Немає маркера Tauri (src-tauri/, tauri.conf.json, @tauri-apps/*) — tauri-tooling не вимагається')`.
   - Повертає `reporter.getExitCode()` — зазвичай `0` (бо тільки `pass`).
3. Якщо маркер є — записує `pass('Знайдено маркер Tauri — перевіряємо канонічні конфіги tauri.mdc')` і починає валідацію `.vscode/extensions.json`.
4. Перевіряє існування файла `.vscode/extensions.json` (відносний шлях від CWD):
   - Якщо файла немає — `fail(...)` з повідомленням, що треба створити з `recommendations "tauri-apps.tauri-vscode"`, і повертає `reporter.getExitCode()` (тут уже буде `1`).
5. Якщо файл існує — викликає `runConftestBatch({ policyDirRel: 'tauri/vscode_extensions', namespace: 'tauri.vscode_extensions', files: ['.vscode/extensions.json'] })`. Отримує масив `violations`.
6. Залежно від результату:
   - `violations.length === 0` → `pass(`${extPath} відповідає tauri.vscode_extensions (rego)`)`.
   - Інакше — для кожного `v` із `violations` викликає `fail(v.message)`.
7. Повертає `reporter.getExitCode()` — `0` або `1` залежно від накопичених `fail`-викликів.

**Side effects.**

- Читає `process.cwd()` (через залежні функції).
- FS-доступ: `existsSync`, `statSync`, `readFile` (через детектори маркера) і `existsSync` для `.vscode/extensions.json`.
- Запускає зовнішній двійковий процес `conftest` (опосередковано через `runConftestBatch`).
- Накопичує повідомлення в reporter (stdout / накопичувач залежить від реалізації `createCheckReporter`).

## Залежності

Імпорти модуля:

- **Стандартна бібліотека Node.js:**
  - `existsSync`, `statSync` із `node:fs` — синхронні FS-перевірки існування файлів/каталогів і типу запису.
  - `readFile` із `node:fs/promises` — асинхронне читання `package.json`.
  - `join` із `node:path` — побудова шляхів.
- **Локальні утиліти (з `../../../scripts/lib/`):**
  - `createCheckReporter` із `check-reporter.mjs` — фабрика звітувача з `pass`/`fail`/`getExitCode`.
  - `runConftestBatch` із `run-conftest-batch.mjs` — синхронний (за використанням у коді) виклик `conftest` для batch-валідації набору файлів проти Rego-полісі.
  - `getMonorepoPackageRootDirs` із `workspaces.mjs` — асинхронне отримання шляхів усіх workspace-пакетів монорепо (включаючи корінь `'.'`).

Зовнішні runtime-передумови:

- Виконуваний `conftest` має бути доступний у `PATH` (інакше `runConftestBatch` зафейлиться).
- Rego-полісі для namespace `tauri.vscode_extensions` має бути зареєстрований у глобальній теці полісі (без `target.json` поруч — це conditional-правило).

## Потік виконання / Використання

**Типове призначення.** Модуль викликається CLI-агрегатором правил (наприклад, `n-cursor` чи аналогом) у режимі перевірки. Він — один із багатьох `check()`-модулів, кожен з яких відповідає одному `.mdc`-правилу. `tooling.mjs` відповідає за частину `tauri.mdc`, що стосується VSCode tooling.

**Приклад прямого виклику:**

```js
import { check } from './npm/rules/tauri/js/tooling.mjs'

const code = await check()
process.exit(code)
```

**Послідовність виконання `check()`:**

1. **Ініціалізація reporter** → готовий до накопичення `pass`/`fail`.
2. **Gating (cross-file)** → `projectHasTauriMarker()`:
   - `getMonorepoPackageRootDirs(cwd)` повертає шляхи всіх workspaces.
   - Для кожного workspace перевіряємо 5 ознак (каталог `src-tauri/`, `Cargo.toml`, `tauri.conf.json` у двох локаціях, `@tauri-apps/*` у `package.json`).
   - Перший знайдений маркер → переходимо до валідації; інакше — `pass` + exit `0`.
3. **FS-існування** `.vscode/extensions.json` — якщо немає, `fail` з підказкою про канонічний контент і exit `1`.
4. **Делегування в Rego** через `runConftestBatch`:
   - `policyDirRel: 'tauri/vscode_extensions'` — відносний шлях до полісі.
   - `namespace: 'tauri.vscode_extensions'` — Rego-namespace для оцінки.
   - `files: ['.vscode/extensions.json']` — вхідні файли для batch-валідації.
5. **Звіт** — `pass` за нуль порушень, `fail(v.message)` для кожного `violation`.
6. **Повернення exit-коду** через `reporter.getExitCode()`.

**Поведінка при помилках.**

- Якщо `package.json` у якомусь workspace містить невалідний JSON — `JSON.parse` кине виключення; `projectHasTauriMarker` (і відповідно `check`) поверне rejected promise. Обробку покладено на викликальника.
- Якщо `conftest` не встановлено — помилку викине `runConftestBatch` (поведінка залежить від його реалізації).

**Інтеграційні зв'язки.**

- Правило в `.mdc`-форматі (зміст для людини) — `npm/rules/tauri/tauri.mdc` (або аналог; шукати в репо).
- Rego-полісі — десь у глобальній теці полісі під `tauri/vscode_extensions/` (адресовано через `policyDirRel`).
- Це conditional-правило: воно **не** реєструється автоматично в `n-cursor fix` як target-discoverable; орchestrator `tooling.mjs` сам гейтить виконання й сам викликає `conftest`.

## Rebuild Test

Опис достатній, щоб відтворити модуль з нуля:

1. Створити файл `tooling.mjs` з JSDoc-преамбулою, що описує мету та cross-file gating (5 ознак Tauri-маркера).
2. Імпортувати:
   - `existsSync`, `statSync` із `node:fs`;
   - `readFile` із `node:fs/promises`;
   - `join` із `node:path`;
   - `createCheckReporter` з `../../../scripts/lib/check-reporter.mjs`;
   - `runConftestBatch` з `../../../scripts/lib/run-conftest-batch.mjs`;
   - `getMonorepoPackageRootDirs` з `../../../scripts/lib/workspaces.mjs`.
3. Реалізувати `packageHasTauriDep(pkg)` — defensive guard + цикл по `['dependencies', 'devDependencies']` + перевірка `name.startsWith('@tauri-apps/')`.
4. Реалізувати `workspaceHasTauriMarker(cwd, ws)` — `base = ws === '.' ? cwd : join(cwd, ws)`, послідовні `existsSync`/`statSync` для каталогу `src-tauri/`, файлів `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json`, `tauri.conf.json`; fallback на `readFile(<base>/package.json)` + `JSON.parse` + `packageHasTauriDep`.
5. Реалізувати `projectHasTauriMarker()` — `process.cwd()`, `await getMonorepoPackageRootDirs(cwd)`, `for...of` з раннім `return true`.
6. Експортувати `async function check()`:
   - Створити reporter, дістати `pass`/`fail`.
   - Перевірити маркер; якщо немає — `pass(...)` + `return reporter.getExitCode()`.
   - Якщо є — `pass(...)`, потім гейт `.vscode/extensions.json`: відсутній → `fail(...)` + return.
   - Викликати `runConftestBatch({ policyDirRel: 'tauri/vscode_extensions', namespace: 'tauri.vscode_extensions', files: [extPath] })`.
   - На порожньому масиві порушень — `pass(...)`; інакше — цикл `fail(v.message)`.
   - Повернути `reporter.getExitCode()`.
