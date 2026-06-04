# cargo_mutants_config.mjs

## Огляд

Модуль реалізує концерн `cargo_mutants_config` правила `tauri.mdc`. Його завдання — гарантувати, що для кожного workspace-пакета монорепо, у якому існує `<workspace>/src-tauri/Cargo.toml`, поряд лежить канонічний Tauri-специфічний конфіг `cargo-mutants` за шляхом `<workspace>/src-tauri/.cargo/mutants.toml`. Конфіг забороняє повторну збірку бінарників (`--bins`) і doc-tests (`--doc`) під кожного мутанта (це перетворює секунди на хвилини) і виключає з mutation-testing platform-bridge файли, які тестуються smoke/e2e, а не unit-тестами.

Семантика виключень фіксована для всіх Tauri-проєктів:

- `src/main.rs` — binary shell entrypoint (smoke/e2e, не mutation unit);
- `src/lib.rs` — Tauri `pub fn run`, runtime entrypoint, який запускає увесь app shell (один мутант там тримає увесь Tauri runtime і ділить sandbox-fail з `src/main.rs`);
- `src/**/{android,ios,mobile}.rs` — mobile plugin bridge / platform glue;
- `src/**/{macos,windows,linux,desktop}.rs` — desktop platform bridge / OS integration glue.

Файл побудований за патерном concern-checker у репо: експортує одну функцію `check(cwd)`, яка:

- self-gates (тихо пропускає, якщо у монорепо немає жодного `src-tauri/Cargo.toml` — нейтральний baseline за потреби створить test rule);
- ідемпотентна — створює файл лише за відсутності, інакше дописує лише ті top-level ключі, яких бракує, не змінюючи існуючих значень користувача;
- репортує результат через спільний `createCheckReporter` і повертає process exit code (`0` — OK або skip, `1` — порушення).

## Експорти / API

| Експорт | Тип | Опис |
| --- | --- | --- |
| `check(cwd?)` | `async function` | Єдиний публічний експорт. Запускає концерн над переданим або поточним коренем проєкту. Повертає `Promise<number>` — exit code, сумісний з CLI-обгорткою. |

Внутрішні (не експортуються) допоміжні функції: `findSrcTauriDirs`, `detectMissingKeys`, `buildAppended`, `buildBaseline`, `processOneSrcTauri`.

Внутрішні константи модульного рівня:

- `TAURI_BASELINE_HEADER` — рядковий заголовок (коментар) для нового файла з посиланням на `tauri.mdc` і поясненням, чому виключаються `--bins` та `--doc`.
- `TAURI_KEY_SNIPPETS` — заморожений (`Object.freeze`) словник `{ ключ → канонічний TOML-сніпет з блоковими коментарями }` для двох канонічних top-level ключів: `additional_cargo_test_args` і `exclude_globs`.
- `TAURI_CANONICAL_KEYS` — заморожений масив ключів `TAURI_KEY_SNIPPETS` зі збереженим порядком (`Object.keys(TAURI_KEY_SNIPPETS)`); використовується для впорядкованого детектування відсутніх ключів і генерації baseline.

Канонічний вміст сніпетів:

- `additional_cargo_test_args = ["--lib", "--tests"]` — `cargo mutants` під час прогону тестів обмежується library + integration tests, без бінарників і doc-tests.
- `exclude_globs = [...]` — список glob-патернів, які виключаються з mutation-testing (див. розділ «Огляд»).

## Функції

### `check(cwd = process.cwd())`

- **Сигнатура:** `async function check(cwd?: string): Promise<number>`.
- **Параметри:**
  - `cwd` *(string, опційний, default `process.cwd()`)* — абсолютний шлях до кореня монорепо. Дефолт забезпечує CLI-сумісність (виклик без аргументів з-під будь-якого `bin`).
- **Повертає:** `Promise<number>` — exit code від `reporter.getExitCode()` (`0` — успіх або self-skip, `1` — є зафіксовані `reporter.fail(...)`).
- **Алгоритм:**
  1. Створює інстанс репортера через `createCheckReporter()`.
  2. Знаходить усі `src-tauri/` директорії через `findSrcTauriDirs(cwd)`.
  3. Якщо їх немає — повертає `reporter.getExitCode()` без жодних змін (self-gate / silent skip).
  4. Інакше — послідовно обробляє кожен каталог через `processOneSrcTauri(dir, cwd, reporter)`.
  5. Повертає підсумковий exit code від репортера.
