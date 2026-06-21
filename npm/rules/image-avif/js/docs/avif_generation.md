---
type: JS Module
title: avif_generation.mjs
resource: npm/rules/image-avif/js/avif_generation.mjs
docgen:
  crc: 101bb0dd
---

Модуль реалізує перевірку правила `image-avif.mdc`: генерацію AVIF-двійників растрових зображень і ув'язування цих двійників із посиланнями у `.vue`- та `.html`-файлах монорепо. Експортує функцію `check`, яку викликає CLI `n-cursor` для команди `check image-avif` / `fix image-avif`.

Загальний сценарій роботи `check`:

1. **Pre-scan** — шукає у `.vue`/`.html` хоча б одне raster-посилання (через `import x from '...png'` або `<img src="...png" />`), яке потенційно треба переписати на AVIF-двійник. Пакети з opt-out `"@nitra/minify-image": { "disable-avif": true }` у `package.json` пропускаються. Якщо жодного raster-посилання не знайдено — модуль одразу повертає успіх і не запускає ні `npx`, ні rewrite, ні cleanup-пасс.
2. **AVIF-генерація** — викликає `npx @nitra/minify-image --src=. --write --avif`, який створює AVIF-двійники поряд з оригіналами.
3. **Rewrite-пасс** — для кожного workspace-пакета (без opt-out) переписує raster-посилання у `.vue`/`.html` на `<...>.avif`, якщо двійник реально існує на диску. Якщо двійника немає (наприклад, оригіналу теж нема) — фейлить конкретне посилання.
4. **Cleanup-пасс** — видаляє AVIF-сироти (`<...>.avif`, на які не лишилось жодного посилання у `.vue`/`.html` репозиторію), реалізуючи умову «AVIF лишається лише там, де заміна вдалася».

Модуль свідомо не дублює перевірки cache/dependency policy з правила `image-compress`. Правило `image-avif` самостійне й вмикається лише там, де AVIF підтримується (адмінки), а не у публічних сайтах.

## Експорти / API

| Експорт       | Тип              | Призначення                                                                         |
| ------------- | ---------------- | ----------------------------------------------------------------------------------- |
| `check(cwd?)` | `async function` | Точка входу перевірки `image-avif`; повертає exit-код (`0` — OK, `1` — є проблеми). |

Інші функції у модулі (`packageHasAvifDisabled`, `resolveImageCandidates`, `checkVueAvifImportsInPackage`, `checkVueAvifImports`, `hasAnyVueRasterReference`, `runAvifGeneration`, `cleanupOrphanAvifs`) — внутрішні, не експортуються.

## Константи

| Константа                        | Значення / форма                                                            | Призначення                                                                                                                                                                                                                                                                       |
| -------------------------------- | --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `MINIFY_PACKAGE_NAME`            | `'@nitra/minify-image'`                                                     | Імʼя CLI-пакета, який генерує AVIF (викликається через `npx`).                                                                                                                                                                                                                    |
| `PKG_CONFIG_FIELD`               | `'@nitra/minify-image'`                                                     | Поле у `package.json` для конфігу `@nitra/minify-image` (`disable-avif: true` тощо).                                                                                                                                                                                              |
| `CLEANUP_EXTRA_IGNORE_DIR_NAMES` | `Set` з `'build'`, `'android'`, `'ios'`, `'.output'`, `'.nuxt'`, `'.cache'` | Імена каталогів, які cleanup-пасс ігнорує додатково до стандартних (`node_modules`, `.git`, `dist`, `coverage`, `.turbo`, `.next`, які вже скіпає `walkDir`). Це артефакти збірки / нативних платформ — AVIF всередині є продуктом попереднього `bun run build` / Capacitor sync. |
| `VUE_RASTER_IMPORT_RE`           | `/import\s+\w[\w$]\*\s+from\s+['"]([^'"\n]+\.(?:png                         | jpe?g                                                                                                                                                                                                                                                                             | gif))['"]/giu`       | Регексп для `import name from '...ext'` у `.vue`/`.html`; група 1 — повний шлях до зображення.                                                                                 |
| `VUE_RASTER_STATIC_SRC_RE`       | `/(?<![:-_.])\bsrc\s*=\s*['"]([^'"\s]+\.(?:png                              | jpe?g                                                                                                                                                                                                                                                                             | gif))['"]/giu`       | Регексп для статичних `<img src="...png" />` у шаблоні `.vue`. Lookbehind `(?<![:\-_.])` виключає `:src="..."` (реактивний JS-вираз), `data-src="..."` і `obj.src=...`.        |
| `VUE_AVIF_REF_RE`                | `/['"]([^'"\s]+\.(?:png                                                     | jpe?g                                                                                                                                                                                                                                                                             | gif)\.avif)['"]/giu` | Регексп для готових AVIF-посилань у `.vue`/`.html`. Використовується тільки для збору множини «живих» AVIF — щоб після rewrite знати, які `<...>.avif` ще на щось посилаються. |

