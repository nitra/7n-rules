# build-agents-commands.mjs

## Огляд

Модуль `build-agents-commands.mjs` формує перелік маркованих елементів (bullet items) для секції «Команди» у файлі `AGENTS.md`, який згенерує CLI `@nitra/cursor` під час синхронізації правил/шаблону.

Принципи побудови списку:

- Джерело істини — поле `scripts` у `package.json` цільового репозиторію (кореневого, не залежно від workspace).
- Спочатку додається фіксований рядок про встановлення залежностей: `bun i` (конвенція bun-монорепо).
- Далі — відомі ключі скриптів у заздалегідь визначеному порядку (`SCRIPT_KEYS_ORDER`), але лише ті, що реально присутні у `package.json` як непорожні рядки.
- Після них — усі додаткові ключі, що починаються з `lint-` і ще не були додані, у лексикографічному порядку.
- Наприкінці завжди додаються фіксовані рядки про CLI `@nitra/cursor` (синхронізація правил та `programmatic` перевірки) та про `knip` (пошук невикористаних залежностей/експортів).

Модуль повертає масив об'єктів з єдиним полем `name`, який далі споживає функція `expandMustacheSection` під час підставлення в Mustache-шаблон `AGENTS.template.md` (секція `commands`).

## Експорти / API

| Експорт                         | Тип                                                                | Призначення                                                     |
| ------------------------------- | ------------------------------------------------------------------ | --------------------------------------------------------------- |
| `buildAgentsCommandBulletItems` | `async function(projectRoot: string): Promise<{ name: string }[]>` | Будує масив елементів секції `commands` для Mustache-розкриття. |

Інших публічних експортів (`default`, ре-експортів) у файлі немає. Внутрішні допоміжні функції та константи (`PACKAGE_NAME`, `AGENTS_MD`, `SCRIPT_KEYS_ORDER`, `readPackageScripts`) не експортуються.

## Функції

### `readPackageScripts(projectRoot)`

Внутрішня (не експортована) функція. Безпечно читає поле `scripts` з `package.json` у вказаному корені.

- **Сигнатура**: `async function readPackageScripts(projectRoot: string): Promise<Record<string, string>>`
- **Параметри**:
  - `projectRoot` — абсолютний шлях до кореня репозиторію (де лежить `package.json`).
- **Повертає**: `Promise<Record<string, string>>` — об'єкт `scripts` із `package.json`. У випадку відсутності файлу, помилки IO, некоректного JSON або відсутності/непридатного типу поля `scripts` — порожній об'єкт `{}`.
- **Алгоритм**:
  1. Формує абсолютний шлях `pkgPath = join(projectRoot, 'package.json')`.
  2. Якщо файл не існує (`existsSync`) — повертає `{}`.
  3. Інакше — `readFile(pkgPath, 'utf8')`, `JSON.parse(raw)`.
  4. Перевіряє, що `pkg` — об'єкт, у нього є поле `scripts` типу `object`. Якщо так — повертає його (з JSDoc-кастом до `Record<string, string>`).
  5. Будь-який кинутий виняток (некоректний JSON, помилка читання) глушиться `try/catch` без логу — секція команд лишається з мінімумом (`bun i` + рядки про CLI).
- **Side effects**: лише синхронне `existsSync` та асинхронне читання файлу `package.json` із FS. Жодних мутацій глобального стану, жодного `console.*`, жодного `process.exit`.

### `buildAgentsCommandBulletItems(projectRoot)` (експортована)

Основний публічний API модуля.

- **Сигнатура**: `export async function buildAgentsCommandBulletItems(projectRoot: string): Promise<{ name: string }[]>`
- **Параметри**:
  - `projectRoot` — абсолютний шлях до кореня репозиторію (зазвичай `process.cwd()` виклику CLI).
