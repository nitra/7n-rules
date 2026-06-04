# inline-template-links.mjs

## Огляд

Модуль `inline-template-links.mjs` — допоміжна утиліта для **build-кроку обробки `.mdc`-правил**. Її роль: у текстовому вмісті `.mdc`-документа знайти Markdown-посилання, які ведуть на template-файли (шлях містить сегмент `/template/` або `/templates/`), і **замінити** ці посилання на **інлайн fenced-блоки** з фактичним вмістом target-файлу.

Простими словами: замість того щоб у згенерованому правилі читач бачив посилання `[конфіг](./templates/package.json.snippet.json)`, він побачить безпосередньо назву реального файлу (`package.json`) і fenced-блок із його вмістом — це робить правило «самодостатнім», без потреби клікати по лінках.

Особливості:

- Працює асинхронно (`async`), бо читає файли через `node:fs/promises`.
- Робить **fail-loud** валідацію: якщо посилання вказує на неіснуючий файл — кидає `Error` (а не мовчки пропускає), щоб автор правила одразу побачив проблему.
- «Розгортає» спеціальні суфікси `.snippet.<ext>` / `.deny.<ext>` / `.contains.<ext>` до імені реального target-файлу, який вони описують (наприклад `package.json.snippet.json` → `package.json`).
- Безпечно щодо ReDoS: усі regexp — статичні літерали з обмеженням довжини, без `new RegExp(variable)` із користувацьких даних.

Модуль експортує єдину функцію `inlineTemplateLinks(text, ruleDir)`.

## Експорти / API

| Експорт | Тип | Призначення |
| --- | --- | --- |
| `inlineTemplateLinks` | `async function(text: string, ruleDir: string): Promise<string>` | Замінює Markdown-посилання на template-файли в `.mdc`-тексті на інлайн fenced-блоки з фактичним вмістом цих файлів. |

Усі інші імена в модулі (`langFromExt`, `normalizeTargetName`, константи `MD_LINK_RE`, `TEMPLATE_SEGMENT_RE`, `SLOT_SUFFIX_RES`) — **внутрішні** (не експортуються).

## Внутрішні константи

### `MD_LINK_RE`

```js
/\[([^\]]{1,200})\]\((\.\/[^)]{1,500})\)/g
```

Глобальний regexp, який ловить **Markdown-посилання вигляду `[label](./path)`** із обов'язковим префіксом `./` у href. Group 1 — текст посилання (до 200 символів), group 2 — шлях (до 500 символів, що починається з `./`). Обмеження довжин — захист від ReDoS / pathological input.

### `TEMPLATE_SEGMENT_RE`

```js
/\/templates?\//
```

Перевіряє, чи шлях містить сегмент `/template/` або `/templates/`. Тільки такі посилання вважаються «template-посиланнями» і підлягають заміні; інші Markdown-лінки залишаються недоторканими.

### `SLOT_SUFFIX_RES`

Масив із трьох **статичних** regexp:

```js
[
  /^(.+)\.snippet\.[^.]+$/,
  /^(.+)\.deny\.[^.]+$/,
  /^(.+)\.contains\.[^.]+$/,
]
```

Кожен ловить ім'я файлу з суфіксом-«слотом»: `<name>.snippet.<ext>`, `<name>.deny.<ext>`, `<name>.contains.<ext>`. Group 1 — це ім'я реального target-файлу (без суфікса слоту і без власного розширення). Коментар у коді явно зазначає: regexp-літерали статичні, без `RegExp(variable)`.

## Функції

### `langFromExt(filePath)` — internal

Сигнатура:

```js
function langFromExt(filePath: string): string
```

Параметри:

- `filePath` — рядок зі шляхом до файлу (досить навіть базового імені, бо використовується лише розширення).

Повертає:

- Рядок-ідентифікатор мови для Markdown fenced-блока:
  - `'json'` — якщо розширення `.json`;
  - `'toml'` — якщо `.toml`;
  - `'yaml'` — якщо `.yml` або `.yaml`;
  - `''` (порожній рядок) — для будь-яких інших розширень.

Side effects: жодних — чиста функція над рядком.