- **Side effects:** може створювати теку `<src-tauri>/.cargo/` і записувати в `<src-tauri>/.cargo/mutants.toml`; пише повідомлення (`pass`/`fail`) у спільний репортер.

### `findSrcTauriDirs(cwd)`

- **Сигнатура:** `async function findSrcTauriDirs(cwd: string): Promise<string[]>`.
- **Параметри:** `cwd` — корінь проєкту.
- **Повертає:** масив абсолютних шляхів до `src-tauri/` каталогів, які мають власний `Cargo.toml`.
- **Алгоритм:**
  1. Запитує всі workspace-пакети через `getMonorepoPackageRootDirs(cwd)` (включно з самим коренем).
  2. Для кожного `root` перевіряє наявність `join(cwd, root, 'src-tauri', 'Cargo.toml')` через `existsSync`.
  3. Якщо файл існує — додає `join(cwd, root, 'src-tauri')` до результату.
- **Side effects:** немає (read-only через `existsSync` і виклик util-функції монорепо-обходу).

### `detectMissingKeys(targetPath)`

- **Сигнатура:** `async function detectMissingKeys(targetPath: string): Promise<string[]>`.
- **Параметри:** `targetPath` — абсолютний шлях до існуючого `.cargo/mutants.toml`.
- **Повертає:** масив канонічних ключів (з `TAURI_CANONICAL_KEYS`), яких немає на top-level у вже існуючому TOML, зі збереженим порядком.
- **Алгоритм:**
  1. Читає файл як UTF-8.
  2. Парсить його через `parseToml` зі `smol-toml`.
  3. Фільтрує `TAURI_CANONICAL_KEYS`, лишаючи лише ті, яких немає в розпарсеному об'єкті (`!(k in parsed)`).
- **Side effects:** read-only (читання файла).

### `buildAppended(existing, missingKeys)`

- **Сигнатура:** `function buildAppended(existing: string, missingKeys: string[]): string`.
- **Параметри:**
  - `existing` — поточний текстовий вміст `.cargo/mutants.toml`;
  - `missingKeys` — ключі, які треба дописати.
- **Повертає:** новий вміст файла (`string`) — оригінал + хвостовий блок з коментарем-маркером `# Tauri canonical cargo-mutants additions (tauri.mdc)` і конкатенованими TOML-сніпетами для всіх `missingKeys` у порядку, наданому викликачем.
- **Алгоритм:**
  1. Нормалізує хвіст оригіналу: гарантує trailing `\n`.
  2. Будує блок: порожній рядок-розділювач, заголовок-коментар, далі для кожного ключа з `missingKeys` — відповідний сніпет з `TAURI_KEY_SNIPPETS[key]`.
  3. Конкатенує хвіст з блоком.
- **Side effects:** немає (чиста функція).

### `buildBaseline()`

- **Сигнатура:** `function buildBaseline(): string`.
- **Параметри:** немає.
- **Повертає:** повний текст канонічного `.cargo/mutants.toml` — `TAURI_BASELINE_HEADER`, після нього сніпети всіх `TAURI_CANONICAL_KEYS` (`additional_cargo_test_args`, `exclude_globs`), з'єднані через `'\n'`.
- **Side effects:** немає (чиста функція).

### `processOneSrcTauri(srcTauriDir, cwd, reporter)`

- **Сигнатура:** `async function processOneSrcTauri(srcTauriDir: string, cwd: string, reporter: { pass(msg): void, fail(msg): void }): Promise<void>`.
- **Параметри:**
  - `srcTauriDir` — абсолютний шлях до `src-tauri/` каталогу;
  - `cwd` — корінь проєкту (потрібен для красивого relative-шляху в репорт-повідомленнях);
  - `reporter` — інстанс репортера з методами `pass(msg)`/`fail(msg)`.
- **Повертає:** `Promise<void>`.
- **Алгоритм / гілки:**
  1. Формує `target = join(srcTauriDir, '.cargo', 'mutants.toml')` і `rel = relative(cwd, target)`.
  2. **Файла немає:** створює директорію `<src-tauri>/.cargo/` (`mkdir … { recursive: true }`), записує повний `buildBaseline()`, репортує `pass`: `.cargo/mutants.toml створено з Tauri canonical baseline (<rel>) (tauri.mdc)`; вихід.
  3. **Файл є:** викликає `detectMissingKeys(target)`.
     - Якщо `missing.length === 0` — репортує `pass`: `.cargo/mutants.toml: manual cargo-mutants config preserved (<rel>)`; вихід.
     - Інакше — читає поточний вміст, обчислює новий через `buildAppended(existing, missing)`, записує файл, репортує `pass`: `.cargo/mutants.toml: додано відсутні Tauri-ключі [<key1>, <key2>] (<rel>) (tauri.mdc)`.