- **Повертає**: `Promise<{ name: string }[]>` — впорядкований список елементів секції `commands`. Кожен елемент — об'єкт з полем `name`, що містить уже готовий рядок маркованого пункту Markdown (починається з `- **<підпис>**: \`<команда>\``).
- **Алгоритм**:
  1. Викликає `readPackageScripts(projectRoot)` та зберігає результат у `scripts`.
  2. Ініціалізує масив `items` одним фіксованим елементом:
     `- **Залежності**: \`bun i\``.
  3. Створює `Set<string>` під назвою `added` для відстеження уже доданих ключів скриптів (запобігає дублюванню при подальшому fallback-проході).
  4. Ітерує `SCRIPT_KEYS_ORDER` у заданому порядку: `test`, `lint`, `lint-js`, `lint-text`, `lint-ga`, `lint-k8s`, `lint-docker`, `start`, `dev`, `build`. Для кожного ключа, для якого `scripts[key]` — непорожній рядок, додає у `items` об'єкт `{ name: '- **<key>**: \`bun run <key>\`' }`і фіксує ключ у`added`.
  5. Збирає масив `lintExtraKeys`: усі ключі `scripts`, які починаються з `lint-`, не входять у `added` і мають значення типу `string`. Сортує лексикографічно через `toSorted((a, b) => a.localeCompare(b))` (іммутабельне сортування — оригінальний масив `Object.keys(scripts)` не змінюється).
  6. Дописує у `items` пункти для кожного `lintExtraKey` за тим самим шаблоном.
  7. Додає три фіксовані хвостові пункти:
     - `- **Оновити правила та AGENTS.md** (після змін у правилах/шаблоні CLI): \`npx @nitra/cursor\``
     - `- **Перевірки правил (programmatic)**: \`npx @nitra/cursor fix\``
     - `- **knip (невикористані залежності та експорти)**: \`bunx knip\``
  8. Повертає `items`.
- **Контракт для споживача**: масив гарантовано непорожній (мінімум 4 елементи: `bun i` + 3 хвостові), навіть якщо `package.json` відсутній або порожній. Усі рядки вже містять Markdown-формат та зворотні апострофи навколо команд.
- **Side effects**: тільки опосередковані через `readPackageScripts` (читання `package.json`). Сама функція чиста відносно власних аргументів і повертає новий масив.

## Константи

- `PACKAGE_NAME = '@nitra/cursor'` — npm-ім'я CLI, що інтерполюється у хвостові пункти.
- `AGENTS_MD = 'AGENTS.md'` — ім'я файлу, на який посилається пункт «Оновити правила та AGENTS.md».
- `SCRIPT_KEYS_ORDER` — JSDoc-кастований до `const` масив із 10 ключів скриптів. Визначає фіксований порядок виводу відомих скриптів. Порядок:
  1. `test`
  2. `lint`
  3. `lint-js`
  4. `lint-text`
  5. `lint-ga`
  6. `lint-k8s`
  7. `lint-docker`
  8. `start`
  9. `dev`
  10. `build`

## Залежності

Усі імпорти — з вбудованих модулів Node.js (`node:`-префіксовані). Жодних сторонніх npm-залежностей.

| Імпорт       | Джерело            | Використання                                                               |
| ------------ | ------------------ | -------------------------------------------------------------------------- |
| `existsSync` | `node:fs`          | Швидка синхронна перевірка наявності `package.json` перед спробою читання. |
| `readFile`   | `node:fs/promises` | Асинхронне читання `package.json` у UTF-8.                                 |
| `join`       | `node:path`        | Побудова крос-платформового шляху `projectRoot + 'package.json'`.          |

Глобальні API: `JSON.parse`, `Object.keys`, `Array.prototype.filter`, `Array.prototype.toSorted` (Node ≥ 20), `String.prototype.localeCompare`, `String.prototype.startsWith`, `Set` (`add`, `has`).

Вимога рантайму: Node.js з підтримкою ESM (`import`), `node:`-префіксу та `Array.prototype.toSorted` (Node ≥ 20). Файл — ESM (`.mjs`).

## Потік виконання / Використання

Типовий сценарій інтеграції в CLI `@nitra/cursor` (генерація `AGENTS.md` з Mustache-шаблону):

1. CLI отримує `projectRoot` (`process.cwd()` або переданий шлях до репозиторію користувача).
2. Викликає `buildAgentsCommandBulletItems(projectRoot)` для отримання масиву елементів секції `commands`.
3. Передає результат у функцію розкриття Mustache-секцій (наприклад, `expandMustacheSection(template, 'commands', items)`), яка робить ітерацію по `{{#commands}} {{name}} {{/commands}}` у `AGENTS.template.md`.
4. Отриманий Markdown записується у `AGENTS.md` у корені цільового репозиторію.

Приклад використання (псевдокод):

