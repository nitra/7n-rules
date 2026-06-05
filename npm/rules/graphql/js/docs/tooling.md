# tooling.mjs

## Огляд

Модуль `npm/rules/graphql/js/tooling.mjs` — це **check-скрипт правила `graphql.mdc`**, який перевіряє, що репозиторій налаштований для роботи з GraphQL за наявності у коді tagged template literals `gql\`...\``.

Логіка перевірки **умовна**:

1. Скрипт рекурсивно обходить дерево проєкту з кореня (`process.cwd()` за замовчуванням) і збирає файли-кандидати (`.vue`, `.js`, `.ts`, `.jsx`, `.tsx` тощо) — пропускаючи службові артефакти типу `.d.ts`, `auto-imports.d.ts` тощо.
2. Для кожного кандидата виконує AST-сканування (oxc-parser; для `.vue` — після витягування блоку `<script>`) у пошуках `gql` tagged template literal.
3. Якщо **жодного збігу не знайдено** — перевірка завершується успішно й нічого більше не вимагає.
4. Якщо `gql\`…\`` **знайдено хоча б в одному файлі** — модуль вимагає:
   - наявність файлу `.graphqlrc.yml` у корені репозиторію (GraphQL Config);
   - відповідність `.vscode/extensions.json` rego-пакету `graphql.vscode_extensions` (тобто рекомендацію розширення VS Code `graphql.vscode-graphql`).

Модуль є частиною інфраструктури `n-cursor` для перевірок правил `.mdc` і дотримується контракту check-скрипта: повертає exit code `0` при успіху й `1` при порушенні.

## Експорти / API

| Експорт                             | Тип                                        | Призначення                                                                             |
| ----------------------------------- | ------------------------------------------ | --------------------------------------------------------------------------------------- |
| `GRAPHQL_RC_FILENAME`               | `string` (const, `.graphqlrc.yml`)         | Очікувана назва файлу GraphQL Config у корені проєкту (з `graphql.mdc`).                |
| `REQUIRED_GRAPHQL_VSCODE_EXTENSION` | `string` (const, `graphql.vscode-graphql`) | Ідентифікатор обов'язкового розширення VS Code, яке має бути в `recommendations`.       |
| `check(cwd?)`                       | `async function`                           | Основна точка входу — виконує всю перевірку правила `graphql.mdc` і повертає exit code. |

Внутрішні (не експортовані) хелпери:

- `collectScanCandidates(root, ignorePaths)` — збір абсолютних шляхів файлів для сканування.
- `collectGqlHits(root, candidates)` — фільтрація кандидатів за наявністю `gql` tagged template.
- `checkExtensionsRecommendation(pass, fail, cwd)` — делегування перевірки `.vscode/extensions.json` rego-пакету `graphql.vscode_extensions` через `conftest`.

## Функції

### `collectScanCandidates(root, ignorePaths)`

**Сигнатура:**

```js
async function collectScanCandidates(root: string, ignorePaths: string[]): Promise<string[]>
```

**Параметри:**

- `root` — абсолютний шлях до кореня репозиторію, з якого починається обхід.
- `ignorePaths` — масив абсолютних шляхів каталогів, які повністю виключаються з обходу (формується через `loadCursorIgnorePaths`).

**Що робить:**