## Типи

### `RewriteStats`

```text
{
  rewrittenRefs: number   // скільки конкретних посилань переписано на .avif
  rewrittenFiles: number  // у скількох .vue/.html файлах хоч одне посилання змінилося
  failedRefs: number      // скільки конкретних посилань не вдалося переписати (.avif не існував)
}
```

Аґреговані лічильники по проходу `check image-avif`, мутуються `checkVueAvifImportsInPackage`, потрапляють у фінальний `pass`-меседж.

## Функції

### `packageHasAvifDisabled(pkg)`

- **Сигнатура:** `(pkg: Record<string, unknown>) => boolean`
- **Параметри:**
  - `pkg` — розібраний обʼєкт `package.json` пакета.
- **Повертає:** `true`, якщо у `package.json` встановлено `"@nitra/minify-image": { "disable-avif": true }`, інакше `false`.
- **Side effects:** немає.

### `resolveImageCandidates(importPath, sourceAbsPath, packageRootAbs)`

- **Сигнатура:** `(importPath: string, sourceAbsPath: string, packageRootAbs: string | null) => string[]`
- **Параметри:**
  - `importPath` — шлях з `import x from '...'` або `src="..."`.
  - `sourceAbsPath` — абсолютний шлях файла-джерела (`.vue`/`.html`).
  - `packageRootAbs` — абсолютний корінь workspace-пакета, у якому лежить джерело (для резолвера `/path` як `<root>/public<path>`); `null`, якщо невідомо.
- **Повертає:** впорядкований список абсолютних шляхів-кандидатів, по яких caller перевіряє існування `<candidate>` або `<candidate>.avif`.
- **Правила резолва:**
  - `./x.png`, `../x.png` — відносно файла-джерела.
  - `/x.png` (Vite/Quasar-конвенція) — спочатку `<packageRoot>/public/x.png`, потім `<packageRoot>/x.png`, нарешті `<cwd>/x.png` як legacy fallback.
  - голий шлях з принаймні одним `/` (наприклад `assets/img.png`) — relative-to-source, плюс `<packageRoot>/public/<path>` як другий кандидат.
  - bare-шлях без `/` (наприклад `foo`) — ймовірно alias-resolver Vite/Webpack; повертається порожній список → caller просто пропускає посилання, не звітує fail.
- **Side effects:** немає; шляхи будуються через `path.join`, файли не зачіпаються.

### `checkVueAvifImportsInPackage(packageRoot, otherRootsAbs, ignorePaths, usedAvifAbs, stats, fail, cwd)`

- **Сигнатура:** `async (packageRoot: string, otherRootsAbs: string[], ignorePaths: string[], usedAvifAbs: Set<string>, stats: RewriteStats, fail: (msg: string) => void, cwd: string) => Promise<void>`
- **Параметри:**
  - `packageRoot` — відносний шлях до кореня workspace-пакета (`'.'` або `'demo'`, тощо).
  - `otherRootsAbs` — абсолютні шляхи інших workspace-коренів; їхні піддерева пропускаються, щоб не сканувати один файл двічі.
  - `ignorePaths` — абсолютні шляхи каталогів, повністю виключених з обходу (зі `.cursorignore` тощо).
  - `usedAvifAbs` — мутабельна множина абсолютних шляхів `.avif`, що мають хоч одне посилання у `.vue`/`.html`; функція доповнює її.
  - `stats` — глобальні лічильники `RewriteStats`, мутуються тут.
  - `fail` — callback для звіту про помилку.
  - `cwd` — корінь репозиторію.
