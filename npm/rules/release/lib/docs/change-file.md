---
type: JS Module
title: change-file.mjs
resource: npm/rules/release/lib/change-file.mjs
docgen:
  crc: 9284bc96
---

Модуль для роботи з одиничним **change-файлом** релізного процесу — невеликою markdown-нотаткою, що описує одну зміну в межах workspace і агрегується пізніше при формуванні CHANGELOG / bump версії.

## Огляд

Файли change-нотаток лежать у `<ws>/.changes/<timestamp>-<rand>.md` (де `<ws>` — корінь окремого workspace монорепо) і мають мінімалістичний YAML-подібний frontmatter із рівно двома ключами:

- `bump` — рівень semver-бампу (`major` | `minor` | `patch`);
- `section` — секція Keep a Changelog (`Added` | `Changed` | `Fixed` | `Removed`).

Після `---` йде довільний markdown-опис зміни.

Модуль повністю **самодостатній**: без зовнішніх npm-залежностей; парсер frontmatter — простий рядковий розбір на `:`, без YAML-бібліотеки. Це навмисне обмеження — підтримуються тільки два передбачувані ключі, що знімає клас помилок (мультирядкові значення, типи, escape).

Сценарії використання:

- запис нової нотатки з CLI/агента (`newChangeFileName` + `serializeChangeFile`);
- читання усіх нотаток workspace для агрегації (`readChangeFiles`);
- одинична валідація/розбір (`parseChangeFile`).

## Експорти / API

| Експорт                             | Тип                 | Призначення                                                                                                                                                                                                            |
| ----------------------------------- | ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `VALID_BUMPS`                       | `readonly string[]` | Дозволені semver-бампи `['major', 'minor', 'patch']` у порядку від найбільшого до найменшого (порядок є частиною контракту — використовується зовнішнім агрегатором для обчислення `max`). Заморожено `Object.freeze`. |
| `VALID_SECTIONS`                    | `readonly string[]` | Дозволені секції Keep a Changelog: `['Added', 'Changed', 'Fixed', 'Removed']`. Заморожено `Object.freeze`.                                                                                                             |
| `CHANGES_DIR`                       | `string`            | Назва підкаталогу з change-файлами в межах workspace — `.changes`.                                                                                                                                                     |
| `parseChangeFile(text)`             | `function`          | Парсить вміст change-файлу у структурований запис. Кидає `Error` при будь-яких відхиленнях.                                                                                                                            |
| `serializeChangeFile(entry)`        | `function`          | Серіалізує запис назад у текст change-файлу (frontmatter + опис + завершальний `\n`).                                                                                                                                  |
| `changeFileName(timestamp, suffix)` | `function`          | Формує імʼя файлу `<timestamp>-<suffix>.md`.                                                                                                                                                                           |
| `newChangeFileName()`               | `function`          | Згенерувати унікальне імʼя для нового change-файлу (`Date.now()` + 3 байти hex).                                                                                                                                       |
| `readChangeFiles(ws, cwd?)`         | `async function`    | Прочитати й розпарсити всі `.md`-файли з `<cwd>/<ws>/.changes/`.                                                                                                                                                       |

Внутрішнє (не експортується):

- `FRONTMATTER_RE` — regexp `/^---\n([\s\S]*?)\n---\n([\s\S]*)$/` для виокремлення frontmatter і тіла.
- `parseFrontmatterBlock(block)` — допоміжний парсер «ключ: значення» по рядках.

## Функції

### `parseFrontmatterBlock(block)` (внутрішня)

- **Сигнатура:** `(block: string) => Record<string, string>`
- **Параметри:**
  - `block` — тіло frontmatter (рядки між `---`).
- **Повертає:** обʼєкт із ключами/значеннями, кожен взятий із рядка через перший `:`; обидві частини `.trim()`-нуті. Рядки без `:` ігноруються.
- **Side effects:** немає (чиста функція).
- **Обмеження:** не підтримує квоти, escape, мультирядкові значення; коментарі `#` не розпізнаються (рядок із `#` обробляється як звичайна пара ключ-значення, якщо містить `:`).

