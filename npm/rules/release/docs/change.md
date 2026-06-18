---
type: JS Module
title: change.mjs
resource: npm/rules/release/change.mjs
docgen:
  crc: 1ff4f816
---

Модуль реалізує CLI-команду `n-cursor change`, яка створює **один** change-файл у каталозі `<ws>/.changes/<timestamp>-<rand>.md` усередині конкретного workspace монорепо. Файл містить мінімальний YAML-frontmatter (`bump`, `section`) та текст опису зміни.

Призначення — замінити ручне редагування `CHANGELOG.md` під час feature-флоу: розробник (або агент) додає декларативний запис про зміну, а агрегація у фінальний `CHANGELOG.md` відбувається пізніше в CI (відповідно до правила `n-changelog.mdc` v3.0).

Файл експонує дві функції:

- `writeChange(...)` — програмний API для запису одного change-файлу;
- `runChangeCli(args)` — обгортка для запуску з аргументів командного рядка.

Серіалізація, парсинг, валідація та формування імені файлу делеговані сусідньому модулю `./lib/change-file.mjs`.

## Експорти / API

| Експорт        | Тип              | Призначення                                                                                                                 |
| -------------- | ---------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `writeChange`  | `async function` | Створює один change-файл у `<ws>/.changes/` та повертає його шлях відносно workspace.                                       |
| `runChangeCli` | `async function` | Парсить CLI-аргументи (`--bump`, `--section`, `--message`, `--ws`), викликає `writeChange` і повертає exit-код для процесу. |

Модуль не має експортованих констант чи класів, лише ці дві функції. `default`-експорт відсутній — використовуються лише іменовані експорти.

## Функції

### `writeChange({ bump, section, message, ws, cwd })`

Програмний рівень: створює один change-файл і повертає його шлях, придатний для логування.

**Сигнатура:**

```js
async function writeChange({
  bump,           // string: 'major' | 'minor' | 'patch'
  section,        // string: 'Added' | 'Changed' | 'Fixed' | 'Removed'
  message,        // string: текст опису (буде обрізаний trim'ом)
  ws = '.',       // string: відносний шлях workspace від cwd (за замовчуванням поточний)
  cwd = process.cwd(), // string: корінь репозиторію
}): Promise<string>
```

**Параметри:**

