---
type: JS Module
title: package-manifest.mjs
resource: npm/rules/changelog/lib/package-manifest.mjs
docgen:
  crc: ced8ad49
---

Модуль `package-manifest.mjs` реалізує **уніфіковану абстракцію маніфесту пакета** для перевірок changelog у багатомовному монорепо. Він приховує відмінності між двома типами маніфестів:

- **npm / JS** — файл `package.json` (з полями `name`, `version`, `private`, `files`).
- **Python** — файл `pyproject.toml` (PEP 621 → таблиця `[project]`, або застаріший формат Poetry → таблиця `[tool.poetry]`).

Модуль надає три високорівневі операції:

1. **Розбір** `pyproject.toml` для витягання `name` та `version` (через `smol-toml`).
2. **Читання маніфесту воркспейсу** в єдиній структурі `PackageManifest` (з пріоритетом `package.json` над `pyproject.toml`).
3. **Виявлення коренів усіх пакетів монорепо**: npm-воркспейси через скрипт `workspaces.mjs` + автоматичний пошук Python-проєктів за `pyproject.toml`.

Базова мета — дати правилам категорії `changelog` єдину модель «пакет = (kind, ws, name, version, registryPublishable)», незалежно від мови.

## Експорти / API

Усі експорти — **іменовані** (`export function …`). Експорту за замовчуванням немає.

| Експорт                                 | Тип                                                             | Призначення                                                                      |
| --------------------------------------- | --------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `parsePyprojectFields(text)`            | `(string) => { name: string \| null, version: string \| null }` | Розпарсити сирий TOML-текст `pyproject.toml` і витягти `name` / `version`.       |
| `readPackageManifest(ws, cwd?)`         | `(string, string?) => Promise<PackageManifest \| null>`         | Прочитати маніфест конкретного воркспейсу (`package.json` або `pyproject.toml`). |
| `getMonorepoProjectRootDirs(repoRoot?)` | `(string?) => Promise<string[]>`                                | Перелічити всі каталоги-корені пакетів монорепо (npm + Python).                  |
| `manifestFilePath(ws, manifest)`        | `(string, PackageManifest) => string`                           | Зібрати відносний шлях до файлу маніфесту воркспейсу.                            |

### Типи (JSDoc)

```js
/** @typedef {'npm' | 'python'} PackageKind */

/**
 * @typedef {object} PackageManifest
 * @property {PackageKind} kind           тип маніфесту
 * @property {string} ws                  відносний шлях воркспейсу ('.' для кореня)
 * @property {string} manifestRel         'package.json' | 'pyproject.toml'
 * @property {string | null} name         ім'я пакета (npm / PyPI)
 * @property {string | null} version      semver-рядок
 * @property {boolean} registryPublishable чи застосовується режим порівняння з реєстром
 * @property {string[] | null} [npmFiles] лише npm: 'files' з package.json
 */
```

### Константи модуля

- `PYPROJECT_GLOB_IGNORE = ['**/node_modules/**', '**/.git/**', '**/.venv/**', '**/venv/**']` — патерни, що **виключаються** під час сканування `pyproject.toml` глобом, щоб не зачіпати чужі залежності та віртуальні середовища.

## Функції

### `projectFieldsFromPyprojectDoc(doc)` (внутрішня)