### `parseChangeFile(text)`

- **Сигнатура:** `(text: string) => { bump: string, section: string, description: string }`
- **Параметри:**
  - `text` — повний вміст change-файлу (frontmatter + опис).
- **Повертає:** обʼєкт із трьома полями: `bump`, `section`, `description` (опис — з `.trim()`).
- **Кидає `Error`:**
  - `change-файл: відсутній frontmatter \`---\``— якщо текст не відповідає`FRONTMATTER_RE`.
  - `change-файл: bump має бути одним із major|minor|patch (отримано «…»)` — якщо `bump` поза `VALID_BUMPS` (включно з відсутнім ключем — тоді в підстановці буде порожній рядок).
  - `change-файл: section має бути одним із Added|Changed|Fixed|Removed (отримано «…»)` — якщо `section` поза `VALID_SECTIONS`.
  - `change-файл: порожній опис` — якщо тіло після frontmatter порожнє після `.trim()`.
- **Side effects:** немає (чиста функція).
- **Примітка:** повідомлення помилок українською — використовуються користувачем як діагностика прямо в CLI.

### `serializeChangeFile(entry)`

- **Сигнатура:** `(entry: { bump: string, section: string, description: string }) => string`
- **Параметри:**
  - `entry.bump` — один із `VALID_BUMPS` (функція **не** валідує — припускається, що валідація вже зроблена або значення підконтрольне виклику).
  - `entry.section` — один із `VALID_SECTIONS` (без валідації).
  - `entry.description` — текст опису.
- **Повертає:** рядок виду:
  ```
  ---
  bump: <bump>
  section: <section>
  ---
  <description>
  ```
  із завершальним `\n` у кінці.
- **Side effects:** немає (чиста функція).
- **Round-trip:** `parseChangeFile(serializeChangeFile(entry))` повертає еквівалентний запис, якщо `entry.description` уже трімнутий.

### `changeFileName(timestamp, suffix)`

- **Сигнатура:** `(timestamp: number, suffix: string) => string`
- **Параметри:**
  - `timestamp` — епоха у мс (зазвичай `Date.now()`).
  - `suffix` — короткий випадковий суфікс (як правило hex).
- **Повертає:** `\`${timestamp}-${suffix}.md\``.
- **Side effects:** немає (чиста функція).

### `newChangeFileName()`

- **Сигнатура:** `() => string`
- **Параметри:** немає.
- **Повертає:** `\`<Date.now()>-<rand6hex>.md\``, де `rand6hex`—`randomBytes(3).toString('hex')` (6 hex-символів).
- **Side effects:** виклик `Date.now()` і CSPRNG `crypto.randomBytes(3)` — результат недетермінований.
- **Призначення:** анти-колізія для випадку, коли кілька паралельних агентів у різних git-worktree пишуть нову нотатку в ту саму мілісекунду. Порядкове сортування за timestamp залишається стабільним; випадковий хвіст лише розриває нічию.

### `readChangeFiles(ws, cwd = process.cwd())`

- **Сигнатура:** `async (ws: string, cwd?: string) => Array<{ file: string, entry: { bump: string, section: string, description: string } }>`
- **Параметри:**
  - `ws` — шлях workspace (як правило відносний відносно `cwd`, наприклад `npm/foo`).
  - `cwd` — корінь репозиторію; за замовчуванням `process.cwd()`.
- **Повертає:** масив записів `{ file, entry }`, відсортований за іменем файлу через `Array#toSorted()` (лексикографічно; завдяки префіксу `<timestamp>` відповідає хронологічному порядку для timestamp однакової довжини).
- **Side effects:**
  - синхронна перевірка існування каталогу `<cwd>/<ws>/.changes/` через `existsSync`;
  - читання списку директорії `readdir` (async);
  - послідовне (не паралельне) читання кожного `.md`-файлу через `readFile(…, 'utf8')`.