Призначення: визначити, який мовний таг ставити після відкривального `` ``` `` у згенерованому fenced-блоці, щоб підсвічування синтаксису працювало коректно.

### `normalizeTargetName(fileBasename)` — internal

Сигнатура:

```js
function normalizeTargetName(fileBasename: string): string
```

Параметри:

- `fileBasename` — базове ім'я файлу (без шляху), наприклад `package.json.snippet.json`.

Повертає:

- Якщо ім'я **збігається з одним із regexp у `SLOT_SUFFIX_RES`** (тобто має суфікс `.snippet.<ext>`, `.deny.<ext>` або `.contains.<ext>`) — повертається **group 1** першого збігу (ім'я без слоту). Приклади:
  - `package.json.snippet.json` → `package.json`
  - `eslint.config.js.deny.js` → `eslint.config.js`
  - `Caddyfile.contains.txt` → `Caddyfile`
- Якщо жоден з regexp не збігся — повертається оригінальне `fileBasename` без змін.

Side effects: відсутні.

Призначення: для template-файлу з суфіксом-слотом відновити **реальне ім'я target-файлу**, на який цей template посилається; саме це ім'я потім підставляється як заголовок перед fenced-блоком у згенерованому Markdown.

Коментар над функцією у вихіднику прямо описує цю поведінку: «Strip `.<slot>.<ext>` suffix (slot ∈ snippet/deny/contains) to recover the real target file name».

### `inlineTemplateLinks(text, ruleDir)` — **exported**

Сигнатура:

```js
export async function inlineTemplateLinks(
  text: string,
  ruleDir: string,
): Promise<string>
```

Параметри:

- `text` — вміст `.mdc`-файлу (повний текст) як рядок.
- `ruleDir` — **абсолютний** шлях до директорії правила (наприклад `.../npm/rules/security/`). Усі відносні href із `./` резолвляться **відносно цього каталогу**.

Повертає:

- `Promise<string>` — трансформований текст, у якому всі **template-посилання** замінено на блоки виду:

  ```text
  `<targetName>`:

  ```<lang>
  <contents>
  ```
  ```

  де `targetName` — результат `normalizeTargetName(basename(absPath))`, `lang` — результат `langFromExt(absPath)`, а `contents` — вміст файлу після `.trim()`.

- Якщо у тексті немає жодного template-посилання — повертається **той самий `text` без змін** (early-exit).

Алгоритм роботи:

1. Знаходимо **всі** збіги `MD_LINK_RE` у `text` через `text.matchAll(...)`.
2. Фільтруємо їх: залишаємо лише ті, у яких href (group 2) містить `/template/` або `/templates/` (через `TEMPLATE_SEGMENT_RE.test(m[2])`).
3. Якщо після фільтрації збігів **немає** — повертаємо `text` як є.
4. Кладемо стартовий результат `result = text`.
5. Для кожного збігу послідовно (`for ... of`, з `await` на читанні файлу):
   1. Деструктуруємо: `const [fullMatch, , href] = match` (label не використовується, тому позиція пропущена).
   2. Будуємо відносний шлях: `relPath = href.slice(2)` — обрізаємо префікс `./` (його гарантує regexp).
   3. Збираємо абсолютний шлях: `absPath = join(ruleDir, relPath)`.
   4. Перевіряємо існування: `existsSync(absPath)`. Якщо файлу немає — **кидаємо** `Error`:

      ```text
      inlineTemplateLinks: file not found: <absPath> (referenced from .mdc)
      ```

      Жодного fallback / тихого пропуску — це fail-loud за дизайном.
   5. Читаємо файл: `raw = await readFile(absPath, 'utf8')`, далі `contents = raw.trim()` (прибираємо хвостові пробіли / переноси).
   6. Обчислюємо `lang = langFromExt(absPath)`.
   7. Обчислюємо `targetName = normalizeTargetName(basename(absPath))`.
   8. Формуємо `replacement` — backtick-екранований заголовок, порожній рядок і fenced-блок із `lang`:

      ```js
      `\`${targetName}\`:\n\n\`\`\`${lang}\n${contents}\n\`\`\``
      ```

   9. Робимо заміну: `result = result.replace(fullMatch, () => replacement)`. Передача **callback-форми** в `.replace` критично важлива: інакше спецсимволи у `replacement` (наприклад `$&`, `$1` із вмісту шаблону) трактувалися б як backreferences і зламали б вивід.
6. Повертаємо `result`.

Side effects:

- **Читання** файлів із диска (синхронна перевірка `existsSync` + асинхронне `readFile`).
- **Кидання `Error`** при відсутності target-файлу — це навмисна поведінка («fail loud — user must know»), а не баг.
- Запису на диск або мережевих викликів **не робить**.

Складність та обмеження:

- Цикл лінійний за кількістю template-посилань у тексті; для кожного — один `existsSync` і один `readFile`.
- Файли читаються **послідовно** (через `await` у тілі `for...of`), а не паралельно через `Promise.all`. Це осмислений вибір: правил, як правило, мало, а послідовність робить порядок помилок передбачуваним.
- Заміна виконується через простий `result.replace(fullMatch, ...)` — перший збіг `fullMatch` у `result`. Якщо однакове Markdown-посилання трапляється кілька разів — модифікується лише перше входження (фактичний `matchAll` дасть і інші входження, але кожен з них має той самий `fullMatch`, і їх теж замінить — по одному за крок ітерації; для повних дублікатів це працює коректно).

## Залежності

### Стандартна бібліотека Node.js

- `node:fs` → `existsSync` — синхронна перевірка наявності файлу перед читанням.
- `node:fs/promises` → `readFile` — асинхронне читання вмісту target-файлу як UTF-8.
- `node:path` → `basename`, `extname`, `join` — робота з шляхами:
  - `extname` — у `langFromExt` для визначення мови;
  - `basename` — для отримання базового імені файлу, з якого `normalizeTargetName` витягне target-ім'я;
  - `join` — для побудови абсолютного шляху від `ruleDir` + `relPath`.

### Зовнішні залежності

Жодних npm-пакетів. Модуль працює лише на Node.js стандарті.

### Споживачі модуля

Файл лежить у `npm/scripts/lib/` поряд із іншими допоміжними утилітами для збірки правил, тому очікувані споживачі — build-скрипти у `npm/scripts/`, які генерують підсумкові `.mdc`-документи для cursor-rules / Claude-rules. Експортована функція `inlineTemplateLinks` викликається на проміжній стадії пайплайна обробки тексту `.mdc`-файлу разом із `ruleDir`, обчисленим від шляху до самого `.mdc`.

## Потік виконання / Використання

Типовий сценарій інтеграції в build-скрипт:

```js
import { readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

import { inlineTemplateLinks } from './lib/inline-template-links.mjs'

const mdcPath = '/abs/path/to/npm/rules/security/n-security.mdc'
const original = await readFile(mdcPath, 'utf8')

const ruleDir = dirname(mdcPath) // важливо: каталог, де лежить .mdc
const transformed = await inlineTemplateLinks(original, ruleDir)

await writeFile(mdcPath, transformed, 'utf8')
```

Що відбувається крок-за-кроком на прикладі.

Вхідний `.mdc`-фрагмент (`ruleDir = .../npm/rules/security/`):

```text
Snippet вимоги до `package.json` — див. [тут](./templates/package.json.snippet.json).
```

Файл `.../npm/rules/security/templates/package.json.snippet.json`:

```json
{
  "scripts": {
    "lint": "eslint ."
  }
}
```

Що зробить `inlineTemplateLinks`:

1. `matchAll(MD_LINK_RE)` знайде один збіг із href `./templates/package.json.snippet.json`.
2. `TEMPLATE_SEGMENT_RE` пропустить його (бо є `/templates/`).
3. `relPath = 'templates/package.json.snippet.json'`, `absPath = '.../npm/rules/security/templates/package.json.snippet.json'`.
4. `existsSync(absPath)` → `true`, файл читається.
5. `langFromExt(absPath)` → `'json'`.
6. `normalizeTargetName('package.json.snippet.json')` → `'package.json'` (спрацює regexp `/^(.+)\.snippet\.[^.]+$/`).
7. `replacement` буде:

   ```text
   `package.json`:

   ```json
   {
     "scripts": {
       "lint": "eslint ."
     }
   }
   ```
   ```

8. Результат заміняє оригінальний Markdown-лінк у тексті.

Випадки помилок:

- Якщо `href` веде на неіснуючий файл — кидається `Error` із повним абсолютним шляхом у повідомленні; build-скрипт має право або впасти, або зловити цю помилку.
- Якщо у `text` немає Markdown-посилань або жодне з них не містить `/template(s)/` — функція повертає `text` без модифікацій.
- Якщо template-файл має нерозпізнаване розширення (наприклад `.txt` або `.conf`) — `langFromExt` поверне порожній рядок, і fenced-блок буде без мовного тегу (Markdown це допускає).
- Якщо ім'я template-файлу **не** має одного з суфіксів `.snippet.<ext>` / `.deny.<ext>` / `.contains.<ext>` — `normalizeTargetName` поверне його як є; це нормальна поведінка для «звичайних» template-файлів, у яких саме ім'я і є target-ім'ям.

## Rebuild Test

Якщо видалити цей файл і відтворити його з нуля, мінімально достатній рецепт такий:

1. Створи модуль `inline-template-links.mjs` у `npm/scripts/lib/`.
2. Імпортуй з `node:fs` функцію `existsSync`, з `node:fs/promises` — `readFile`, з `node:path` — `basename`, `extname`, `join`.
3. Оголоси константи:
   - `MD_LINK_RE = /\[([^\]]{1,200})\]\((\.\/[^)]{1,500})\)/g` — глобальний regexp для Markdown-посилань `[label](./path)`.
   - `TEMPLATE_SEGMENT_RE = /\/templates?\//` — фільтр шляхів, що містять `/template/` чи `/templates/`.
   - `SLOT_SUFFIX_RES` — масив із трьох **статичних** regexp: `/^(.+)\.snippet\.[^.]+$/`, `/^(.+)\.deny\.[^.]+$/`, `/^(.+)\.contains\.[^.]+$/`. Принципово: жодного `new RegExp(variable)` — захист від ReDoS.