- **Повертає:** `Promise<void>`, який резолвиться по завершенню обробки пакета.
- **Side effects:**
  - Читає всі `.vue`/`.html` файли пакета через `walkDir`.
  - Перезаписує файли, у яких хоч одне посилання вдалось переписати (write-then-fail: запис відбувається ОДРАЗУ після обробки одного файла; провал на наступному файлі не відкочує вже записані зміни попередніх).
  - Мутує `usedAvifAbs` і `stats`.
  - Викликає `fail(msg)` для кожного raster-посилання, для якого AVIF-двійника немає на диску.
- **Логіка:**
  - Збирає `targetFiles` — лише `.vue`/`.html` у `absRoot`, що не належать іншим workspace-кореням.
  - Для кожного файла застосовує `processMatches` із двома регекспами: `VUE_RASTER_IMPORT_RE` і `VUE_RASTER_STATIC_SRC_RE`. У `replaceAll` для кожного матчу резолвить кандидатів через `resolveImageCandidates`; якщо `existsSync(c + '.avif')` знаходить двійник — переписує посилання на `<importPath>.avif`, інкрементує `rewrittenRefs`, додає до `usedAvifAbs`; якщо ні — інкрементує `failedRefs` і викликає `fail`. Bare-alias (порожній список кандидатів) — пропускається без fail.
  - Окремо проходить `VUE_AVIF_REF_RE` по оновленому контенту й додає до `usedAvifAbs` усі AVIF-кандидати, які існують на диску (це треба, щоб cleanup-пасс не видалив AVIF, на який є посилання поза rewrite-патернами).
  - Якщо контент змінився — записує файл і інкрементує `rewrittenFiles`.

### `checkVueAvifImports(ignorePaths, usedAvifAbs, stats, pass, fail, cwd)`

- **Сигнатура:** `async (ignorePaths: string[], usedAvifAbs: Set<string>, stats: RewriteStats, pass: (msg: string) => void, fail: (msg: string) => void, cwd: string) => Promise<string[]>`
- **Параметри:**
  - `ignorePaths` — абсолютні шляхи каталогів, повністю виключених з обходу.
  - `usedAvifAbs` — мутабельна множина абсолютних шляхів `.avif`, що мають живі посилання (заповнюється у викликаних функціях).
  - `stats` — глобальні лічильники `RewriteStats`, мутуються нижче.
  - `pass` — callback при успішній перевірці пакета.
  - `fail` — callback при помилці.
  - `cwd` — корінь репозиторію.
- **Повертає:** `Promise<string[]>` — абсолютні шляхи коренів пакетів з активним opt-out (`disable-avif: true`).
- **Side effects:**
  - Читає кожен `package.json` workspace-пакета.
  - Для пакетів з opt-out — викликає `pass` з повідомленням про вимикач і додає корінь до `optedOutAbs`.
  - Для решти — викликає `checkVueAvifImportsInPackage`, який може писати у файли.
- **Призначення `optedOutAbs`:** AVIF всередині opt-out пакета НЕ можна вважати сиротою лише на підставі відсутності посилань у його `.vue`/`.html` (ми взагалі не сканували його шаблони) — інакше cleanup помилково затирав би AVIF, що використовуються через alias / runtime-обчислений шлях / зовнішні посилання.

### `hasAnyVueRasterReference(ignorePaths, cwd)`

- **Сигнатура:** `async (ignorePaths: string[], cwd: string) => Promise<boolean>`
- **Параметри:**
  - `ignorePaths` — абсолютні шляхи каталогів, виключених з обходу.
  - `cwd` — корінь репозиторію.
- **Повертає:** `true`, якщо у `.vue`/`.html` пакетів без opt-out знайдено принаймні одне raster-посилання (`VUE_RASTER_IMPORT_RE` або `VUE_RASTER_STATIC_SRC_RE`); `false` — інакше.
- **Side effects:** немає (тільки читання файлів).
- **Призначення:** дешевий pre-scan, що дозволяє пропустити дорогий `npx @nitra/minify-image --avif` і rewrite/cleanup у проєктах, де AVIF не вживається.
- **Нюанс:** перед кожним `test`/`replaceAll` функція скидає `lastIndex` регекспа на `0`, оскільки регекспи з прапором `g` тримають стан між викликами.

### `runAvifGeneration(cwd)`

- **Сигнатура:** `(cwd: string) => void`
- **Параметри:**
  - `cwd` — корінь репозиторію, у якому запускається `npx`.
