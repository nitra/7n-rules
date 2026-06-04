# hooks.mjs

## Огляд

Модуль `npm/rules/adr/js/hooks.mjs` — це скрипт-перевірник (check) правила `adr.mdc` пакета `@nitra/cursor`. Його завдання — переконатися, що в репозиторії-споживачі правильно встановлені та підтримуються ADR (Architecture Decision Records) Stop-hook'и для двох LLM-середовищ: Claude Code та Cursor Agent.

Skрипт перевіряє, що:

- Канонічні bash-скрипти `capture-decisions.sh` і `normalize-decisions.sh` присутні у `.claude/hooks/` цільового репо й байт-у-байт збігаються з версіями, які поставляє npm-пакет у `.claude-template/hooks/` (sync керує файлами повністю — будь-яке локальне редагування фіксується як `fail`).
- Файл `.claude/settings.json` (project-shared конфіг Claude Code) існує — глибша валідація `hooks.Stop[]` робиться окремими policy-правилами (`npm/policy/adr/settings_json/`, `npm/policy/adr/settings_local_json/`).
- Файл `.cursor/hooks.json` валідний JSON і містить у `hooks.stop[]` entries з `command`, що посилаються на обидва managed-скрипти (це дозволяє Cursor Agent також запускати ADR capture/normalize по `stop`-події).
- `.gitignore` у корені покриває лог-файли `.claude/hooks/capture-decisions.log` і `.claude/hooks/normalize-decisions.log`, інакше runtime-логи потраплятимуть у git.
- Наявність LLM CLI (`claude` або `cursor-agent`) у `PATH` — це **інформативна** перевірка (warning через `pass`-меседж), бо хук без CLI просто мовчки no-op'ає, а не фейлиться.

Модуль експортує єдину асинхронну функцію `check(cwd)`, яка повертає numeric exit-code (0 = OK, 1 = є проблеми). Усе зведення результатів і форматування проходить через `createCheckReporter()` з `npm/scripts/lib/check-reporter.mjs`.

## Експорти / API

| Назва | Тип | Призначення |
| ----- | --- | ----------- |
| `check` | `async (cwd?: string) => Promise<number>` | Єдиний публічний експорт. Запускає весь набір перевірок правила `adr.mdc` для дерева репозиторію за шляхом `cwd` (default — `process.cwd()`). Повертає 0 при повному success або 1, якщо принаймні одна перевірка зафейлилась. |

Усі інші ідентифікатори файлу (`HOOK_ARTIFACTS`, `PROJECT_SETTINGS_REL`, `CURSOR_HOOKS_REL`, `EOL_RE`, `BUNDLED_HOOKS_DIR`, `projectHookPath`, `projectLogPath`, `gitignoreLineCoversHookLog`, `checkHookScript`, `checkProjectSettings`, `readJsonSafe`, `cursorConfigHasStopHook`, `checkCursorHooks`, `checkGitignoreForLog`, `checkGitignore`, `isBinaryInPath`, `checkLlmCliAvailable`) — внутрішні (module-private).

## Функції

### `projectHookPath(scriptName)`

- **Сигнатура:** `(scriptName: string) => string`
- **Параметри:**
  - `scriptName` — базове ім'я hook-скрипта (наприклад `capture-decisions.sh`).
- **Повертає:** відносний шлях вигляду `.claude/hooks/<scriptName>`.
- **Side effects:** немає (чиста функція конкатенації шляху).

### `projectLogPath(logName)`

- **Сигнатура:** `(logName: string) => string`
- **Параметри:**
  - `logName` — базове ім'я лог-файлу (наприклад `capture-decisions.log`).
- **Повертає:** відносний шлях вигляду `.claude/hooks/<logName>`.
- **Side effects:** немає.

### `gitignoreLineCoversHookLog(line, logPath)`

- **Сигнатура:** `(line: string, logPath: string) => boolean`
- **Параметри:**
  - `line` — одна нормалізована (trim) лінія з `.gitignore`.
  - `logPath` — шлях до конкретного лог-файлу, який треба покрити.
- **Повертає:** `true`, якщо рядок покриває цей лог. Підтримує матчі:
  - точний шлях (`logPath`);
  - glob `.claude/hooks/*.log` або `.claude/hooks/**/*.log`;
  - широкий glob `*.log` або `**/*.log`.
  - Порожні рядки та коментарі (`#…`) ігноруються.
- **Side effects:** немає.

### `checkHookScript(reporter, cwd, scriptName)`

- **Сигнатура:** `async (reporter: CheckReporter, cwd: string, scriptName: string) => Promise<void>`
- **Параметри:**
  - `reporter` — інстанс, створений `createCheckReporter()`; з нього використовуються `pass` і `fail`.
  - `cwd` — корінь репозиторію-споживача.
  - `scriptName` — базове ім'я hook-скрипта.