4. Реалізуй `langFromExt(filePath)`:
   - `extname(filePath)` → за вмістом повернути `'json' | 'toml' | 'yaml' | ''` (для `.yml` теж `'yaml'`).
5. Реалізуй `normalizeTargetName(fileBasename)`:
   - Пройди `SLOT_SUFFIX_RES` у заданому порядку; при першому збігу поверни `match[1]`. Інакше — оригінал.
6. Експортуй `async function inlineTemplateLinks(text, ruleDir)`:
   - `matchAll(MD_LINK_RE)` → відфільтруй за `TEMPLATE_SEGMENT_RE.test(href)`.
   - Якщо нічого не залишилося — поверни `text`.
   - Для кожного збігу: `relPath = href.slice(2)`, `absPath = join(ruleDir, relPath)`; якщо `!existsSync(absPath)` — `throw new Error('inlineTemplateLinks: file not found: <absPath> (referenced from .mdc)')`.
   - Читай файл `utf8`, роби `.trim()`, обчисли `lang` і `targetName`, побудуй `replacement = \`\\\`${targetName}\\\`:\\n\\n\\\`\\\`\\\`${lang}\\n${contents}\\n\\\`\\\`\\\``.
   - Заміни через `result = result.replace(fullMatch, () => replacement)` (саме callback-форма — щоб уникнути інтерпретації `$&`/`$1` у вмісті template-файлу).
7. Поверни `result`.

Контракт, який має зберегтися:

- Чиста функція над текстом + читання файлів (без записів і без мережі).
- **Fail-loud** на відсутній target.
- Підтримка трьох слот-суфіксів: `snippet`, `deny`, `contains`.
- Підтримка мов підсвічування: `json`, `toml`, `yaml`, інакше — без таргу.
- Жодного `RegExp(variable)`.
- Префікс href повинен починатися з `./`, інакше посилання ігнорується (це закладено в `MD_LINK_RE`).
