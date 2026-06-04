# aggregate.mjs

## Огляд

Модуль `aggregate.mjs` забезпечує **агрегацію change-файлів одного workspace** у дві основні сутності:

1. Новий рядок версії згідно semver-правил (`x.y.z` → бамп `major|minor|patch`).
2. Markdown-секцію для файлу `CHANGELOG.md`, побудовану у форматі [Keep a Changelog 1.1.0](https://keepachangelog.com/uk/1.1.0/), де новіша версія додається зверху.

Модуль є **чистим обчислювальним шаром** — він **не має побічних ефектів**: не читає й не пише файли, не викликає `git`, не звертається до мережі чи процесів. Усі операції зводяться до парсингу/рендерингу рядків та арифметики на номерах версії. Відповідальність за читання `CHANGELOG.md` з диску, виконання `git`-команд, видалення спожитих change-файлів та оновлення `package.json` (чи аналогічного маніфесту) лежить на викликачі — за конвенцією проєкту це `release.mjs`.

Через відсутність побічних ефектів модуль легко тестується юніт-тестами без mock’ів файлової системи й використовується як деталізована «бібліотечна» частина CLI `n-cursor release` для монорепо.

## Експорти / API

| Експорт | Тип | Призначення |
| --- | --- | --- |
| `bumpVersion(version, bump)` | функція | Інкремент semver-рядка згідно з рівнем бампа |
| `maxBump(bumps)` | функція | Найвищий пріоритет бампа у списку (`major` > `minor` > `patch`) |
| `renderChangelogSection(version, date, entries)` | функція | Рендер однієї версійної секції у markdown |
| `prependChangelogSection(existingText, sectionBlock)` | функція | Вставка нової секції зверху наявного `CHANGELOG.md` |
| `aggregateWorkspace({ currentVersion, changeFiles, date })` | функція | Високорівневе об’єднання change-файлів workspace у `newVersion` + `sectionBlock` |

Усі експорти — **іменовані** (`export function …`). Default-export відсутній.

## Функції

### `bumpVersion(version, bump)`

**Сигнатура:** `bumpVersion(version: string, bump: 'major'|'minor'|'patch'): string`

**Параметри:**
- `version` — поточна версія у форматі `x.y.z`, де `x`, `y`, `z` — невід’ємні цілі (валідується регулярним виразом `^(\d+)\.(\d+)\.(\d+)$`).
- `bump` — рівень бампа: `'major'`, `'minor'` або `'patch'`. Будь-яке інше значення (включно з `undefined`, помилковим написанням) поведеться як `'patch'` (через гілку `return` без явної перевірки).

**Повертає:** новий рядок версії згідно з правилами semver:
- `major` → `(major + 1).0.0`
- `minor` → `major.(minor + 1).0`
- `patch` (за замовчуванням у `else`-гілці) → `major.minor.(patch + 1)`

**Помилки:** `Error('aggregate: невалідний semver «<version>»')`, якщо вхідний рядок не відповідає формату `x.y.z`.

**Side effects:** немає.

**Приклади:**
- `bumpVersion('1.2.3', 'major')` → `'2.0.0'`
- `bumpVersion('1.2.3', 'minor')` → `'1.3.0'`
- `bumpVersion('1.2.3', 'patch')` → `'1.2.4'`
- `bumpVersion('0.0.1', 'major')` → `'1.0.0'`

### `maxBump(bumps)`

**Сигнатура:** `maxBump(bumps: string[]): string`

**Параметри:**
- `bumps` — непорожній (за контрактом виклику) список рядків-рівнів бампа. Допускаються лише значення зі `VALID_BUMPS` (`['major', 'minor', 'patch']`), але функція не валідує їх явно.

**Повертає:** найвищий рівень бампа з масиву за пріоритетом `major > minor > patch`. Якщо у `bumps` немає жодного з `VALID_BUMPS`, повертається `'patch'` (через оператор `??`).

**Реалізація:** використовує `VALID_BUMPS.find(level => bumps.includes(level))`. Оскільки `VALID_BUMPS` упорядкований як `['major', 'minor', 'patch']`, `find` поверне **перший** наявний у `bumps` рівень — тобто максимальний.

**Side effects:** немає.

**Приклади:**
- `maxBump(['patch', 'minor'])` → `'minor'`
- `maxBump(['patch', 'major', 'minor'])` → `'major'`
- `maxBump(['patch'])` → `'patch'`
- `maxBump([])` → `'patch'` (через fallback `?? 'patch'`)

### `renderChangelogSection(version, date, entries)`

**Сигнатура:** `renderChangelogSection(version: string, date: string, entries: Array<{ section: string, description: string }>): string`

**Параметри:**
- `version` — нова версія (рядок `x.y.z`).
- `date` — дата релізу у форматі `YYYY-MM-DD` (не валідується функцією).
- `entries` — масив записів change-файлів, де кожен запис має ключі `section` (один із `VALID_SECTIONS`) та `description`. Поле `bump` тут уже не використовується.

**Повертає:** markdown-рядок, який починається з заголовка `## [<version>] - <date>\n`. Далі для кожного значення з `VALID_SECTIONS` (`Added`, `Changed`, `Fixed`, `Removed`) — за наявності записів — додається блок:

```
\n### <section>\n\n- <description1>\n- <description2>\n
```

Порядок секцій у виводі **фіксований** і відповідає порядку у `VALID_SECTIONS`, незалежно від порядку записів на вході. Усередині секції рядки додаються у тому ж порядку, у якому йшли у `entries` (стабільність забезпечується `Array.prototype.filter`).

Секції без записів пропускаються (`continue`).

**Side effects:** немає.

**Приклад:**

Вхід:
- `version = '1.3.0'`
- `date = '2026-06-03'`
- `entries = [{ section: 'Added', description: 'нова опція X' }, { section: 'Fixed', description: 'падіння на Y' }]`

Вихід:

```
## [1.3.0] - 2026-06-03

### Added

- нова опція X

### Fixed

- падіння на Y
```

### `prependChangelogSection(existingText, sectionBlock)`

**Сигнатура:** `prependChangelogSection(existingText: string, sectionBlock: string): string`

**Параметри:**
- `existingText` — наявний вміст `CHANGELOG.md` (може бути порожнім рядком, або починатися з пробільних символів).
- `sectionBlock` — попередньо зрендерений markdown-блок (зазвичай результат `renderChangelogSection`).

**Повертає:** оновлений текст `CHANGELOG.md` у форматі Keep a Changelog (новіше зверху).

**Логіка:**
1. `existingText.trimStart()` — обрізаються провідні пробільні символи.
2. Якщо отриманий текст **не** починається з заголовка `# Changelog`, повертається свіжий документ: `# Changelog\n\n<sectionBlock>` (тобто все попереднє вмонтоване як «без заголовка» відкидається — викликач має самостійно дбати про коректний вхідний файл).
3. Інакше:
   - `head` — перший рядок до `\n` (зазвичай `# Changelog`, може містити додаткові символи у тому ж рядку).
   - `rest` — решта тексту після першого `\n`, із обрізаним початком (`trimStart`).
   - Повертається конкатенація `head + '\n\n' + sectionBlock + '\n' + rest`.
4. Якщо у тексті немає жодного `\n` (тобто текст складається тільки із заголовка-рядка), `rest = ''`, що дає коректний результат із порожньою «рештою».

**Side effects:** немає.

**Приклади:**

- Порожній `existingText`:
  - вихід: `# Changelog\n\n<sectionBlock>`.
- `existingText = '# Changelog\n\n## [1.0.0] - 2026-01-01\n…'`:
  - вихід: `# Changelog\n\n<sectionBlock>\n## [1.0.0] - 2026-01-01\n…`.
- `existingText = 'тут нічого корисного'`:
  - вихід: `# Changelog\n\n<sectionBlock>` (попередній вміст відкидається).

### `aggregateWorkspace({ currentVersion, changeFiles, date })`

**Сигнатура:**
```
aggregateWorkspace({
  currentVersion: string,
  changeFiles: Array<{ file: string, entry: { bump: string, section: string, description: string } }>,
  date: string,
}): { newVersion: string, sectionBlock: string, consumedFiles: string[] } | null
```

**Параметри (іменований об’єкт):**
- `currentVersion` — поточна версія маніфесту workspace (`x.y.z`).
- `changeFiles` — масив об’єктів, що відповідає виходу `readChangeFiles` з `change-file.mjs`. Кожен елемент має `file` (ім’я файлу `.md`) та `entry` (розпарсений frontmatter + опис).
- `date` — рядок дати `YYYY-MM-DD` для секції CHANGELOG.

**Повертає:**
- `null`, якщо `changeFiles.length === 0` (явна ознака «нема чого релізити»).
- Інакше — об’єкт:
  - `newVersion` — результат `bumpVersion(currentVersion, maxBump(<усі bumps>))`.
  - `sectionBlock` — результат `renderChangelogSection(newVersion, date, <усі entries>)`.
  - `consumedFiles` — імена change-файлів (`c.file`), які мають бути видалені викликачем після успішного запису маніфесту й `CHANGELOG.md`.

**Side effects:** немає. Функція суто комбінує попередньо описані `bumpVersion`, `maxBump`, `renderChangelogSection`.

**Контракт із викликачем:** саме виклик `release.mjs` (або тести) відповідає за:
- запис `CHANGELOG.md` (зазвичай через `prependChangelogSection(readFileSync('CHANGELOG.md'), sectionBlock)`);
- оновлення поля `version` у `package.json`;
- видалення файлів зі списку `consumedFiles` із `<ws>/.changes/`;
- git-операції (commit / tag / push).

## Залежності

### Внутрішні (цей модуль імпортує)

- `./change-file.mjs`:
  - `VALID_BUMPS` — `Object.freeze(['major', 'minor', 'patch'])` — порядок використовується у `maxBump` для пріоритету «найвищого».
  - `VALID_SECTIONS` — `Object.freeze(['Added', 'Changed', 'Fixed', 'Removed'])` — порядок секцій у markdown-виводі `renderChangelogSection`.

### Зовнішні

Немає. Жодних імпортів зі стандартної бібліотеки Node.js (`node:fs`, `node:path`, `node:crypto` тощо) або сторонніх пакетів. Це підкреслює статус модуля як «pure compute».

### Внутрішні константи (не експортуються)

- `SEMVER_RE = /^(\d+)\.(\d+)\.(\d+)$/` — валідація формату `x.y.z`. Розрізняє лише три цілі числа, **не** підтримує pre-release / build-metadata.
- `CHANGELOG_HEADER = '# Changelog'` — очікуваний заголовок `CHANGELOG.md` (Keep a Changelog convention).

## Потік виконання / Використання

Типовий потік релізу одного workspace (з боку викликача `release.mjs`):

1. **Збір change-файлів.** Викликач звертається до `readChangeFiles(ws, cwd)` з `change-file.mjs`, отримуючи `Array<{ file, entry }>` — усі `.md` із `<ws>/.changes/`, відсортовані за іменем (тобто де-факто за `timestamp`).
2. **Отримання поточної версії.** Викликач читає `package.json` (або інший маніфест) і дістає `currentVersion`.
3. **Дата.** Викликач формує `date = new Date().toISOString().slice(0, 10)` або еквівалент.
4. **Агрегація.** Виклик `aggregateWorkspace({ currentVersion, changeFiles, date })`:
   - Якщо повертає `null` — викликач пропускає workspace (нема `change-файлів`).
   - Якщо повертає об’єкт — отримуємо `newVersion`, `sectionBlock`, `consumedFiles`.
5. **Оновлення `CHANGELOG.md`.** Викликач читає поточний `CHANGELOG.md` (або порожній рядок, якщо файлу нема), застосовує `prependChangelogSection(existingText, sectionBlock)` і записує результат на диск.
6. **Оновлення маніфесту.** Викликач замінює `"version"` у `package.json` на `newVersion`.
7. **Видалення change-файлів.** Викликач видаляє файли зі списку `consumedFiles` з `<ws>/.changes/`.
8. **Git-операції.** Викликач виконує `git add`, `git commit`, опційно `git tag` згідно з політикою релізу.

### Чому split: `aggregate.mjs` без I/O, `release.mjs` з I/O

- **Тестованість.** Юніт-тести викликають експорти `aggregate.mjs` із чистих вхідних даних — без файлових моків, без часу.
- **Чітка межа відповідальності.** Помилки парсингу / валідації лежать у `change-file.mjs`, помилки I/O / git — у `release.mjs`, а помилки «бізнес-логіки» semver/CHANGELOG — тут.
- **Передбачуваність.** Жоден виклик функцій модуля не може зіпсувати ФС чи git-стан, навіть за хибних даних — упаде лише `throw` із описом проблеми.

### Особливості / гарантії

- **Стабільний порядок секцій** у виводі CHANGELOG: завжди `Added` → `Changed` → `Fixed` → `Removed` (порядок із `VALID_SECTIONS`), навіть якщо у вхідному масиві records записи перемішані.
- **Пріоритет бампа** `major > minor > patch` гарантується порядком елементів у `VALID_SECTIONS`/`VALID_BUMPS`, а не явним порівнянням рядків.
- **Fallback `maxBump`** — якщо у `bumps` немає жодного з відомих значень, повертається `'patch'`. Однак на практиці `change-file.mjs::parseChangeFile` уже валідує `bump`, тому до `maxBump` доходять лише валідні значення.
- **Idempotency `prependChangelogSection`** не гарантується — функція не перевіряє, чи така версія вже існує у файлі. Викликач має сам слідкувати, щоб не дублювати реліз.
- **Формат semver** обмежений `x.y.z` без префіксів (`v1.2.3` спричинить `Error`) та без pre-release/build (`1.2.3-rc.1` теж спричинить `Error`).

## Rebuild Test

За цією документацією має бути можливо переписати `aggregate.mjs` з нуля, отримавши функціонально-еквівалентний модуль, який:

1. Імпортує `VALID_BUMPS` і `VALID_SECTIONS` з `./change-file.mjs`.
2. Експортує функцію `bumpVersion(version, bump)`, що валідує semver через регулярний вираз `^(\d+)\.(\d+)\.(\d+)$`, кидає `Error('aggregate: невалідний semver «…»')` за невалідним входом і повертає інкрементовану версію за правилами `major/minor/patch`, з default-гілкою `patch` для будь-якого іншого значення `bump`.
3. Експортує функцію `maxBump(bumps)`, яка шукає у масиві `bumps` перший елемент із `VALID_BUMPS` (тобто за пріоритетом `major > minor > patch`) і повертає `'patch'`, якщо нічого не знайдено.
4. Експортує функцію `renderChangelogSection(version, date, entries)`, що повертає рядок із заголовком `## [<version>] - <date>\n`, далі — секції у порядку `VALID_SECTIONS`, кожна з заголовком `### <section>` та bullet-списком `- <description>`, із порожніми рядками-роздільниками згідно з форматом Keep a Changelog. Секції без записів пропускаються.
5. Експортує функцію `prependChangelogSection(existingText, sectionBlock)`, яка:
   - Якщо `existingText.trimStart()` не починається з `# Changelog`, повертає `# Changelog\n\n<sectionBlock>`.
   - Інакше відокремлює перший рядок (`head`) і решту (`rest`, із `trimStart`) і повертає `head + '\n\n' + sectionBlock + '\n' + rest`.
6. Експортує функцію `aggregateWorkspace({ currentVersion, changeFiles, date })`, яка:
   - Повертає `null`, якщо `changeFiles` порожній.
   - Інакше повертає `{ newVersion, sectionBlock, consumedFiles }`, де `newVersion = bumpVersion(currentVersion, maxBump(<усі c.entry.bump>))`, `sectionBlock = renderChangelogSection(newVersion, date, <усі c.entry>)`, `consumedFiles = <усі c.file>`.
7. Не виконує жодного I/O й не залежить від `node:*`.