- **Поведінка крайових випадків:**
  - якщо каталог `.changes` відсутній — повертає `[]` без помилок;
  - якщо каталог існує, але порожній або не містить `.md` — повертає `[]`;
  - якщо будь-який файл містить невалідний frontmatter / bump / section / опис — пробросає `Error` із `parseChangeFile` (не глушиться).
- **Сортування:** `.toSorted()` — імʼя файлу як рядок, тому порядок: чим менший timestamp — тим раніше; для однакового timestamp вирішує hex-суфікс.

## Залежності

Тільки стандартна бібліотека Node.js (без npm-залежностей):

- `node:crypto` — `randomBytes` (генерація випадкового суфікса для імені файлу).
- `node:fs` — `existsSync` (швидка перевірка існування `.changes`).
- `node:fs/promises` — `readdir`, `readFile` (читання каталогу і вмісту файлів).
- `node:path` — `join` (склейка шляху `cwd/ws/.changes`).

Внутрішні залежності модуля від інших файлів проєкту відсутні. Це робить модуль безпечно імпортованим із будь-якого контексту (CLI, тест, агент, ESLint-плагін).

## Потік виконання / Використання

### Створення нової нотатки

```js
import { writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { CHANGES_DIR, newChangeFileName, serializeChangeFile } from './change-file.mjs'

const ws = 'npm/some-pkg'
const dir = join(process.cwd(), ws, CHANGES_DIR)
await mkdir(dir, { recursive: true })

const text = serializeChangeFile({
  bump: 'patch',
  section: 'Fixed',
  description: 'Виправлено падіння CLI при відсутньому `.changes`.'
})
await writeFile(join(dir, newChangeFileName()), text)
```

### Читання й агрегація

```js
import { readChangeFiles, VALID_BUMPS } from './change-file.mjs'

const items = await readChangeFiles('npm/some-pkg')
// items: [{ file: '1700000000000-ab12cd.md', entry: { bump, section, description } }, …]

// Обчислити максимальний bump: VALID_BUMPS впорядковані від major → patch,
// тож менший індекс = «більший» bump.
const maxIdx = items.reduce((acc, { entry }) => Math.min(acc, VALID_BUMPS.indexOf(entry.bump)), VALID_BUMPS.length)
const finalBump = VALID_BUMPS[maxIdx] // або undefined, якщо items порожній
```

### Валідація одного файлу

```js
import { readFile } from 'node:fs/promises'
import { parseChangeFile } from './change-file.mjs'

const text = await readFile('npm/some-pkg/.changes/1700000000000-ab12cd.md', 'utf8')
const entry = parseChangeFile(text) // кине Error із локалізованим повідомленням, якщо файл невалідний
```

### Контракт frontmatter

Точний формат, який очікує `FRONTMATTER_RE`:

```
---
bump: patch
section: Fixed
---
<довільний markdown-опис>
```

Особливості:

- frontmatter відкривається/закривається саме рядком `---` (3 дефіси, без пробілів);
- символ розділювача — `\n` (LF); CRLF не підтримується regexp-ом без додаткової нормалізації;
- ключі `bump` і `section` мають бути в нижньому регістрі точно так, як у `VALID_BUMPS`/`VALID_SECTIONS`;
- значення секції — у титульному регістрі (`Added`, не `added`), оскільки воно безпосередньо використовується як заголовок `### {section}` у CHANGELOG;
- зайві ключі у frontmatter не забороняються парсером (вони просто потрапляють у `out`-обʼєкт і ігноруються верхнім рівнем), але контракт модуля передбачає лише два;
- після `---` має бути непорожній (після `trim`) markdown-опис, інакше — помилка.

### Інваріанти, корисні викликачу

- `parseChangeFile(serializeChangeFile(e)) ≡ e` для будь-якого валідного `e` із трімнутим `description`.
- `newChangeFileName()` завжди відповідає шаблону `^\d+-[0-9a-f]{6}\.md$`.
- `readChangeFiles` ніколи не повертає шляхи поза `<cwd>/<ws>/.changes/` — лише імена файлів у полі `file`.
- Відсутність `.changes` — не помилка, а сигнал «змін немає».
