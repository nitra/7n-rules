# cargo_mutants_config.mjs

## Огляд

Файл реалізує концерн `cargo_mutants_config` правила `test` (відповідає правилу
`test.mdc`) для пакета `@nitra/cursor`. Призначення концерну — забезпечити, що
у кожному Cargo-крейті проєкту присутній файл `.cargo/mutants.toml` із
канонічним baseline-вмістом, який потрібен інструменту
[`cargo-mutants`](https://mutants.rs/) для запуску мутаційного тестування Rust.

Логіка self-gating: концерн виконується тільки якщо в `.n-cursor.json` правило
`rust` присутнє у списку `rules` і не присутнє у списку `disable-rules`. Якщо
правило `rust` вимкнене — функція мовчки повертає успіх. Якщо правило
ввімкнене, але в проєкті ще немає жодного `Cargo.toml` (наприклад, манифест
з'явиться пізніше) — функція теж мовчки повертає успіх, не вважаючи це
порушенням.

У разі, якщо canonical baseline-файл `data/cargo_mutants_config/mutants.toml.baseline`
відсутній у дистрибутиві `@nitra/cursor` (наприклад, через зламану інсталяцію),
концерн фейлить із вказівкою перевстановити пакет.

Для кожного знайденого `Cargo.toml` (cwd, всі workspace-члени, включно з
Tauri-патерном `src-tauri/Cargo.toml`) концерн перевіряє наявність файлу
`.cargo/mutants.toml` у відповідному каталозі манифеста. Якщо файл існує —
позначає його як pass і йде далі. Якщо не існує — створює каталог `.cargo/`
(`recursive: true`) та копіює canonical baseline у `.cargo/mutants.toml`.

Baseline-файл — порожній з коментарем; у `cargo-mutants` працюють робочі
defaults, тож фактичні налаштування не потрібні.

## Експорти / API

| Експорт | Тип                                             | Опис                                                                                             |
| ------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `check` | `async function(cwd?: string): Promise<number>` | Основна точка входу концерну. Повертає exit-код: `0` — OK або silently skipped, `1` — порушення. |

Інших експортів модуль не має. Константи `HERE` та `BASELINE_PATH` —
внутрішні, не експортуються.

## Функції

### `check(cwd = process.cwd())`

Асинхронна функція, що виконує перевірку та (за потреби) копіювання canonical
baseline `.cargo/mutants.toml` у кожен Cargo-крейт проєкту.

**Сигнатура:**

```js
export async function check(cwd = process.cwd()): Promise<number>
```

**Параметри:**

- `cwd` — `string`, необов'язковий. Корінь проєкту, у якому шукати
  `.n-cursor.json` та `Cargo.toml`. За замовчуванням — `process.cwd()`
  (підтримка CLI-сценарію виклику).

**Повертає:**

- `Promise<number>` — exit-код, який повертає `reporter.getExitCode()`:
  - `0` — концерн пройшов успішно (включно з випадками silently skip:
    rust не enabled або немає жодного Cargo.toml).
  - `1` — concer зафейлив (наприклад, відсутній canonical baseline у
    дистрибутиві `@nitra/cursor`).

**Алгоритм:**

1. Створює `reporter` через `createCheckReporter()`.
2. Читає `.n-cursor.json` через `readNCursorConfigLite(cwd)`, отримує
   `config.rules` і `config.disableRules`.
3. Self-gate: якщо `rust` не у `config.rules` або є у `config.disableRules` —
   повертає `reporter.getExitCode()` без жодних повідомлень.
4. Резолвить усі `Cargo.toml` у проєкті через
   `resolveAllCargoManifests(cwd)` (cwd, workspaces, Tauri-патерн).
5. Якщо манифестів немає — silently skip, повертає `reporter.getExitCode()`.
6. Перевіряє існування canonical baseline за шляхом `BASELINE_PATH`. Якщо
   файлу немає — `reporter.fail()` із рекомендацією перевстановити
   `@nitra/cursor` і повертає `reporter.getExitCode()`.
7. Ітерує по кожному `manifestPath`:
   - Обчислює `cargoDir = dirname(manifestPath)`.
   - Обчислює `target = join(cargoDir, '.cargo', 'mutants.toml')`.
   - Якщо `target` існує — `reporter.pass()` з повідомленням
     `.cargo/mutants.toml існує (<relative-path>)`, переходить до наступного
     манифеста.
   - Інакше — створює каталог `dirname(target)` (тобто `.cargo/`) із
     прапорцем `{ recursive: true }`, копіює `BASELINE_PATH` у `target`,
     повідомляє `reporter.pass()` з повідомленням
     `.cargo/mutants.toml створено з canonical baseline (<relative-path>) (test.mdc)`.
8. Повертає `reporter.getExitCode()`.

**Side effects:**

- Читання файлової системи: `.n-cursor.json` (через
  `readNCursorConfigLite`), `Cargo.toml` (через `resolveAllCargoManifests`),
  перевірка існування `BASELINE_PATH` і `target` (через `existsSync`).
- Запис у файлову систему:
  - Створення каталогу `.cargo/` у кожному cargo-крейті, де ще нема
    `.cargo/mutants.toml` (`mkdir` з `recursive: true`).
  - Копіювання `BASELINE_PATH` у `.cargo/mutants.toml` (`copyFile`).
- Виклики reporter (`pass` / `fail`) — у stdout/stderr формат залежить
  від реалізації `createCheckReporter`.

## Залежності

### Стандартна бібліотека Node.js

- `node:fs` — `existsSync`.
- `node:fs/promises` — `copyFile`, `mkdir`.
- `node:path` — `dirname`, `join`, `relative`.
- `node:url` — `fileURLToPath` (для обчислення абсолютного шляху до
  baseline через `import.meta.url`).

### Внутрішні модулі проєкту

- `../../../scripts/lib/check-reporter.mjs` — `createCheckReporter()`,
  фабрика репортера; об'єкт із методами `pass(msg)`, `fail(msg)`,
  `getExitCode()`.
- `../../../scripts/lib/read-n-cursor-config-lite.mjs` —
  `readNCursorConfigLite(cwd)`, читає `.n-cursor.json` і повертає об'єкт із
  полями `rules: string[]` і `disableRules: string[]`.
- `../../../scripts/utils/resolve-cargo-manifest.mjs` —
  `resolveAllCargoManifests(cwd)`, повертає масив абсолютних шляхів до всіх
  `Cargo.toml` у проєкті (cwd, workspace-члени, Tauri-патерн
  `src-tauri/Cargo.toml`).

### Файлові ресурси

- `data/cargo_mutants_config/mutants.toml.baseline` (відносно теки модуля,
  обчислюється через `HERE`) — canonical baseline `.cargo/mutants.toml`.
  Має бути частиною дистрибутиву `@nitra/cursor`. Порожній файл з
  коментарем, `cargo-mutants` використовує робочі defaults.

## Потік виконання / Використання

### Як викликається

Модуль експортує `check(cwd)`, яку диспетчер правила `test` (через
`test.mdc` / контрактний раннер `@nitra/cursor`) викликає під час перевірки
правил у проєкті. Можлива також CLI-сумісність — функція приймає
необов'язковий `cwd` і за замовчуванням використовує `process.cwd()`.

### Типовий сценарій

1. Користувач додає у `.n-cursor.json` правило `rust` (поза `disable-rules`).
2. Раннер виконує концерн `cargo_mutants_config` (через `check(cwd)`).
3. Концерн читає конфіг, проходить self-gate.
4. Концерн через `resolveAllCargoManifests` знаходить усі `Cargo.toml`
   (cwd, workspace-члени, `src-tauri/Cargo.toml` для Tauri-проєктів).
5. Для кожного манифеста, що не має `.cargo/mutants.toml`, файл
   створюється з canonical baseline; для тих, що вже мають — pass.
6. Раннер отримує exit-код `0` або `1` і агрегує його з рештою концернів.

### Сценарії silently skip

- `rust` не у `rules` — концерн не релевантний, скіп.
- `rust` у `disable-rules` — користувач свідомо вимкнув, скіп.
- Жодного `Cargo.toml` у проєкті — манифест ще не створено, скіп
  (не помилка).

### Сценарій порушення (`exit 1`)

- canonical baseline `data/cargo_mutants_config/mutants.toml.baseline`
  відсутній у дистрибутиві `@nitra/cursor` — інсталяція пакета зламана,
  потрібно перевстановити.

### Внутрішні константи

- `HERE = dirname(fileURLToPath(import.meta.url))` — абсолютний шлях до
  теки, де лежить цей `.mjs`.
- `BASELINE_PATH = join(HERE, 'data', 'cargo_mutants_config', 'mutants.toml.baseline')` —
  абсолютний шлях до canonical baseline. Шлях відраховується від
  розташування самого модуля, тому стабільний незалежно від `cwd`.