- **Повертає:** `void`.
- **Side effects:**
  - Викликає `spawnSync(npxPath, ['@nitra/minify-image', '--src=.', '--write', '--avif'], { stdio: 'inherit', cwd, env })`, який генерує AVIF-двійники.
  - Логує попередження (`console.log`) при відсутності `npx` у PATH, помилці спавна або ненульовому коді виходу — без падіння перевірки.
- **Best-effort семантика:** якщо мережа/кеш недоступні чи бінарника нема — лог-варн без винятку; перевірка vue/html все одно виявить файли, для яких не вистачає `.avif`.
- **Опт-аут запуску:** якщо `process.env.NITRA_CURSOR_NO_AVIF_RUN === '1'` — функція no-op (потрібно для тестів та ізольованих середовищ).
- **Resolver `npx`:** `resolveCmd('npx')` повертає повний шлях; якщо `null` — функція друкує попередження і виходить.

### `cleanupOrphanAvifs(usedAvifAbs, optedOutAbs, ignorePaths, cwd)`

- **Сигнатура:** `async (usedAvifAbs: Set<string>, optedOutAbs: string[], ignorePaths: string[], cwd: string) => Promise<number>`
- **Параметри:**
  - `usedAvifAbs` — абсолютні шляхи `.avif`, що мають живі посилання (їх не чіпаємо).
  - `optedOutAbs` — абсолютні шляхи коренів opt-out пакетів; AVIF під ними не вважаємо сиротами.
  - `ignorePaths` — абсолютні шляхи каталогів, виключених з обходу.
  - `cwd` — корінь репозиторію.
- **Повертає:** `Promise<number>` — кількість видалених сиріт.
- **Side effects:** видаляє `.avif` файли через `unlink`.
- **Фільтр кандидатів:**
  - файл закінчується на `.avif`;
  - не присутній у `usedAvifAbs`;
  - не лежить під жодним з `optedOutAbs`;
  - жоден сегмент шляху не входить у `CLEANUP_EXTRA_IGNORE_DIR_NAMES` (`build`, `android`, `ios`, `.output`, `.nuxt`, `.cache`).
- **Ідемпотентність:** opt-out гарантує, що повторний `check image-avif` не починає циклічно видаляти AVIF в пакетах, що вимкнули правило (наприклад, мобільний бандл).

### `check(cwd = process.cwd())` — експортована точка входу

- **Сигнатура:** `async (cwd?: string) => Promise<number>`
- **Параметри:**
  - `cwd` — корінь репозиторію; за замовчуванням `process.cwd()`.
- **Повертає:** `Promise<number>` — exit-код (`0` — OK, `1` — є проблеми), отриманий з `reporter.getExitCode()`.
- **Side effects:**
  - Створює `createCheckReporter()` для агрегації pass/fail-меседжів.
  - Завантажує `ignorePaths` через `loadCursorIgnorePaths(cwd)`.
  - Якщо `hasAnyVueRasterReference` повернула `false` — викликає `pass(...)` з відповідним повідомленням і одразу повертає exit-код (без AVIF-генерації, rewrite, cleanup).
  - Інакше: викликає `runAvifGeneration(cwd)`, потім `checkVueAvifImports(...)` (rewrite + збір usedAvifAbs + список optedOutAbs), потім `cleanupOrphanAvifs(...)`, фіксує підсумкове `pass(...)` з кількістю переписаних посилань, файлів, видалених сиріт і фейлів. Фейли всередині rewrite-пасу йдуть через `fail(...)` і впливають на exit-код.

## Залежності

### Node.js builtins

- `node:fs` — `existsSync` (синхронна перевірка наявності файла, бо викликається у тісному `replaceAll`-циклі).
- `node:fs/promises` — `readFile`, `writeFile`, `unlink`.
- `node:path` — `join`, `relative`.
- `node:child_process` — `spawnSync` для запуску `npx @nitra/minify-image`.
- `node:process` — `env` (для опт-ауту `NITRA_CURSOR_NO_AVIF_RUN=1`); також глобально використовується `process.cwd()` у `resolveImageCandidates` і дефолтному параметрі `check`.

### Внутрішні модулі (n-cursor)

