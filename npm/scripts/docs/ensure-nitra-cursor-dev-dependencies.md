# ensure-nitra-cursor-dev-dependencies.mjs

## Огляд

Модуль `ensure-nitra-cursor-dev-dependencies.mjs` забезпечує, що пакет `@nitra/cursor` буде оголошений у `devDependencies` workspace-root `package.json` проєкту, в якому виконується CLI `n-cursor`. Якщо запис відсутній і в `devDependencies`, і в `dependencies`, модуль дописує його з діапазоном `^<version>`, узятим з поля `version` з `package.json` фактично завантаженого пакету `@nitra/cursor`.

Призначення: коли користувач викликає `npx @nitra/cursor` (зокрема команду `check`), node-кеш npx містить пакет, але після наступного `bun install` / `npm install` цей кеш може не відтворити пакет у проєкті. Дописавши пакет у `devDependencies` workspace-root, модуль гарантує, що `n-cursor` і його допоміжні скрипти з `node_modules/@nitra/cursor/scripts/` стануть відтвореною частиною проєкту й не залежатимуть від кешу npx.

Workspace-root визначається мінімалістично: береться `package.json` поруч зі стартовою директорією (зазвичай `process.cwd()`) і вважається workspace-root, якщо в ньому є поле `workspaces`. Підйом по дереву директорій не виконується.

Модуль написаний як ESM (`.mjs`), використовує лише стандартну бібліотеку Node.js, не має сторонніх залежностей і виконує синхронні файлові операції лише для перевірки існування (`existsSync`). Решта IO — асинхронна через `node:fs/promises`.

## Експорти / API

Модуль експортує дві асинхронні функції:

- `readBundledPackageVersion()` — повертає версію встановленого пакету `@nitra/cursor` або `null`.
- `ensureNitraCursorInRootDevDependencies(root, options?)` — головна точка входу: перевіряє стан проєкту й, за потреби, мутує його `package.json`. Повертає булеве значення про факт запису на диск.

Внутрішні (не експортовані) функції модуля:

- `readJsonObject(path)` — м’який парсер JSON-обʼєкта з диска.
- `readAdjacentWorkspaceRootPackageJson(startDir)` — читання `package.json` поряд зі стартовою директорією за умови, що це workspace-root.

Константа модульного рівня:

- `PACKAGE_NAME` (`'@nitra/cursor'`) — імʼя пакету, який забезпечується у `devDependencies`.

Внутрішній стан модуля (обчислюється один раз під час імпорту):

- `scriptDir` — абсолютна директорія, в якій лежить сам файл (отримана з `import.meta.url`).
- `bundledPkgPath` — обчислений шлях до `package.json` пакету `@nitra/cursor`: на один рівень вище `scriptDir`, бо файл лежить у каталозі `scripts/` всередині пакету.

## Функції

### `readBundledPackageVersion()`

Сигнатура: `readBundledPackageVersion(): Promise<string | null>` (експортується).

Параметри: відсутні.

Поведінка:

1. Перевіряє існування файлу `bundledPkgPath` через `existsSync`. Якщо файлу немає — повертає `null` без подальшої роботи.
2. Читає вміст файлу як UTF-8 через `readFile`.
3. Парсить вміст як JSON.
4. Якщо поле `version` у розпарсеному обʼєкті є рядком — повертає його; інакше — повертає `null`.
5. Будь-яка помилка читання чи парсингу глушиться `try/catch` і дає `null`.

Повертає: `Promise<string | null>` — текстова версія (наприклад, `'1.11.14'`) або `null` за відсутності файлу / некоректного JSON / нерядкового `version`.

Side effects: лише read-IO (один read від диска). Нічого не пише й не логує.

### `readJsonObject(path)`

Сигнатура: `readJsonObject(path: string): Promise<Record<string, unknown> | null>` (внутрішня).

Параметри:

- `path` — абсолютний шлях до JSON-файлу.

Поведінка:

1. Намагається прочитати файл як UTF-8. Помилка читання повертає `null`.
2. Намагається розпарсити вміст як JSON. Помилка парсингу повертає `null`.
3. Перевіряє, що розпарсене значення — це не `null`, типу `object`, і не масив. Якщо умова не виконана — повертає `null`. Інакше повертає сам обʼєкт.

Повертає: `Promise<Record<string, unknown> | null>` — JSON-обʼєкт або `null`.

Side effects: read-IO.

### `readAdjacentWorkspaceRootPackageJson(startDir)`

Сигнатура: `readAdjacentWorkspaceRootPackageJson(startDir: string): Promise<{ path: string, pkg: Record<string, unknown> } | null>` (внутрішня).

Параметри:

- `startDir` — директорія, від якої починається пошук (зазвичай `process.cwd()` процесу CLI).

Поведінка:

1. Будує `pkgPath = join(startDir, 'package.json')`.
2. Через `existsSync` перевіряє наявність файлу. Якщо файлу немає — повертає `null`.
3. Викликає `readJsonObject(pkgPath)`. Якщо результат — не обʼєкт, повертає `null`.
4. Через `Object.hasOwn(pkg, 'workspaces')` перевіряє наявність поля `workspaces` (саме власне поле, а не з прототипа). Якщо поле є — повертає `{ path, pkg }`; інакше — `null`.

Повертає: `Promise<{ path, pkg } | null>` — пара «шлях/обʼєкт» для workspace-root або `null` для не-workspace-root.

Side effects: read-IO. Жодних мутацій диска / логів.

### `ensureNitraCursorInRootDevDependencies(root, options?)`

Сигнатура: `ensureNitraCursorInRootDevDependencies(root: string, options?: { bundledVersion?: string | null, silent?: boolean }): Promise<boolean>` (експортується).

Параметри:

- `root` — стартова директорія проєкту, зазвичай `process.cwd()` процесу CLI `n-cursor`.
- `options` — необовʼязковий обʼєкт:
  - `bundledVersion` — попередньо задана версія для тестів; якщо передано — використовується замість виклику `readBundledPackageVersion()`. `null` тут інтерпретується як «викликати fallback» через оператор `??`.
  - `silent` — якщо `true`, не друкувати повідомлення про оновлення у `stdout`.

Алгоритм:

1. Викликає `readAdjacentWorkspaceRootPackageJson(root)`. Якщо результат `null` (немає workspace-root) — повертає `false`.
2. Деструктурує `{ path: pkgPath, pkg }`.
3. Якщо в `pkg.devDependencies` (за умови, що це обʼєкт) присутній ключ `PACKAGE_NAME` — повертає `false` (вже є).
4. Якщо в `pkg.dependencies` (за умови, що це обʼєкт) присутній ключ `PACKAGE_NAME` — повертає `false` (вже є в runtime deps; додавати дубль до dev не потрібно).
5. Визначає версію: `options.bundledVersion ?? await readBundledPackageVersion()`. Якщо результат фолсі (`null`, порожній рядок) — повертає `false`.
6. Гарантує, що `pkg.devDependencies` — це валідний обʼєкт. Якщо там відсутнє поле, `null`, не-обʼєкт або масив — перезаписує його на `{}`.
7. Записує `pkg.devDependencies[PACKAGE_NAME] = ` `^<ver>`.
8. Серіалізує `pkg` з відступом 2 пробіли через `JSON.stringify(pkg, null, 2)`, додає завершальний перевід рядка `\n`, пише через `writeFile` у `pkgPath` у UTF-8.
9. Якщо `options.silent` не встановлено — друкує `📝 Додано <PACKAGE_NAME>@^<ver> у devDependencies у package.json\n` у `stdout` через `console.log`.
10. Повертає `true`.

Повертає: `Promise<boolean>` — `true`, якщо `package.json` дійсно змінено на диску; `false` у всіх no-op-ситуаціях (немає workspace-root, пакет вже задекларовано, версія недоступна).

Side effects:

- Читання `package.json` workspace-root.
- Можливий запис `package.json` workspace-root (мутація вмісту).
- Можливий запис у `stdout` через `console.log` (можна заглушити через `options.silent`).