- **Повертає:** нічого (звітує результат через reporter).
- **Поведінка:**
  1. Якщо `<cwd>/.claude/hooks/<scriptName>` не існує → `fail` з підказкою запустити `npx @nitra/cursor`.
  2. Якщо канонічний скрипт у пакеті (`<пакет>/.claude-template/hooks/<scriptName>`, обчислюється від `import.meta.url`) не існує → `fail` про перевстановлення `@nitra/cursor`.
  3. Інакше читає обидва файли паралельно через `Promise.all`+`readFile` і порівнює як рядки UTF-8. При повному збігу — `pass`, інакше — `fail` із підказкою про повторний sync.
- **Side effects:** файлова система — `existsSync`, `readFile`. Мутує внутрішній стан репортера.

### `checkProjectSettings(reporter, cwd)`

- **Сигнатура:** `(reporter: CheckReporter, cwd: string) => void`
- **Параметри:**
  - `reporter` — репортер для збору результату.
  - `cwd` — корінь репозиторію.
- **Повертає:** нічого.
- **Поведінка:** перевіряє лише факт наявності `.claude/settings.json` (`existsSync`). `pass`, якщо файл є, інакше — `fail` з підказкою про `npx @nitra/cursor`. Глибша валідація структури `hooks.Stop[]` навмисно винесена в policy-правила `adr.settings_json` і `adr.settings_local_json`.
- **Side effects:** одне `existsSync`.

### `readJsonSafe(path)`

- **Сигнатура:** `async (path: string) => Promise<unknown | null>`
- **Параметри:**
  - `path` — шлях до JSON-файлу.
- **Повертає:** результат `JSON.parse(await readFile(path, 'utf8'))` або `null`, якщо читання чи парсинг кинули виняток.
- **Side effects:** читання файлу; виняток придушується try/catch і конвертується у `null`.

### `cursorConfigHasStopHook(config, marker)`

- **Сигнатура:** `(config: unknown, marker: string) => boolean`
- **Параметри:**
  - `config` — попередньо розпарсений вміст `.cursor/hooks.json`.
  - `marker` — підрядок, який має зустрічатися в `command` шуканого entry (зазвичай — шлях до managed hook-скрипта, наприклад `.claude/hooks/capture-decisions.sh`).
- **Повертає:** `true`, якщо у `config.hooks.stop` є щонайменше один елемент-об'єкт з рядковим `command`, який містить `marker`. Кожен крок обходу (`config` — об'єкт-не-масив, `hooks` — об'єкт-не-масив, `stop` — масив) явно валідовано, тож не-канонічна структура повертає `false` без винятків.
- **Side effects:** немає.

### `checkCursorHooks(reporter, cwd)`

- **Сигнатура:** `async (reporter: CheckReporter, cwd: string) => Promise<void>`
- **Параметри:**
  - `reporter` — репортер.
  - `cwd` — корінь репо.
- **Повертає:** нічого.
- **Поведінка:**
  1. Якщо `.cursor/hooks.json` не існує — `fail` (запропонувати `npx @nitra/cursor`).
  2. Інакше парсить через `readJsonSafe`. Якщо повернуло `null` — `fail` ("не парситься як JSON").
  3. Для кожного елемента `HOOK_ARTIFACTS` обчислює marker через `projectHookPath(scriptName)` і шукає stop-entry за допомогою `cursorConfigHasStopHook`. На кожен скрипт — окремий `pass` або `fail`.
- **Side effects:** читання файлу, мутація стану репортера.

### `checkGitignoreForLog(reporter, logName, gitignoreContent)`

- **Сигнатура:** `(reporter: CheckReporter, logName: string, gitignoreContent: string) => void`
- **Параметри:**
  - `reporter` — репортер.
  - `logName` — базове ім'я лог-файлу.
  - `gitignoreContent` — наперед прочитаний вміст `.gitignore` (передається ззовні, щоб не читати файл двічі).
- **Повертає:** нічого.
- **Поведінка:** розбиває контент по `EOL_RE` (`\r?\n`), тримує кожну лінію та перевіряє через `gitignoreLineCoversHookLog`. Якщо хоч одна лінія покриває шлях — `pass`, інакше — `fail` з підказкою додати рядок.
- **Side effects:** мутація стану репортера.

### `checkGitignore(reporter, cwd)`

- **Сигнатура:** `async (reporter: CheckReporter, cwd: string) => Promise<void>`
- **Параметри:**
  - `reporter` — репортер.
  - `cwd` — корінь репо.