- `../../../scripts/lib/check-reporter.mjs` → `createCheckReporter` — фабрика обʼєкта зі `pass`/`fail`/`getExitCode`.
- `../../../scripts/lib/load-cursor-config.mjs` → `loadCursorIgnorePaths` — завантажує абсолютні шляхи каталогів, які треба ігнорувати при обході.
- `../../../scripts/utils/resolve-cmd.mjs` → `resolveCmd` — резолвить абсолютний шлях до CLI-бінарника у `PATH`.
- `../../../scripts/utils/walkDir.mjs` → `walkDir` — рекурсивний обхід директорії з вбудованим скіпом `node_modules`, `.git`, `dist`, `coverage`, `.turbo`, `.next` та користувацьким callback.
- `../../../scripts/lib/workspaces.mjs` → `getMonorepoPackageRootDirs` — повертає відносні шляхи коренів workspace-пакетів монорепо.

### Зовнішні CLI

- `npx` — резолвиться через `resolveCmd`; запускає `@nitra/minify-image` через `npx`.
- `@nitra/minify-image` — окремий npm-пакет, який і генерує AVIF-двійники (`--src=. --write --avif`).

## Потік виконання / Використання

### Виклик з CLI

Модуль викликається з реєстру правил `n-cursor` як check-функція правила `image-avif`. Очікувана крапка входу:

```js
import { check } from './npm/rules/image-avif/js/avif_generation.mjs'

const exitCode = await check(process.cwd())
process.exit(exitCode)
```

### Послідовність кроків у `check(cwd)`

1. Створюється reporter (`createCheckReporter`).
2. Завантажується `ignorePaths` через `loadCursorIgnorePaths(cwd)`.
3. **Pre-scan**: `hasAnyVueRasterReference(ignorePaths, cwd)` обходить пакети без opt-out, шукає raster-посилання. Якщо нема — `pass(...)` і ранній вихід.
4. **AVIF-генерація**: `runAvifGeneration(cwd)` — викликає `npx @nitra/minify-image --src=. --write --avif`, який створює AVIF-двійники. Опціонально вимикається через `NITRA_CURSOR_NO_AVIF_RUN=1`.
5. **Rewrite-пасс**: `checkVueAvifImports(...)` обходить кожен workspace-пакет:
   - Якщо `package.json` має `disable-avif: true` — `pass(...)` і додає корінь у `optedOutAbs`.
   - Інакше — `checkVueAvifImportsInPackage(...)` обробляє кожен `.vue`/`.html` у пакеті: переписує raster-посилання на `.avif` (якщо двійник існує), фейлить ті, для яких двійника нема, збирає `usedAvifAbs`.
6. **Cleanup-пасс**: `cleanupOrphanAvifs(usedAvifAbs, optedOutAbs, ignorePaths, cwd)` видаляє `.avif`, на які не лишилось живих посилань, з врахуванням opt-out і списку артефактів збірки.
7. Фінальний `pass(...)` з підсумком: скільки посилань переписано, у скількох файлах, скільки сиріт видалено, скільки фейлів rewrite.
8. Повертається `reporter.getExitCode()` — `1`, якщо був хоч один `fail`, інакше `0`.

### Опт-аут на рівні пакета

Щоб вимкнути AVIF-перевірку у конкретному workspace-пакеті, у його `package.json` додається:

```json
{
  "@nitra/minify-image": {
    "disable-avif": true
  }
}
```

Наслідки:

- pre-scan ігнорує цей пакет (його raster-посилання не провокують запуск `npx --avif`);
- rewrite-пасс не сканує і не змінює його `.vue`/`.html`;
- cleanup-пасс не видаляє `.avif` під його коренем (бо ми не зібрали `usedAvifAbs` для нього).

### Опт-аут запуску `npx`

Змінна середовища `NITRA_CURSOR_NO_AVIF_RUN=1` повністю вимикає виклик `npx @nitra/minify-image --avif`. Pre-scan, rewrite і cleanup при цьому працюють як зазвичай — потрібно для юніт-тестів і ізольованих CI-середовищ.

### Семантика помилок

- **Бракує `.avif`-двійника** — fail на конкретний `.vue`/`.html`-файл і конкретний `importPath` з підказкою про `npx @nitra/cursor fix image-avif` та локальний opt-out.
- **`npx` недоступний / падає** — лише warn у `console.log`, без переривання перевірки; fail прийде пізніше від rewrite-пасу, якщо `.avif` так і не з'явилися.
- **Bare alias** (`'foo'` без `/`) — резолвера нема, посилання пропускається без fail.