Особливості:

- Перевірка «вже є в deps» поблажлива: якщо `devDependencies` / `dependencies` присутнє, але не є обʼєктом (некоректний `package.json`), модуль трактує це як «нема» і йде далі.
- Перезапис `pkg.devDependencies` на `{}` у випадку, коли поле не є обʼєктом, спрямований на корекцію некоректного стану `package.json`. Це означає, що нечитабельне поле буде втрачено.
- Серіалізація використовує `JSON.stringify` із відступом 2 і завершальним `\n`. Будь-яке стилістичне форматування з оригіналу (наприклад, табуляції чи tab-width=4) буде нормалізоване до 2 пробілів.

## Залежності

Зовнішніх npm-залежностей немає. Використовуються лише вбудовані модулі Node.js:

- `node:fs`
  - `existsSync` — синхронна перевірка існування файлу.
- `node:fs/promises`
  - `readFile` — асинхронне читання файлу як UTF-8.
  - `writeFile` — асинхронний запис файлу як UTF-8.
- `node:path`
  - `dirname` — отримати директорію з шляху.
  - `join` — побудувати шлях.
- `node:url`
  - `fileURLToPath` — конвертувати `file://`-URL у файловий шлях.

Зовнішні споживачі модуля:

- CLI `@nitra/cursor` (`bin`), що викликає `ensureNitraCursorInRootDevDependencies(process.cwd())` під час кожного запуску (зокрема перед `check`), щоб довести стан `package.json` проєкту до бажаного.
- Тестовий код може передавати `bundledVersion` у `options`, щоб не залежати від реальної версії з диска.

## Потік виконання / Використання

Типовий потік під час `npx @nitra/cursor check` у workspace-root:

1. CLI імпортує модуль і викликає `await ensureNitraCursorInRootDevDependencies(process.cwd())`.
2. Модуль читає `<cwd>/package.json`. Якщо там немає поля `workspaces` — це не workspace-root, повертається `false`, файл не змінюється.
3. Якщо `package.json` має `workspaces` і вже містить `@nitra/cursor` у `devDependencies` або `dependencies` — повертається `false`, файл не змінюється.
4. Інакше модуль читає `version` з `package.json` встановленого пакету `@nitra/cursor` (на рівень вище за `scripts/`), формує діапазон `^<version>` і записує його в `pkg.devDependencies['@nitra/cursor']`.
5. Серіалізований JSON записується назад у `<cwd>/package.json`.
6. У `stdout` логується повідомлення про додавання (якщо не задано `silent: true`).
7. Повертається `true`.

Приклад використання:

```js
import { ensureNitraCursorInRootDevDependencies } from '@nitra/cursor/scripts/ensure-nitra-cursor-dev-dependencies.mjs'

const changed = await ensureNitraCursorInRootDevDependencies(process.cwd())
if (changed) {
  // package.json було оновлено — можна підказати користувачу зробити bun install
}
```

Приклад використання з тестового сетапу:

```js
import { ensureNitraCursorInRootDevDependencies } from '../scripts/ensure-nitra-cursor-dev-dependencies.mjs'

await ensureNitraCursorInRootDevDependencies(tmpDir, {
  bundledVersion: '9.9.9',
  silent: true,
})
```

Передумови, на які покладається модуль:

- Файл `ensure-nitra-cursor-dev-dependencies.mjs` лежить у `<package>/scripts/`, а `package.json` пакету `@nitra/cursor` — у `<package>/package.json`. Якщо структуру переміщено, шлях `bundledPkgPath` стане некоректним.
- Робоче дерево, передане як `root`, має містити `package.json` із полем `workspaces`. Якщо CLI стартовано всередині workspace-пакету (а не в корені) — модуль нічого не зробить (`false`).
- Поле `version` у `package.json` пакету `@nitra/cursor` має бути рядком; інакше додавання не відбудеться.

Інваріант: повторні виклики модуля у тому самому проєкті стають no-op (другий виклик бачить `@nitra/cursor` у `devDependencies` і повертає `false`).