- **Повертає:** нічого.
- **Поведінка:**
  1. Якщо `.gitignore` у корені відсутній — викидає по `fail` на кожен `HOOK_ARTIFACTS.logName` (один fail для кожного логу окремо, а не один загальний).
  2. Інакше один раз читає файл і прокручує `HOOK_ARTIFACTS`, делегуючи кожен лог у `checkGitignoreForLog`.
- **Side effects:** одне `readFile`, кілька викликів `fail`/`pass` через репортер.

### `isBinaryInPath(name)`

- **Сигнатура:** `(name: string) => boolean`
- **Параметри:**
  - `name` — ім'я бінарника без розширення.
- **Повертає:** `true`, якщо у каталогах `process.env.PATH` (розділених `path.delimiter`) знайдено файл з таким іменем. Чек робиться через `existsSync(join(dir, name))` — без виклику `spawn`/`child_process`, тому не залежить від executable-біта і працює як легкий `which`.
- **Side effects:** читання env через `node:process` + `existsSync` на кожен каталог `PATH`.

### `checkLlmCliAvailable(reporter)`

- **Сигнатура:** `(reporter: CheckReporter) => void`
- **Параметри:**
  - `reporter` — репортер.
- **Повертає:** нічого.
- **Поведінка:** перевіряє `isBinaryInPath('claude')` та `isBinaryInPath('cursor-agent')`. Виводить **завжди `pass`** з одним із чотирьох повідомлень (обидва знайдено / лише `claude` / лише `cursor-agent` / жодного). Це навмисний дизайн — відсутність CLI означає, що hook просто no-op'ає й не валить білд.
- **Side effects:** мутація стану репортера (тільки `pass`-меседжі).

### `check(cwd?)` *(експорт)*

- **Сигнатура:** `async (cwd?: string) => Promise<number>`
- **Параметри:**
  - `cwd` — корінь репо. За замовчуванням — `process.cwd()`.
- **Повертає:** exit-code зі `reporter.getExitCode()` (0 або 1).
- **Поведінка (порядок виконання):**
  1. Створює свіжий репортер через `createCheckReporter()`.
  2. Послідовно (через `for…of` + `await`) для кожного `HOOK_ARTIFACTS` запускає `checkHookScript`.
  3. Викликає `checkProjectSettings` (синхронно).
  4. Викликає `await checkCursorHooks`.
  5. Викликає `await checkGitignore`.
  6. Викликає `checkLlmCliAvailable` (синхронно).
  7. Повертає `reporter.getExitCode()`.
- **Side effects:** усі ті, що зведено у внутрішніх перевірках (FS read, env read).

## Константи модуля

| Ім'я | Тип/значення | Призначення |
| ---- | ------------ | ----------- |
| `HOOK_ARTIFACTS` | `readonly [{ scriptName, logName }, …]` | Перелік hook-артефактів (`capture-decisions.sh`+`.log`, `normalize-decisions.sh`+`.log`), які перевіряються однотипно. `as const` через JSDoc-каст `/** @type {const} */`. |
| `PROJECT_SETTINGS_REL` | `'.claude/settings.json'` | Project-shared конфіг Claude Code. |
| `CURSOR_HOOKS_REL` | `'.cursor/hooks.json'` | Конфіг Cursor Agent. |
| `EOL_RE` | `/\r?\n/u` | Регекс для split рядків `.gitignore` (підтримує LF і CRLF). |
| `here` | `string` | Каталог цього модуля, обчислений через `fileURLToPath(import.meta.url)` + `dirname`. |
| `BUNDLED_HOOKS_DIR` | `string` | Абсолютний шлях до `.claude-template/hooks/` усередині пакета `@nitra/cursor`: `<here>/../../../.claude-template/hooks`. Використовується як джерело канонічних скриптів. |

## Залежності

### Node.js builtins

- `node:fs` → `existsSync` — синхронна перевірка наявності файлу.
- `node:fs/promises` → `readFile` — асинхронне читання UTF-8 контенту.
- `node:path` → `delimiter`, `dirname`, `join` — крос-платформне склеювання шляхів і split `PATH`.
- `node:process` → `env` — доступ до `PATH` для пошуку LLM CLI.
- `node:url` → `fileURLToPath` — конверсія `import.meta.url` у локальний шлях для обчислення `BUNDLED_HOOKS_DIR`.

### Внутрішні модулі пакета

- `../../../scripts/lib/check-reporter.mjs` → `createCheckReporter` — фабрика репортера з API `{ pass(msg), fail(msg), getExitCode() }`. Усі результати модуля проходять через нього.

### Зовнішні файли репо-споживача (читаються, не модифікуються)