- **Сигнатура:** `(doc: unknown) => { name: string | null, version: string | null }`
- **Параметри:**
  - `doc` — результат `parse` зі `smol-toml` (очікується об'єкт верхнього рівня TOML).
- **Повертає:** об'єкт `{ name, version }`, де обидва поля — `string` або `null`.
- **Логіка:**
  1. Якщо `doc` не є чистим об'єктом (`null`, примітив, масив) — повертає `{ null, null }`.
  2. Якщо є таблиця `[project]` (PEP 621): бере `project.name` і `project.version`, але лише якщо вони — `string`; інакше — `null`.
  3. Якщо `[project]` відсутня — пробує застарілу таблицю `[tool.poetry]`: бере `tool.poetry.name` і `tool.poetry.version` за тим самим правилом.
  4. Якщо обидві таблиці відсутні — повертає `{ null, null }`.
- **Side effects:** немає (чиста функція).
- **Примітка:** функція не експортується; зовнішній API — це `parsePyprojectFields`, який додає захист від помилок парсингу TOML.

### `parsePyprojectFields(text)`

- **Сигнатура:** `(text: string) => { name: string | null, version: string | null }`
- **Параметри:**
  - `text` — повний текст файлу `pyproject.toml`.
- **Повертає:** ті самі поля, що й `projectFieldsFromPyprojectDoc`.
- **Логіка:**
  1. Викликає `parseToml(text)` (зі `smol-toml`).
  2. Передає результат у `projectFieldsFromPyprojectDoc`.
  3. На будь-якій помилці парсингу (синтаксис, тощо) — повертає `{ null, null }`. Помилка **проковтується** (catch без логування), щоб некоректний TOML не зривав весь процес перевірки changelog.
- **Side effects:** немає (CPU-only; жодного IO).

### `readPackageManifest(ws, cwd = process.cwd())`

- **Сигнатура:** `(ws: string, cwd?: string) => Promise<PackageManifest | null>`
- **Параметри:**
  - `ws` — відносний шлях воркспейсу від `cwd` (наприклад, `npm/rules/changelog` або `.` для кореня).
  - `cwd` — корінь репозиторію; за замовчуванням `process.cwd()`.
- **Повертає:** `PackageManifest` або `null`, якщо ні `package.json`, ні `pyproject.toml` у воркспейсі не існують або не парсяться.
- **Логіка (з пріоритетом npm > python):**
  1. **Гілка npm:**
     - Складає шлях `cwd/ws/package.json` (через `node:path.join`).
     - `existsSync` → якщо файлу немає, переходить до гілки Python.
     - Читає текст через `readFile(pkgPath, 'utf8')` і парсить як JSON.
     - Якщо JSON — не об'єкт (null, масив, примітив), повертає `null`.
     - Обчислює `registryPublishable = name є непорожнім рядком && private !== true && files є масивом`. Тобто пакет вважається «публікованим у реєстр», тільки якщо в `package.json` явно вказано непорожній `name`, не зведено `private: true`, і визначено поле `files` (whitelist того, що публікується).
     - Повертає об'єкт із `kind: 'npm'`, `manifestRel: 'package.json'`, з `name`/`version` (тільки якщо вони — рядки, інакше `null`), `registryPublishable`, `npmFiles = pkg.files` або `null`.
     - Будь-яка помилка читання/парсингу JSON у блоці `try` → повертає `null` (catch без логування).
  2. **Гілка Python:**
     - Складає шлях `cwd/ws/pyproject.toml`.
     - `existsSync` → якщо файлу немає, повертає `null`.
     - Читає файл і викликає `parsePyprojectFields`.
     - `registryPublishable = Boolean(name && version)` — для Python публікація в PyPI потребує лише валідних `name` і `version` (PyPI не має аналога `files` whitelist).
     - Повертає об'єкт із `kind: 'python'`, `manifestRel: 'pyproject.toml'`, `npmFiles: null`.
- **Side effects:**
  - Синхронний `existsSync` (двічі: на `package.json` і `pyproject.toml`).
  - Асинхронне читання файлу через `fs/promises.readFile`.
- **Гарантія:** функція **ніколи не кидає** — усі помилки IO/парсингу повертаються як `null`.

### `getMonorepoProjectRootDirs(repoRoot = '.')`

- **Сигнатура:** `(repoRoot?: string) => Promise<string[]>`
- **Параметри:**
  - `repoRoot` — корінь репозиторію (за замовчуванням `'.'`).
- **Повертає:** відсортований масив **унікальних** відносних шляхів воркспейсів — кандидатів на пакет.
- **Логіка:**
  1. Створює `Set<string>` з результату `getMonorepoPackageRootDirs(repoRoot)` — це npm-воркспейси, оголошені в `package.json` (`workspaces`) кореня.
  2. **Кореневий Python-проєкт:** якщо в корені існує `pyproject.toml`, але **немає** `package.json`, додає `'.'` у множину. Це покриває випадок «репо — чистий Python-проєкт без npm».
  3. **Сканування підкаталогів:** через `fs/promises.glob('**/pyproject.toml', { cwd: repoRoot, ignore: PYPROJECT_GLOB_IGNORE })` ітерує по знайдених файлах:
     - Обчислює абсолютний каталог `dirname(join(repoRoot, relPy))`.
     - Перетворює його на відносний від `repoRoot` шлях; порожній рядок нормалізує до `'.'`.
     - Додає у множину, **тільки якщо** одночасно:
       - воркспейс **не** в чорному списку `isIgnoredWorkspaceRoot(ws)`;
       - у тому самому каталозі **немає** `package.json` (тобто це чисто Python-пакет, а не змішаний).
  4. Фінально фільтрує множину ще раз через `isIgnoredWorkspaceRoot` (захист на випадок, якщо `getMonorepoPackageRootDirs` повернув ігнорований шлях).
  5. **Сортування:** `'.'` завжди першим, далі — лексикографічно за `localeCompare`.
- **Side effects:**
  - Синхронний `existsSync` (двічі для кореня + по разу для кожного знайденого підкаталогу).
  - Асинхронна ітерація глобом по файловій системі (рекурсивний обхід `repoRoot`).
- **Чому Python з `package.json` ігнорується:** пріоритет npm — якщо в одному каталозі є обидва файли, він уже потрапить як npm-воркспейс через `getMonorepoPackageRootDirs`; додавати його ще раз як Python — дубль.

### `manifestFilePath(ws, manifest)`

- **Сигнатура:** `(ws: string, manifest: PackageManifest) => string`
- **Параметри:**
  - `ws` — відносний шлях воркспейсу.
  - `manifest` — об'єкт `PackageManifest`.
- **Повертає:** `join(ws, manifest.manifestRel)` — наприклад, `'npm/rules/changelog/package.json'` або `'apps/foo/pyproject.toml'`.
- **Side effects:** немає (чиста функція над рядками).
- **Примітка:** не використовує `cwd` — повертає шлях відносний до кореня репо, придатний для логів та повідомлень про помилки.

## Залежності

### Зовнішні (npm)

- **`smol-toml`** — мінімалістичний парсер TOML; імпортується іменований експорт `parse as parseToml`. Використовується тільки в `parsePyprojectFields` для розбору `pyproject.toml`.

### Стандартна бібліотека Node.js

- **`node:fs`** → `existsSync` — синхронна перевірка існування файлу. Використовується замість асинхронного `access`, бо викликається лінійно (не в гарячому циклі) і простіше у читанні.
- **`node:fs/promises`** → `glob`, `readFile` — асинхронний обхід FS та читання тексту.
- **`node:path`** → `dirname`, `join`, `relative` — кросплатформенна робота зі шляхами.

### Внутрішні (монорепо)

- **`../../../scripts/lib/workspaces.mjs`** (тобто `npm/scripts/lib/workspaces.mjs`):
  - `getMonorepoPackageRootDirs(repoRoot)` — повертає список npm-воркспейсів кореневого `package.json`.
  - `isIgnoredWorkspaceRoot(ws)` — фільтр для воркспейсів, які треба свідомо ігнорувати (`.git`, шаблони, тощо).

### Контракти, що **не** імпортуються, але передбачаються

- Структура `package.json`: поля `name: string`, `version: string`, `private?: boolean`, `files?: string[]`.
- Структура `pyproject.toml`: таблиці `[project]` (PEP 621) і `[tool.poetry]` (legacy Poetry) з полями `name`, `version`.

## Потік виконання / Використання

### Типовий сценарій: перевірка changelog для всього монорепо

```js
import { getMonorepoProjectRootDirs, readPackageManifest, manifestFilePath } from './package-manifest.mjs'

const roots = await getMonorepoProjectRootDirs(process.cwd())
// roots ≈ ['.', 'apps/admin', 'npm/rules/changelog', 'python/tooling/foo', ...]

for (const ws of roots) {
  const manifest = await readPackageManifest(ws)
  if (!manifest) continue // ні package.json, ні pyproject.toml — пропускаємо
  if (!manifest.registryPublishable) continue // приватні / без 'files' / без version — не публікуються
  console.log(manifest.kind, manifestFilePath(ws, manifest), manifest.name, manifest.version)
}
```

### Послідовність викликів усередині `getMonorepoProjectRootDirs`

1. `getMonorepoPackageRootDirs(repoRoot)` → npm-воркспейси.
2. `existsSync('pyproject.toml')` + `existsSync('package.json')` на корені → опційно `'.'`.
3. `glob('**/pyproject.toml')` → ітерація по підкаталогах:
   - Для кожного `relPy` обчислити `ws`.
   - `isIgnoredWorkspaceRoot(ws)` + `existsSync(join(repoRoot, ws, 'package.json'))` → фільтр.
4. Фінальна фільтрація + сортування.

### Послідовність викликів усередині `readPackageManifest`

1. `existsSync(cwd/ws/package.json)`:
   - **Так** → `readFile` + `JSON.parse` + перевірка типу → npm-маніфест або `null`.
   - **Ні** → крок 2.
2. `existsSync(cwd/ws/pyproject.toml)`:
   - **Ні** → `null`.
   - **Так** → `readFile` + `parsePyprojectFields` → python-маніфест.

### Інваріанти

- Якщо `kind === 'npm'`, то `manifestRel === 'package.json'`. Якщо `kind === 'python'`, то `manifestRel === 'pyproject.toml'`.
- `npmFiles` ніколи не визначений для `kind === 'python'` (там завжди `null`).
- `registryPublishable` має різний зміст за `kind`:
  - npm: `name && !private && Array.isArray(files)`;
  - python: `name && version`.
- Усі функції безпечні щодо помилок IO/парсингу: повертають `null` / `{ null, null }` замість викидання винятків.

### Обмеження та крайні випадки

- **Глобальний обхід `**/pyproject.toml`** може бути повільним на дуже великих репо; список ігнорованих шляхів (`PYPROJECT_GLOB_IGNORE`) покриває типові важкі директорії, але не доменно-специфічні (наприклад, `dist/`).
- **Перевірка типу JSON-кореня** — захист від `null`, масивів та примітивів, але не від «дивних» значень полів (наприклад, `version: 123`); такі значення безшумно перетворюються на `null`.
- **`projectFieldsFromPyprojectDoc`** не підтримує **dynamic version** (PEP 621 `dynamic = ['version']`) — у такому разі `version === null`.
- **`isIgnoredWorkspaceRoot`** застосовується двічі (під час додавання та фінальної фільтрації) — це навмисна перестраховка.