```js
import { buildAgentsCommandBulletItems } from './build-agents-commands.mjs'

const items = await buildAgentsCommandBulletItems(process.cwd())
// items: [
//   { name: '- **Залежності**: `bun i`' },
//   { name: '- **test**: `bun run test`' },           // якщо є у package.json
//   { name: '- **lint**: `bun run lint`' },           // якщо є у package.json
//   ...
//   { name: '- **lint-rego**: `bun run lint-rego`' }, // алфавітний fallback для lint-*
//   { name: '- **Оновити правила та AGENTS.md** (...): `npx @nitra/cursor`' },
//   { name: '- **Перевірки правил (programmatic)**: `npx @nitra/cursor fix`' },
//   { name: '- **knip (невикористані залежності та експорти)**: `bunx knip`' }
// ]
```

Граничні випадки:

- **`package.json` відсутній** — повертається список лише з `bun i` + 3 хвостових пунктів (4 елементи).
- **`package.json` некоректний (битий JSON, IO-помилка)** — те саме, що й при відсутності: виняток глушиться, повертається мінімум.
- **`scripts` відсутній/не об'єкт** — те саме: мінімум 4 елементи.
- **Скрипт визначений у `package.json` як порожній рядок** — пропускається (умова `scripts[key].length > 0`).
- **Скрипт визначений не рядком (число/масив/object)** — пропускається (умова `typeof scripts[key] === 'string'`).
- **Додаткові `lint-*` ключі**, відсутні у `SCRIPT_KEYS_ORDER` (наприклад, `lint-rego`, `lint-vue`, `lint-style`), будуть автоматично додані у відсортованому порядку після основного блоку.
- **Дублювання** виключено: `added: Set<string>` гарантує, що один і той самий ключ не з'явиться двічі (особливо актуально для `lint-*`, які присутні і в `SCRIPT_KEYS_ORDER`, і в загальному переліку).

## Rebuild Test

Сценарій ручної верифікації (за припущенням, що файл імпортується з тестового скрипта):

1. Підготувати тимчасову теку з мінімальним `package.json`:

   ```json
   {
     "name": "demo",
     "scripts": {
       "test": "bun test",
       "lint": "eslint .",
       "lint-rego": "regal lint",
       "dev": "vite",
       "empty": ""
     }
   }
   ```

2. Виконати:

   ```js
   import { buildAgentsCommandBulletItems } from '/абсолютний/шлях/до/build-agents-commands.mjs'
   const items = await buildAgentsCommandBulletItems('/абсолютний/шлях/до/тимчасової/теки')
   console.log(items)
   ```

3. Очікуваний результат (за порядком):
   1. `- **Залежності**: \`bun i\``
   2. `- **test**: \`bun run test\``(із`SCRIPT_KEYS_ORDER`)
   3. `- **lint**: \`bun run lint\``(із`SCRIPT_KEYS_ORDER`)
   4. `- **dev**: \`bun run dev\``(із`SCRIPT_KEYS_ORDER`)
   5. `- **lint-rego**: \`bun run lint-rego\``(fallback`lint-\*`, відсортовано)
   6. `- **Оновити правила та AGENTS.md** (після змін у правилах/шаблоні CLI): \`npx @nitra/cursor\``
   7. `- **Перевірки правил (programmatic)**: \`npx @nitra/cursor fix\``
   8. `- **knip (невикористані залежності та експорти)**: \`bunx knip\``

4. Перевірити, що:
   - Скрипт `empty` (порожнє значення) пропущено.
   - Ключі з `SCRIPT_KEYS_ORDER`, яких немає у `scripts`, не з'являються.
   - `lint-rego` (не з основного списку) додано у блоці fallback, відсортовано.
   - Жоден ключ не дублюється.

5. Окремо перевірити шлях без `package.json`:
   - Викликати `buildAgentsCommandBulletItems('/неіснуючий/шлях')` або теку без `package.json`.
   - Очікувати рівно 4 елементи: `bun i`, `npx @nitra/cursor`, `npx @nitra/cursor fix`, `bunx knip`.

6. Окремо перевірити битий JSON:
   - Покласти `package.json` зі вмістом `{ "scripts":` (синтаксична помилка).
   - Очікувати ті самі 4 мінімальні елементи (виняток зглушено всередині `readPackageScripts`).