- `bump` _(string, обов'язковий)_ — рівень semver-бампу. Дозволені значення: `major`, `minor`, `patch` (перевіряється у `parseChangeFile`).
- `section` _(string, обов'язковий)_ — секція Keep a Changelog. Дозволені значення: `Added`, `Changed`, `Fixed`, `Removed`.
- `message` _(string, обов'язковий)_ — людиночитаний опис зміни. Якщо `null/undefined`, перетворюється на порожній рядок; далі застосовується `trim()`. Порожній (після обрізки) опис призведе до помилки валідації.
- `ws` _(string, необов'язковий, default `.`)_ — шлях workspace відносно `cwd`. Дозволяє писати change-файли в конкретний підпроект монорепо.
- `cwd` _(string, необов'язковий, default `process.cwd()`)_ — корінь репозиторію. Винесений у параметр для тестованості.

**Повертає:** `Promise<string>` — відносний шлях створеного файлу від кореня workspace (`ws`), у форматі `.changes/<timestamp>-<rand>.md`. Зауважте: шлях **не** включає сам `ws` — це робить його зручним для подальшого логування `join(ws, rel)`.

**Side effects:**

1. Серіалізує запис через `serializeChangeFile({ bump, section, description })`.
2. **Валідує** серіалізований вміст через `parseChangeFile(content)` — це гарантує, що файл, який буде записаний, є валідним відповідно до тих самих правил, що використовуються при подальшому читанні. Невалідні `bump`/`section` чи порожній опис призведуть до `throw Error(...)` зі зрозумілим повідомленням українською.
3. Створює каталог `<cwd>/<ws>/.changes/` (рекурсивно, `mkdir(..., { recursive: true })`) — не падає, якщо каталог уже існує.
4. Генерує унікальне ім'я файлу через `newChangeFileName()` (timestamp + випадковий hex-суфікс, що захищає від колізій паралельних агентів у тій самій мілісекунді).
5. Записує файл на диск (`writeFile`). Якщо файл випадково існує — буде перезаписаний (хоча колізія за іменем практично виключена через rand-суфікс).

**Виняткові ситуації:**

- Помилка валідації `parseChangeFile` (невалідні `bump`/`section`, порожній опис) — кидає `Error` із текстом помилки українською.
- Помилки FS (наприклад, відсутність прав на створення каталогу) — кидаються як стандартні `Error` із Node.js.

### `runChangeCli(args)`

CLI-обгортка: розбирає аргументи, викликає `writeChange` і повертає exit-код. Не викликає `process.exit` — це робить виклична сторона (`bin`-скрипт).

**Сигнатура:**

```js
async function runChangeCli(args: string[]): Promise<number>
```

**Параметри:**

- `args` _(string[], обов'язковий)_ — масив аргументів CLI (зазвичай `process.argv.slice(2)`).

**Розпізнавані прапори** (парсер мінімалістичний, не використовує бібліотеку):

- `--bump <major|minor|patch>` — обов'язковий.
- `--section <Added|Changed|Fixed|Removed>` — обов'язковий.
- `--message "<опис>"` — обов'язковий.
- `--ws <шлях>` — необов'язковий, default `.`.

Кожен прапор шукається через `args.indexOf(flag)`; значення береться з наступного елемента (`args[i + 1]`). Якщо прапора немає, або він є останнім — значення `undefined`. Через таку реалізацію значення `--message`, що починається з тире (наприклад, `--message "--foo"`), розбереться коректно, але кілька прапорів з одним іменем не підтримуються (береться перше входження).

**Повертає:** `Promise<number>` — exit-код:

- `0` — успіх; у `stdout` пишеться `✅ <ws>/<rel>` (де `rel` — шлях, повернений `writeChange`).
- `1` — помилка:
  - Якщо бракує одного з обов'язкових прапорів (`--bump`, `--section`, `--message`) — у `stderr` пишеться рядок-підказка з повним usage-описом українською.
  - Якщо `writeChange` кинув виняток — у `stderr` пишеться `❌ <message>` (для `Error` — `error.message`, для всього іншого — `String(error)`).

**Side effects:**

- Пише в `console.log` (`stdout`) на успіх.
- Пише в `console.error` (`stderr`) на помилку.
- Через `writeChange` — створює каталог і файл (див. вище).

## Залежності

### Зовнішні (Node.js core)

- `node:fs/promises`:
  - `mkdir` — рекурсивне створення `<ws>/.changes/`.
  - `writeFile` — запис вмісту файлу.
- `node:path`:
  - `join` — побудова абсолютних і відносних шляхів (платформонезалежно).

### Внутрішні (сусідній модуль `./lib/change-file.mjs`)

- `CHANGES_DIR` _(string-константа `'.changes'`)_ — назва підкаталогу всередині workspace.
- `newChangeFileName()` — генератор унікального імені файлу (`<Date.now()>-<3byte-hex>.md`).
- `parseChangeFile(text)` — парсер + валідатор; використовується **тут** для валідації перед записом. Кидає `Error` зі зрозумілим текстом при невалідних `bump`, `section` або порожньому описі.
- `serializeChangeFile({ bump, section, description })` — формує текст change-файлу: `---\nbump: ...\nsection: ...\n---\n<description>\n`.

Валідні значення `bump` — `major|minor|patch`; валідні значення `section` — `Added|Changed|Fixed|Removed` (експортовані як `VALID_BUMPS` та `VALID_SECTIONS` у `change-file.mjs`).

### Глобальні

- `process.cwd()` — використовується як default для `cwd` у `writeChange`.
- `console.log`, `console.error` — для CLI-виводу.

## Потік виконання / Використання

### Сценарій 1: програмний виклик `writeChange`

```js
import { writeChange } from './change.mjs'

const rel = await writeChange({
  bump: 'patch',
  section: 'Fixed',
  message: 'Fix off-by-one у валідаторі change-файлів',
  ws: 'npm/rules/release'
})
// rel === '.changes/1735000000000-a1b2c3.md'
```

Послідовність кроків усередині:

1. `description = (message ?? '').trim()`.
2. `content = serializeChangeFile({ bump, section, description })` — формується текст із frontmatter.
3. `parseChangeFile(content)` — перевіряє коректність (`bump`, `section`, непорожній опис); кидає `Error` за невалідних даних.
4. `mkdir(join(cwd, ws, '.changes'), { recursive: true })` — створює каталог за потреби.
5. `name = newChangeFileName()` — `Date.now() + 3-byte hex`.
6. `writeFile(join(dir, name), content)` — атомарно записує файл.
7. Повертає `join('.changes', name)` — шлях відносно `ws`.

### Сценарій 2: запуск через CLI

```bash
n-cursor change \
  --bump patch \
  --section Fixed \
  --message "Fix off-by-one у валідаторі change-файлів" \
  --ws npm/rules/release
```

Послідовність кроків усередині `runChangeCli`:

1. Витягуються чотири значення через локальну функцію `get(flag)`.
2. Якщо бракує `--bump`, `--section` або `--message` — друкується usage-рядок у `stderr`, повертається `1`.
3. У `try/catch` викликається `writeChange({ bump, section, message, ws })`.
4. На успіх — `console.log('✅ <ws>/<rel>')`, return `0`.
5. На виняток — `console.error('❌ <message>')`, return `1`.

### Інтеграція з feature-флоу

Файл є частиною release-інфраструктури (`npm/rules/release/`). Створені цією командою change-файли пізніше зчитуються через `readChangeFiles(ws)` з `./lib/change-file.mjs` під час релізу, агрегуються та конвертуються в записи `CHANGELOG.md`. Це усуває конфлікти злиття в `CHANGELOG.md` при паралельних feature-гілках: кожен PR додає **новий** файл із унікальним іменем замість редагування спільного.

### Анти-колізія паралельних агентів

Унікальність імені файлу гарантується комбінацією:

- `Date.now()` — мілісекундний timestamp (порядок створення зберігається лексикографічно).
- `randomBytes(3).toString('hex')` — 6 шістнадцяткових символів випадковості (≈ 16M варіантів) у межах однієї мілісекунди.

Це робить безпечним одночасний запис із різних worktree чи паралельних агентів `n-cursor` без блокувань і без координації через FS.

## Rebuild Test

Документація відображає реальний стан файлу `change.mjs` (60 рядків, версія на момент створення документації): два іменовані експорти `writeChange` та `runChangeCli`, валідація через `parseChangeFile` після серіалізації, default `ws = '.'`, default `cwd = process.cwd()`, обов'язкові CLI-прапори `--bump`/`--section`/`--message`, опціональний `--ws`, exit-коди `0`/`1`, повідомлення українською з префіксами `✅`/`❌`. Залежності — `node:fs/promises` (`mkdir`, `writeFile`), `node:path` (`join`), `./lib/change-file.mjs` (`CHANGES_DIR`, `newChangeFileName`, `parseChangeFile`, `serializeChangeFile`).