- `<cwd>/.claude/hooks/capture-decisions.sh`, `<cwd>/.claude/hooks/normalize-decisions.sh` — managed bash-скрипти.
- `<cwd>/.claude/settings.json` — project-shared Claude config.
- `<cwd>/.cursor/hooks.json` — Cursor Agent hooks config.
- `<cwd>/.gitignore` — для перевірки покриття лог-файлів.

### Файли пакета (джерело істини для diff)

- `<package-root>/.claude-template/hooks/capture-decisions.sh`
- `<package-root>/.claude-template/hooks/normalize-decisions.sh`

Шлях обчислюється статично від `import.meta.url` — модуль не залежить від `process.cwd()` для пошуку bundled-файлів.

## Потік виконання / Використання

### Як модуль викликається

Скрипт — частина уніфікованої check-системи `@nitra/cursor`. Зовнішній рантайм (`npx @nitra/cursor check` або еквівалент у тестах) імпортує функцію `check` і викликає її:

```js
import { check } from '@nitra/cursor/rules/adr/js/hooks.mjs'

const exitCode = await check(process.cwd())
process.exit(exitCode)
```

### Порядок перевірок усередині `check`

1. **Канонічність bash-скриптів** — для кожного з `HOOK_ARTIFACTS`:
   - FS-existence cцільового файлу;
   - FS-existence канонічного файлу в пакеті;
   - byte-exact diff обох контентів.
2. **`.claude/settings.json` existence** — sanity-check, що project-shared конфіг є.
3. **`.cursor/hooks.json`** — JSON parsing + наявність `hooks.stop[].command` markers для обох scriptName.
4. **`.gitignore` log-coverage** — для кожного логу шукається покривна лінія (точна, scoped-glob або wide-glob).
5. **LLM CLI availability** — інформативна перевірка `claude`/`cursor-agent` у `PATH`; **не валить exit code**.

### Як інтерпретувати результат

- **Return `0`** — усі обов'язкові перевірки пройшли; LLM-CLI-секція могла видати warning, але це нормально.
- **Return `1`** — хоч одна `fail`-перевірка. Усі повідомлення `fail` містять actionable-підказку (зазвичай `npx @nitra/cursor` або конкретний рядок для `.gitignore`).

### Типові сценарії регресії

- Локальний редактор bash-скрипта → `checkHookScript` зафейлить byte-diff.
- Видалення `.cursor/hooks.json` чи поламана структура → `checkCursorHooks` повідомить через JSON-error або відсутність marker.
- Перенесення hook entry в `settings.local.json` → деталі ловить policy-правило, але `checkProjectSettings` гарантує, що project-shared файл хоча б присутній.
- Відсутність `.gitignore`-покриття для логів → багато `fail`-меседжів з конкретним рядком, що треба додати.
- Відсутність LLM CLI → `pass` із warning-меседжем, але `exit 0` (hook буде no-op'ати).

### Контекстні нюанси

- Усі шляхи в `fail`/`pass`-меседжах — відносні до `cwd` (не абсолютні), щоб output був стабільний у CI та однаковий між машинами.
- `readJsonSafe` свідомо приглушує помилки парсингу — рішення про "JSON broken" приймається в `checkCursorHooks` через `config === null`.
- `cursorConfigHasStopHook` робить точкову, але повну валідацію типів, бо `.cursor/hooks.json` керується одночасно автоматичним sync і людьми — не можна вважати, що структура завжди канонічна.
- `BUNDLED_HOOKS_DIR` обчислений `dirname(fileURLToPath(import.meta.url))` + три `..` — цей розрахунок чутливий до **переміщень файлу всередині пакета**: якщо змінити structure `npm/rules/adr/js/`, треба синхронно правити кількість `..` сегментів.

## Rebuild Test

Якщо файл `hooks.mjs` загубити, його можна відновити з цієї документації, дотримуючись таких інваріантів:

- Один експорт `async function check(cwd = process.cwd()): Promise<number>`.
- Внутрішні константи `HOOK_ARTIFACTS`, `PROJECT_SETTINGS_REL`, `CURSOR_HOOKS_REL`, `EOL_RE`, `BUNDLED_HOOKS_DIR` мають описані значення.
- Усі перевірки звітують через `createCheckReporter()` з `npm/scripts/lib/check-reporter.mjs`.
- Канонічні bash-скрипти беруться з `<тут>/../../../.claude-template/hooks/` (три `..` від каталогу модуля).
- `.gitignore`-матч підтримує точний шлях + `.claude/hooks/*.log` + `.claude/hooks/**/*.log` + `*.log` + `**/*.log`, ігнорує порожні й коментарі.
- LLM-CLI-перевірка завжди завершується `pass` — exit-code від неї не залежить.
- Порядок викликів усередині `check` має значення для читабельного output: hook-скрипти → settings → cursor hooks → gitignore → llm cli.