- **Side effects:** створює директорії, записує/перезаписує файл `mutants.toml`, додає `pass`-повідомлення в репортер. У поточній реалізації функція не викликає `reporter.fail` — концерн є строго ідемпотентно-fix-овим (немає сценарію «порушення»).

## Залежності

### Node.js core (вбудовані)

- `node:fs` — `existsSync` для check'у наявності `Cargo.toml` / `mutants.toml`;
- `node:fs/promises` — `mkdir`, `readFile`, `writeFile` (промісована I/O для запису конфіга);
- `node:path` — `dirname`, `join`, `relative` (побудова цільового шляху та relative-вивід у репорт).

### External

- `smol-toml` (іменований імпорт `parse as parseToml`) — лояльний TOML-парсер для детекції наявних top-level ключів у існуючому `mutants.toml`.

### Internal (workspace utilities)

- `../../../scripts/lib/check-reporter.mjs` → `createCheckReporter()` — спільний reporter pass/fail/exit-code для concern-checker'ів.
- `../../../scripts/lib/workspaces.mjs` → `getMonorepoPackageRootDirs(cwd)` — повертає корінь + усі workspace-пакети монорепо.

## Потік виконання / Використання

### Типовий виклик з CLI / rule-runner

Модуль — частина правила `tauri.mdc`, його `check`-функцію викликає rule-runner (як один з концернів). Приблизний псевдо-виклик:

```js
import { check } from './cargo_mutants_config.mjs'

const exitCode = await check(process.cwd())
process.exit(exitCode)
```

### Послідовність дій усередині одного запуску

1. `check(cwd)` створює репортер.
2. `findSrcTauriDirs(cwd)` обходить пакети монорепо й збирає всі `src-tauri/` з `Cargo.toml`.
3. Якщо пусто — `return reporter.getExitCode()` (тихий skip, нічого не пишемо).
4. Для кожного знайденого `src-tauri/`:
   - якщо `.cargo/mutants.toml` відсутній → `mkdir -p` + запис canonical baseline;
   - якщо файл існує + усі канонічні ключі присутні → нічого не змінює, репорт `manual cargo-mutants config preserved`;
   - якщо файл існує, але деякі канонічні ключі відсутні → дописує лише відсутні ключі окремим блоком у кінці файла.
5. Повертає підсумковий exit code.

### Гарантії

- **Self-gating:** концерн нічого не робить, якщо в репо немає Tauri-пакетів — це не помилка.
- **Ідемпотентність:** повторні прогони на чистому/повному canonical файлі не змінюють вмісту.
- **Non-destructive:** ані наявні значення `additional_cargo_test_args`/`exclude_globs`, ані сторонні top-level ключі користувача не перезаписуються — додавання відсутніх ключів відбувається окремим append-блоком в кінці файла з коментарем-маркером.
- **Read-once-write-once на один каталог:** при append-сценарії файл читається повторно (один раз для парсу через `detectMissingKeys`, ще раз як текст для конкатенації), що гарантує запис рівно одного фінального вмісту.

### Точки розширення

- Додати новий канонічний top-level ключ: додати пару `key → snippet\n` у `TAURI_KEY_SNIPPETS`; `TAURI_CANONICAL_KEYS` та логіка `buildBaseline`/`buildAppended`/`detectMissingKeys` підхоплять його автоматично, зі збереженим порядком вставки.
- Змінити список platform-bridge файлів: відредагувати `exclude_globs` сніпет у `TAURI_KEY_SNIPPETS`.

### Rebuild Test

Файл містить достатню інформацію, щоб реконструювати правило з нуля: визначені вхідні точки виявлення Tauri-пакетів, перелік канонічних top-level ключів конфіга, форма заголовка/коментарів у згенерованому файлі, точні повідомлення репортера, гарантії ідемпотентності та non-destructive append, повний контракт експортованої функції `check(cwd)` (включно з дефолтом і поверненим типом).