- Викликає `walkDir(root, visitor, ignorePaths)` (рекурсивний обхід файлової системи).
- Для кожного відвіданого файлу обчислює відносний шлях від `root`, нормалізує роздільники (Windows `\` → POSIX `/`).
- Застосовує два фільтри:
  - `shouldSkipFileForGqlScan(rel)` — пропуск службових файлів (`.d.ts`, `auto-imports.d.ts` тощо).
  - `isGqlScanSourceFile(rel)` — допуск лише відповідних розширень (Vue/JS/TS-сімейство).
- Накопичує **абсолютні** шляхи прийнятих файлів у масив `candidates`.

**Повертає:** `Promise<string[]>` — список абсолютних шляхів файлів-кандидатів.

**Side effects:** читає метадані файлової системи (через `walkDir`); записів не робить.

---

### `collectGqlHits(root, candidates)`

**Сигнатура:**

```js
async function collectGqlHits(root: string, candidates: string[]): Promise<string[]>
```

**Параметри:**

- `root` — абсолютний шлях до кореня (для обчислення відносних шляхів у результаті).
- `candidates` — список абсолютних шляхів файлів, отриманих від `collectScanCandidates`.

**Що робить:**

- Послідовно (`for-of` + `await`) для кожного абсолютного шляху:
  - обчислює відносний шлях і нормалізує роздільники до `/`;
  - читає вміст файлу через `readFile(absPath, 'utf8')`;
  - викликає `sourceFileHasGqlTaggedTemplate(content, rel)` — парсер AST oxc, що враховує особливості `.vue` (витягування `<script>`);
  - якщо результат `true` — додає **відносний** шлях до результуючого масиву `hits`.

**Повертає:** `Promise<string[]>` — відносні шляхи файлів, у яких знайдено хоча б одне `gql` tagged template.

**Side effects:** читання вмісту файлів з диска. Запис відсутній.

---

### `checkExtensionsRecommendation(pass, fail, cwd)`

**Сигнатура:**

```js
function checkExtensionsRecommendation(
  pass: (msg: string) => void,
  fail: (msg: string) => void,
  cwd: string
): void
```

**Параметри:**

- `pass` — функція-репортер «успішно» (отримана з `createCheckReporter()`).
- `fail` — функція-репортер «порушення».
- `cwd` — абсолютний корінь репозиторію.

**Що робить:**

1. Формує відносний (`.vscode/extensions.json`) і абсолютний шляхи до файлу VS Code-конфігу.
2. Якщо файл **не існує** (`existsSync`) — викликає `fail(...)` з повідомленням про те, що треба створити файл і додати `graphql.vscode-graphql` у `recommendations`, посилаючись на `graphql.mdc`. Виходить.
3. Інакше викликає `runConftestBatch({ policyDirRel: 'graphql/vscode_extensions', namespace: 'graphql.vscode_extensions', files: [pathAbs] })` — делегує перевірку rego-пакету conftest-у.
4. Якщо `violations.length === 0` — викликає `pass(...)` з повідомленням про відповідність. Інакше — для кожного порушення `v` викликає `fail(v.message)`.

**Повертає:** нічого (`void`). Результати фіксуються через `pass` / `fail`.

**Side effects:**

- читання `.vscode/extensions.json` через зовнішній conftest-процес;
- виклик `conftest` (binary) усередині `runConftestBatch`;
- зміна стану внутрішнього reporter-у (накопичення успіхів/порушень).

**Виклик умовний:** виконується лише після того, як основна функція `check` виявила `gql` у дереві.

---

### `check(cwd = process.cwd())`

**Сигнатура:**

```js
export async function check(cwd?: string): Promise<number>
```

**Параметри:**

- `cwd` — _необов'язковий_ абсолютний шлях до кореня репозиторію. За замовчуванням `process.cwd()`.

**Що робить (потік):**

1. Створює репортер `createCheckReporter()` і деструктурує з нього `pass`, `fail`.
2. Завантажує список ігнорованих шляхів через `loadCursorIgnorePaths(root)`.
3. Викликає `collectScanCandidates(root, ignorePaths)` — отримує список файлів-кандидатів.
4. Викликає `collectGqlHits(root, candidates)` — отримує файли з `gql`.
5. **Розгалуження:**
   - Якщо `hits.length === 0` — викликає `pass(...)` з повідомленням «немає `gql\`…\``у джерелах, переглянуто N файлів —`.graphqlrc.yml`не вимагається» і **повертає**`reporter.getExitCode()`(зазвичай`0`).
   - Інакше викликає `pass(...)` зі звітом про N файлів (з перших 5 з суфіксом `…` якщо більше).
6. Перевіряє наявність `GRAPHQL_RC_FILENAME` (`.graphqlrc.yml`) у корені через `existsSync`:
   - Існує → `pass('.graphqlrc.yml існує')`.
   - Не існує → `fail(...)` з вимогою додати GraphQL Config (з посиланням на `graphql.mdc`).
7. Викликає `checkExtensionsRecommendation(pass, fail, root)` для перевірки `.vscode/extensions.json`.
8. Повертає `reporter.getExitCode()`: `0` — усі перевірки пройдені, `1` — є хоча б одне порушення.

**Повертає:** `Promise<number>` — exit code (`0` — OK, `1` — порушення).

**Side effects:**

- читання файлової системи (метадані + вміст файлів кандидатів);
- читання `.cursor/...` ignore-конфігу;
- читання `.vscode/extensions.json` (опосередковано через conftest);
- запуск процесу `conftest` через `runConftestBatch`;
- мутація стану внутрішнього reporter-у (накопичення pass/fail-повідомлень).

## Залежності

### Node.js builtins

| Модуль             | Що використовується | Призначення                                                                  |
| ------------------ | ------------------- | ---------------------------------------------------------------------------- |
| `node:fs`          | `existsSync`        | Синхронна перевірка наявності `.graphqlrc.yml` та `.vscode/extensions.json`. |
| `node:fs/promises` | `readFile`          | Асинхронне читання вмісту файлів-кандидатів.                                 |
| `node:path`        | `join`, `relative`  | Збирання абсолютних шляхів і обчислення відносних шляхів від кореня.         |

### Внутрішні модулі репозиторію

- `../../../scripts/lib/check-reporter.mjs` — `createCheckReporter`: фабрика репортера зі стандартним інтерфейсом `pass` / `fail` / `getExitCode()`.
- `../lib/graphql-gql-scan.mjs`:
  - `isGqlScanSourceFile(rel)` — предикат «це source-файл, який потенційно містить `gql`» (за розширенням);
  - `shouldSkipFileForGqlScan(rel)` — предикат «цей файл слід ігнорувати при скануванні» (`.d.ts`, `auto-imports.d.ts` тощо);
  - `sourceFileHasGqlTaggedTemplate(content, rel)` — AST-перевірка на наявність `gql\`...\``(через oxc-parser; для`.vue`— після витягування`<script>`).
- `../../../scripts/lib/load-cursor-config.mjs` — `loadCursorIgnorePaths(root)`: повертає абсолютні шляхи каталогів, повністю виключених з обходу (узгоджено з іншими check-скриптами).
- `../../../scripts/lib/run-conftest-batch.mjs` — `runConftestBatch({ policyDirRel, namespace, files })`: запускає `conftest` з rego-пакетом і повертає масив `violations` (об'єкти з `.message`).
- `../../../scripts/utils/walkDir.mjs` — `walkDir(root, visitor, ignorePaths)`: рекурсивний обхід файлової системи з підтримкою списку ігнорування.

### Зовнішні артефакти (не імпортуються, але потрібні в runtime)

- **`conftest`** як CLI-binary (запускається з `runConftestBatch`).
- **Rego-політика** в `graphql/vscode_extensions` з namespace `graphql.vscode_extensions` (перевіряє `.vscode/extensions.json`).
- **`.cursor/ignore`-конфіг** у корені (читається `loadCursorIgnorePaths`).
- **`graphql.mdc`** — правило, яке цей check реалізує.

## Потік виконання / Використання

### Запуск як check

Модуль використовується з єдиною експортованою функцією `check`:

```js
import { check } from 'npm/rules/graphql/js/tooling.mjs'

const exitCode = await check() // або await check('/absolute/path/to/repo')
process.exit(exitCode)
```

Типово викликається диспетчером check-скриптів інфраструктури `n-cursor` (наприклад, із `npm/scripts/...`), який отримує exit code й агрегує результати по всіх правилах `.mdc`.

### Послідовність дій усередині `check`

```
process.cwd() (або переданий cwd)
        │
        ▼
createCheckReporter() ──► { pass, fail, getExitCode }
        │
        ▼
loadCursorIgnorePaths(root) ──► ignorePaths
        │
        ▼
collectScanCandidates(root, ignorePaths)
        │   walkDir(root, visitor, ignorePaths)
        │     filter: !shouldSkipFileForGqlScan && isGqlScanSourceFile
        ▼
candidates: string[]
        │
        ▼
collectGqlHits(root, candidates)
        │   for each: readFile + sourceFileHasGqlTaggedTemplate (oxc-parser AST)
        ▼
hits: string[]
        │
        ├── hits.length === 0 ──► pass("немає gql у джерелах") ──► return 0
        │
        └── hits.length > 0
              │
              ├── pass("Знайдено gql у N файлі(ах): ...")
              │
              ├── existsSync(.graphqlrc.yml)
              │     ├── true  ──► pass(".graphqlrc.yml існує")
              │     └── false ──► fail("Відсутній .graphqlrc.yml ...")
              │
              ├── checkExtensionsRecommendation(pass, fail, root)
              │     ├── !existsSync(.vscode/extensions.json) ──► fail(...)
              │     └── runConftestBatch(graphql/vscode_extensions)
              │           ├── violations.length === 0 ──► pass(...)
              │           └── for v of violations: fail(v.message)
              │
              └── return reporter.getExitCode() (0 або 1)
```

### Семантика повідомлень

- `pass` — інформативне повідомлення про успішну перевірку (логнеться як OK, не впливає на exit code).
- `fail` — повідомлення про порушення; навіть одне `fail` робить `getExitCode()` рівним `1`.

### Чому перевірка умовна

`graphql.mdc` вимагає `.graphqlrc.yml` і VS Code-розширення `graphql.vscode-graphql` **лише** для проєктів, де реально використовуються `gql` tagged template literals. У монорепо це дозволяє не «спамити» правилом workspace-и, що не торкаються GraphQL — check спочатку доводить релевантність (`hits.length > 0`), і лише потім вимагає інфраструктуру.

### Обмеження та особливості

- Шляхи в `hits` та в попередженнях завжди **відносні** до `root`, з POSIX-роздільниками `/` (навіть на Windows).
- Перші 5 файлів-збігів показуються у повідомленні `pass`; решта приховується за суфіксом `…`.
- Якщо `gql` знайдено, але `.vscode/extensions.json` відсутній — це порушення, незалежне від rego-перевірки (тобто `fail` без виклику conftest).
- `collectGqlHits` читає файли **послідовно** (без `Promise.all`) — це навмисно, щоб не перевантажувати I/O при великих репозиторіях.
- Виявлення `gql` — на рівні AST (oxc-parser), а не регулярних виразів; рядкові збіги типу `// gql\`...\`` у коментарі не дають false-positive.
