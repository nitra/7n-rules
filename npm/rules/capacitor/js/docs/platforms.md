# platforms.mjs

## Огляд

Модуль `platforms.mjs` реалізує **check** для правила `capacitor.mdc`: перевіряє, що проєкт-застосунок на базі **Capacitor** відповідає політикам монорепо Nitra. Файл експортує асинхронну функцію `check(cwd)`, яка повертає **exit-код** (0 — ok, 1 — fail), а також низку допоміжних чистих функцій для розбору **npm**-діапазонів версій, обходу `package.json` та пошуку `Podfile` у каталозі `ios/`.

Перевірка послідовно виконує три блоки логіки:

1. **Виявлення Capacitor у репозиторії.** Capacitor вважається задіяним, якщо в корені присутній один із файлів `capacitor.config.json` / `capacitor.config.ts` / `capacitor.config.mjs`, **або** хоч у одному `package.json` (рекурсивний обхід дерева з пропуском типових каталогів) задекларовано пакет із префіксом `@capacitor/` у будь-якому блоці залежностей (`dependencies`, `devDependencies`, `optionalDependencies`, `peerDependencies`). Якщо ознак немає — check одразу повертає **pass** і код **0**, не вимагаючи жодних дій.
2. **Перевірка мінімальної версії `@capacitor/core` ≥ 8.** Для кожного `package.json`, який оголошує `@capacitor/core`, обчислюється **нижня межа major** з рядка npm-діапазону. Якщо вона менша за `MIN_CAPACITOR_MAJOR = 8`, або діапазон не вдалося визначити (`*`, `latest`, `x`, незрозумілий синтаксис) — це fail; повідомлення підказує задати, наприклад, `^8.0.0`. Якщо `capacitor.config.*` знайдено, а `@capacitor/core` у дереві відсутній — теж fail.
3. **iOS / Podfile.** За політикою `capacitor.mdc` iOS-частина Capacitor-застосунку повинна збиратися лише через **SPM**, без CocoaPods. Рекурсивний обхід `ios/` (пропускаючи `Pods`, `build`, `DerivedData`) шукає перший `Podfile`. Якщо `Podfile` є, він вважається порушенням, **окрім** випадку коли в кореневому `package.json` або в `capacitor.config.{json,ts,mjs}` присутній об’єкт `nitra` із прапором `iosCocoaPodsBecausePluginsLackSpm: true` або `iosCocoaPodsAllowed: true`. Якщо каталогу `ios/` немає — умова не застосовується.

Усі повідомлення про результат виводяться через `createCheckReporter()` зі спільного хелпера `scripts/lib/check-reporter.mjs`.

## Експорти / API

Файл експортує іменовані символи (без default export):

- `capacitorSegmentMinMajor(segment)` — мінімальний **major** для одного OR-сегмента npm-діапазону.
- `capacitorVersionRangeMinMajor(versionRange)` — мінімальний **major** для повного діапазону, з підтримкою `||`.
- `isCapacitorCoreVersionAtLeast8(versionRange, min?)` — булеан-предикат: чи нижня межа діапазону `≥ min` (за замовчуванням `MIN_CAPACITOR_MAJOR`).
- `recordCapacitorFromOnePackageJson(absPath, root, out)` — асинхронно прочитати один `package.json` і поповнити акумулятор.
- `collectCapacitorDataFromAllPackageJson(root, out)` — рекурсивно обійти всі `package.json` у репозиторії, агрегуючи `byPath` і `anyCapacitor`.
- `hasCapacitorConfigInRoot(root)` — синхронно перевірити наявність `capacitor.config.{json,ts,mjs}` у корені.
- `isCapacitorRelevantForCheck(root, anyCapacitor)` — чи варто застосовувати правила Capacitor взагалі.
- `walkIosForPodfileSkipPods(root, dir, onPodfileRelative)` — рекурсивний пошук `Podfile` під `ios/` із пропуском службових тек.
- `findFirstPodfileUnderIosExcludingPods(root)` — повертає **найкоротший** posix-relative шлях до першого знайденого `Podfile` (або `null`).
- `nitrAObjectAllowsIosCocoaPods(o)` — предикат для об’єкта `nitra`: чи дозволено CocoaPods.
- `check(cwd?)` — головна функція **check**; повертає **exit-код**.

Внутрішні (неекспортовані) функції: `firstVersionMajorFromNpmValue`, `reportOneCapacitorCoreRange`, `recordCapacitorFromDependencyObject`, `extractNitraObjectBodySource`, `nitraObjectBodyStringAllowsCocoaPodsExempt`, `pathJsonShowsNitraCocoapodsExempt`, `capacitorConfigTsMjsNitraCocoapodsExempt`, `isIosCocoaPodsExemptByNitraConfig`.

Константи модульного рівня:

- `MIN_CAPACITOR_MAJOR = 8` — мінімальний допустимий **major** Capacitor.
- `IGNORED_DIRS_FOR_PACKAGE_JSON` — `Set` каталогів, які пропускаються при обході (`node_modules`, `.git`, `dist`, `coverage`, `Pods`, `.turbo`, `.next`, `build`).
- Регулярки: `NPM_OR_PARTS_RE` (`\s*\|\|\s*`), `NPM_HYPHEN_RANGE_RE` (`^(.+?)\s+-\s+(.+)$`), `FIRST_VERSION_NUM_RE` (`^(?:v)?(\d+)`), `PREFIX_GEQ_RE` (`^>=\s*`), `PREFIX_GT_RE` (`^>\s*`), `STRIP_CARET_TILDE_EQ_RE` (`^[=^~]+\s*`), `RE_NITRA_CONFIG_OBJECT_LEAD_IN` (початок блоку `nitra: {` у TS/MJS), `RE_COCOAPODS_EXEMPT_SPM` (`iosCocoaPodsBecausePluginsLackSpm: true`), `RE_COCOAPODS_EXEMPT_ALLOW` (`iosCocoaPodsAllowed: true`).

## Функції

### `capacitorSegmentMinMajor(segment)`

- **Сигнатура:** `(segment: string) => number | null`
- **Параметри:** `segment` — одна частина npm-діапазону (без `||` всередині).
- **Повертає:** мінімальний **major**, який задовольняється сегментом; `null`, якщо сегмент — `*`, `x` (case-insensitive) або `latest`, або якщо вхід не рядок чи порожній.
- **Логіка:**
  - Не-рядок або порожній рядок після `trim()` → `null`.
  - `*`, `x` (нижній регістр), `latest` → `null` (невизначена нижня межа).
  - Префікс `<` або `<=` → `0` (теоретично може допускати дуже старі major-и).
  - Префікс `>` (але не `>=`) → витягає число з решти рядка через `firstVersionMajorFromNpmValue`.
  - Дефіс-діапазон `a - b` (`NPM_HYPHEN_RANGE_RE`) → бере major лівої межі.
  - Префікси `^`, `~`, `=` → знімає їх і повертає major першого числа.
  - Префікс `>=` → знімає його і повертає major.
  - Інакше — повертає major першого числа в рядку.
- **Side effects:** немає (чиста функція).

### `firstVersionMajorFromNpmValue(t)` _(внутрішня)_

- **Сигнатура:** `(t: string) => number | null`
- **Параметри:** `t` — фрагмент рядка версії без префікса операторів.
- **Повертає:** перше ціле число (major), знайдене регуляркою `FIRST_VERSION_NUM_RE` (опційний префікс `v`); `null`, якщо число не знайдено або рядок порожній.
- **Side effects:** немає.

### `capacitorVersionRangeMinMajor(versionRange)`

- **Сигнатура:** `(versionRange: string) => number | null`
- **Параметри:** `versionRange` — повне значення поля для `@capacitor/core` з `package.json`.
- **Повертає:** найменший (нижній) **major** серед усіх OR-частин; `null`, якщо хоча б одна частина — `*` / `latest` / `x` / нерозпізнана (тобто діапазон вважається небезпечним).
- **Логіка:** розбиває за `||`, кожну частину пропускає через `capacitorSegmentMinMajor`, ранній вихід із `null` при першій невизначеній; інакше — мінімум серед усіх отриманих чисел.
- **Side effects:** немає.

### `isCapacitorCoreVersionAtLeast8(versionRange, min = MIN_CAPACITOR_MAJOR)`

- **Сигнатура:** `(versionRange: string, min?: number) => boolean`
- **Параметри:** `versionRange` — рядок версії; `min` — нижній поріг major (за замовчуванням **8**).
- **Повертає:** `true`, якщо нижня межа діапазону визначена і `>= min`; інакше — `false` (зокрема для `*`, `latest`).
- **Side effects:** немає.

### `reportOneCapacitorCoreRange(fail, pass, rel, range)` _(внутрішня)_

- **Сигнатура:** `(fail: (m: string) => void, pass: (m: string) => void, rel: string, range: string) => void`
- **Параметри:** `fail`, `pass` — друк-колбеки reporter; `rel` — posix-relative шлях `package.json`; `range` — значення `@capacitor/core`.
- **Повертає:** `void`.
- **Side effects:** викликає `pass(...)` або `fail(...)` зі сформованим повідомленням, у якому згадано `MIN_CAPACITOR_MAJOR` та рекомендацію `^8.0.0`.

### `recordCapacitorFromDependencyObject(rel, obj, out)` _(внутрішня)_

- **Сигнатура:** `(rel: string, obj: Record<string, unknown>, out: { byPath: Map<string, string>, anyCapacitor: boolean }) => void`
- **Параметри:** `rel` — relative-шлях `package.json`; `obj` — один із блоків залежностей; `out` — акумулятор.
- **Повертає:** `void`.
- **Side effects:**
  - Виставляє `out.anyCapacitor = true`, якщо знайдено будь-який ключ, що починається з `@capacitor/`.
  - Якщо ключ — рівно `@capacitor/core` і значення — непорожній рядок, кладе пару `rel → range` в `out.byPath`. Повторні записи з різних блоків залежностей перезаписують одне одного (останній блок перемагає в порядку `dependencies → devDependencies → optionalDependencies → peerDependencies`).

### `recordCapacitorFromOnePackageJson(absPath, root, out)`

- **Сигнатура:** `(absPath: string, root: string, out: { byPath: Map<string, string>, anyCapacitor: boolean }) => Promise<void>`
- **Параметри:** `absPath` — абсолютний шлях до `package.json`; `root` — корінь репозиторію; `out` — акумулятор.
- **Повертає:** `Promise<void>`.
- **Side effects:**
  - Читає файл через `readFile(absPath, 'utf8')`; будь-яка помилка вводу/виводу мовчазно повертає керування (файл пропускається).
  - Парсить JSON; помилка парсингу — теж мовчазне пропускання.
  - Обчислює posix-relative шлях відносно `root` (з заміною `\` на `/`); якщо `relative()` повертає порожній рядок — підставляє `absPath`.
  - Для кожного блоку залежностей, що є об’єктом (не масив, не `null`/`undefined`), викликає `recordCapacitorFromDependencyObject`.

### `collectCapacitorDataFromAllPackageJson(root, out)`

- **Сигнатура:** `(root: string, out: { byPath: Map<string, string>, anyCapacitor: boolean }) => Promise<void>`
- **Параметри:** `root` — корінь обходу; `out` — акумулятор (буде ініціалізовано).
- **Повертає:** `Promise<void>`.
- **Side effects:**
  - На початку **скидає** `out.anyCapacitor = false`; якщо `out.byPath` уже існує — викликає `.clear()`, інакше створює нову `Map`.
  - Внутрішня функція `walk(dir)` робить `readdir(dir, { withFileTypes: true })`; помилку каталогу мовчки ігнорує.
  - Для кожного запису: якщо це каталог і його імені немає в `IGNORED_DIRS_FOR_PACKAGE_JSON` — рекурсивно входить; якщо це файл `package.json` — викликає `recordCapacitorFromOnePackageJson`.
  - Інші типи файлів (`isFile` зі значенням false, симлінки тощо) пропускаються — записи з `entry.isDirectory() === false && entry.isFile() === false` не оброблюються.

### `hasCapacitorConfigInRoot(root)`

- **Сигнатура:** `(root: string) => boolean`
- **Параметри:** `root` — корінь репозиторію.
- **Повертає:** `true`, якщо хоча б один із файлів `capacitor.config.json`, `capacitor.config.ts`, `capacitor.config.mjs` існує в корені.
- **Side effects:** виконує `existsSync` (синхронний доступ до файлової системи).

### `isCapacitorRelevantForCheck(root, anyCapacitor)`

- **Сигнатура:** `(root: string, anyCapacitor: boolean) => boolean`
- **Параметри:** `root` — корінь; `anyCapacitor` — чи зустрічався `@capacitor/` у `package.json`.
- **Повертає:** `true`, якщо є capacitor-конфіг у корені **або** `anyCapacitor === true`.
- **Side effects:** виклик `hasCapacitorConfigInRoot` (`existsSync`).

### `walkIosForPodfileSkipPods(root, dir, onPodfileRelative)`

- **Сигнатура:** `(root: string, dir: string, onPodfileRelative: (rel: string) => void) => Promise<boolean>`
- **Параметри:** `root` — корінь репозиторію; `dir` — поточний каталог обходу; `onPodfileRelative` — колбек із posix-relative шляхом знайденого `Podfile`.
- **Повертає:** `Promise<boolean>` — `true`, якщо в дереві знайдено принаймні один `Podfile` (повернення відбувається при **першому** знайденому всередині поточного `dir` або в його підкаталогах).
- **Логіка:**
  - `readdir(dir, { withFileTypes: true })`; помилка → `false`.
  - Пропускає підкаталоги/файли з іменами `Pods`, `build`, `DerivedData` (порівняння за іменем).
  - Якщо запис — файл із іменем `Podfile`: викликає колбек із posix-relative шляхом і повертає `true` (ранній вихід — інші записи поточного каталогу не оглядаються).
  - Якщо запис — каталог: рекурсивно входить; якщо нащадок повернув `true`, передається ланцюжком назовні.
- **Side effects:** дисковий I/O (`readdir`), виклики `onPodfileRelative`.

### `findFirstPodfileUnderIosExcludingPods(root)`

- **Сигнатура:** `(root: string) => Promise<string | null>`
- **Параметри:** `root` — корінь репозиторію.
- **Повертає:** posix-relative шлях до першого виявленого `Podfile` під `ios/` (а саме — **найкоротший** із тих, що були передані в колбек у межах того самого виклику обходу) або `null`, якщо `ios/` немає чи в ньому не знайдено `Podfile` поза `Pods/`.
- **Логіка:** перевіряє існування `ios/` через `existsSync`. Викликає `walkIosForPodfileSkipPods` з колбеком, який утримує лише шлях із мінімальною довжиною рядка (`rel.length < first.length`). Через ранній вихід `walkIosForPodfileSkipPods` зазвичай колбек спрацьовує один раз; вибір «найкоротшого» — захист на випадок зміни поведінки обходу.
- **Side effects:** дисковий I/O.

### `nitrAObjectAllowsIosCocoaPods(o)`

- **Сигнатура:** `(o: unknown) => boolean`
- **Параметри:** `o` — кандидат у об’єкт `nitra`.
- **Повертає:** `true`, якщо `o` — звичайний об’єкт (не `null`, не масив) і містить `iosCocoaPodsBecausePluginsLackSpm === true` або `iosCocoaPodsAllowed === true`; інакше — `false`.
- **Side effects:** немає.
- **Зауваження:** назва функції написана з нестандартною капіталізацією `nitrA` — використовується саме так на місці виклику.

### `extractNitraObjectBodySource(source)` _(внутрішня)_

- **Сигнатура:** `(source: string) => string | null`
- **Параметри:** `source` — текст файлу `capacitor.config.ts` або `capacitor.config.mjs`.
- **Повертає:** підрядок `{ ... }`, що відповідає тілу об’єкта після `nitra:` / `"nitra":` / `'nitra':` (перше входження), збалансованому за фігурними дужками; `null`, якщо вхід не знайдено або не вдалося збалансувати дужки.
- **Логіка:** `RE_NITRA_CONFIG_OBJECT_LEAD_IN.exec(source)` знаходить початок; далі вручну лічильник `d` балансу `{`/`}` від першої `{` до зустрічної `}` на нульовому рівні.
- **Side effects:** немає.
- **Обмеження:** не парсить TS/MJS повноцінно; ігнорує можливі `{` / `}` усередині рядків чи коментарів, що теоретично може дати хибний баланс на нетипових вхідних даних. Для штатних `capacitor.config.*` цього достатньо.

### `nitraObjectBodyStringAllowsCocoaPodsExempt(objectBody)` _(внутрішня)_

- **Сигнатура:** `(objectBody: string) => boolean`
- **Параметри:** `objectBody` — текст тіла об’єкта `nitra`.
- **Повертає:** `true`, якщо в підрядку є `iosCocoaPodsBecausePluginsLackSpm: true` або `iosCocoaPodsAllowed: true` (регулярки `RE_COCOAPODS_EXEMPT_SPM`, `RE_COCOAPODS_EXEMPT_ALLOW`).
- **Side effects:** немає.

### `pathJsonShowsNitraCocoapodsExempt(absPath)` _(внутрішня)_

- **Сигнатура:** `(absPath: string) => Promise<boolean>`
- **Параметри:** `absPath` — повний шлях до JSON-файла (`package.json` або `capacitor.config.json`).
- **Повертає:** `true`, якщо файл існує, валідно парситься як JSON, і його ключ `nitra` задовольняє `nitrAObjectAllowsIosCocoaPods`.
- **Логіка:** `existsSync` → `readFile` → `JSON.parse`. Будь-яка помилка читання/парсингу повертає `false`.
- **Side effects:** дисковий I/O.

### `capacitorConfigTsMjsNitraCocoapodsExempt(root)` _(внутрішня)_

- **Сигнатура:** `(root: string) => Promise<boolean>`
- **Параметри:** `root` — корінь репозиторію.
- **Повертає:** `true`, якщо `capacitor.config.ts` або `capacitor.config.mjs` (у такій послідовності) існує та містить блок `nitra: { ... }` з прапором винятку.
- **Логіка:** для кожного імені викликає `existsSync`, читає вміст, через `extractNitraObjectBodySource` дістає тіло і перевіряє `nitraObjectBodyStringAllowsCocoaPodsExempt`. Знайдено → `true`; інакше після обох — `false`.
- **Side effects:** дисковий I/O. Винятки `readFile` не перехоплюються, тому пошкоджений файл може кинути помилку наверх (єдина функція в файлі, що не загортає `readFile` у `try/catch`).

### `isIosCocoaPodsExemptByNitraConfig(root)` _(внутрішня)_

- **Сигнатура:** `(root: string) => Promise<boolean>`
- **Параметри:** `root` — корінь репозиторію.
- **Повертає:** `true`, якщо знайдено валідний виняток `nitra` у `package.json`, або в `capacitor.config.json`, або в `capacitor.config.{ts,mjs}` (перевіряється в такому порядку, з раннім виходом).
- **Side effects:** дисковий I/O.

### `check(cwd = process.cwd())`

- **Сигнатура:** `(cwd?: string) => Promise<number>`
- **Параметри:** `cwd` — корінь репозиторію для перевірки; за замовчуванням `process.cwd()`.
- **Повертає:** exit-код від `reporter.getExitCode()`: **0** — усі повідомлення лише `pass`; **1** — було щонайменше одне `fail`.
- **Side effects:**
  - Створює reporter через `createCheckReporter()` і викликає `pass(...)` / `fail(...)` для друку повідомлень користувачу.
  - Викликає `collectCapacitorDataFromAllPackageJson(root, acc)` — рекурсивний дисковий обхід усіх `package.json`.
  - Викликає `findFirstPodfileUnderIosExcludingPods(root)` — обхід `ios/`.
  - Викликає `isIosCocoaPodsExemptByNitraConfig(root)` лише якщо `podfileRel !== null` (мінімізує читання конфігів).
- **Шлях виконання:**
  1. `acc = { byPath: new Map(), anyCapacitor: false }`; зібрати дані з усіх `package.json`.
  2. Якщо `isCapacitorRelevantForCheck(root, anyCapacitor) === false` — `pass('Capacitor не виявлено …')` і вихід **0**.
  3. Інакше `pass('Проєкт з ознаками Capacitor — застосовую capacitor.mdc')`.
  4. Якщо `byPath.size === 0` (є конфіг, але немає `@capacitor/core` у дереві) — `fail` з підказкою додати `^8.0.0`. Інакше — для кожної пари `[rel, range]` викликати `reportOneCapacitorCoreRange`.
  5. Подія iOS:
     - Якщо `findFirstPodfileUnderIosExcludingPods(root)` повернув `null` і `ios/` існує — `pass('ios/ без Podfile поза Pods/ …')`.
     - Якщо `ios/` не існує — `pass('каталог ios/ не знайдено …')`.
     - Якщо `Podfile` знайдено і `isIosCocoaPodsExemptByNitraConfig(root) === true` — `pass(... — дозволено виняток ...)`.
     - Інакше — `fail(... використовуй лише SPM ...)`.
  6. Повернути `getExitCode()`.

## Залежності

**Стандартна бібліотека Node.js:**

- `node:fs` — `existsSync` (синхронна перевірка існування файлу/каталогу).
- `node:fs/promises` — `readdir` (з `withFileTypes: true`), `readFile` (utf-8).
- `node:path` — `join`, `relative`.

**Локальні модулі:**

- `../../../scripts/lib/check-reporter.mjs` — `createCheckReporter` (фабрика об’єкта з `pass`, `fail`, `getExitCode`; формує консольний звіт і веде стан коду виходу).

**Зовнішні npm-пакети:** немає.

**Системні припущення:**

- Виклик відбувається з кореня репозиторію (або `cwd` передано явно).
- Файлова система — POSIX-сумісна або Windows (всі шляхи нормалізуються через `replaceAll('\\', '/')` до posix-форми у звітах).

## Потік виконання / Використання

Файл призначений для виклику як check-функція в межах CLI чи runner правил `npm/rules/capacitor`. Типовий сценарій:

1. Зовнішній runner імпортує `check` із `platforms.mjs`.
2. Викликає `await check()` або `await check(repoRoot)`.
3. Під час виконання у консоль друкуються рядки звіту через `createCheckReporter()` (pass/fail).
4. Повернений Promise розв’язується числом `0` або `1`, яке runner передає в `process.exit(...)`.

Приклад фактичного виклику (наприклад, у CLI-обгортці):

```js
import { check } from './platforms.mjs'

const exitCode = await check(process.cwd())
process.exit(exitCode)
```

Окремі експортовані функції зручні для модульних тестів і для повторного використання в інших правилах:

- `capacitorVersionRangeMinMajor`, `isCapacitorCoreVersionAtLeast8`, `capacitorSegmentMinMajor` — суто строкові утиліти без I/O; тести подають синтетичні діапазони.
- `recordCapacitorFromOnePackageJson` і `collectCapacitorDataFromAllPackageJson` — інтеграційні утиліти над `package.json`; вимагають реальної або змодельованої файлової системи (через тимчасові теки тощо).
- `walkIosForPodfileSkipPods`, `findFirstPodfileUnderIosExcludingPods` — обхід `ios/`.
- `nitrAObjectAllowsIosCocoaPods` — чистий предикат для об’єкта `nitra`.
- `hasCapacitorConfigInRoot`, `isCapacitorRelevantForCheck` — швидкі синхронні перевірки наявності конфігів.

**Поведінкові інваріанти:**

- Жоден `package.json`, який не валідується як JSON, не призводить до помилки `check`; такі файли мовчки пропускаються.
- Каталоги з `IGNORED_DIRS_FOR_PACKAGE_JSON` ніколи не оглядаються, у тому числі `node_modules` — тобто аналізуються лише власні `package.json` репозиторію та воркспейсів, але не вкладені пакети залежностей.
- Обхід `ios/` ніколи не входить у `Pods`, `build`, `DerivedData` — це принципово для коректної політики (SPM-only): артефакти CocoaPods, що могли залишитися від попередніх збірок, не повинні впливати на result.
- Рішення «диапазон допустимий» приймається консервативно: будь-яка невизначеність (`*`, `latest`, неможливість витягти число) трактується як **не** допустимо.
- Виняток для CocoaPods читається з трьох джерел у строгому порядку: `package.json` → `capacitor.config.json` → `capacitor.config.{ts,mjs}` (з раннім `true`).

## Rebuild Test

Зібрані з цього документа ключові факти, достатні для відтворення поведінки:

- Експортується `check(cwd?)` із поверненням `Promise<number>` (0/1) на основі `createCheckReporter`.
- Capacitor вважається релевантним, якщо в корені є `capacitor.config.{json,ts,mjs}` **АБО** у будь-якому `package.json` (рекурсивно, ігноруючи `node_modules`, `.git`, `dist`, `coverage`, `Pods`, `.turbo`, `.next`, `build`) є залежність з префіксом `@capacitor/` у `dependencies` / `devDependencies` / `optionalDependencies` / `peerDependencies`.
- Мінімальний допустимий major Capacitor — **8** (`MIN_CAPACITOR_MAJOR`).
- Алгоритм обчислення мінімального major npm-діапазону:
  - Розбити за `\s*\|\|\s*` на сегменти.
  - У сегменті: `*` / `x` (low) / `latest` → невизначено (`null`), що означає fail для всього діапазону.
  - `<` / `<=` → 0.
  - `>` (не `>=`) → major першого числа після оператора.
  - `a - b` (з `\s+-\s+`) → major лівої межі.
  - `^`, `~`, `=` → major першого числа після префікса.
  - `>=` → major першого числа після префікса.
  - Інакше — major першого числа в сегменті.
  - Регулярка для першого числа: `^(?:v)?(\d+)` (опційний `v`).
  - Результат для діапазону — мінімум серед сегментів; якщо будь-який сегмент дав `null`, повертається `null`.
- `isCapacitorCoreVersionAtLeast8(range)` ⇔ `capacitorVersionRangeMinMajor(range) >= 8`.
- iOS-перевірка: знайти перший `Podfile` під `ios/`, пропускаючи `Pods`, `build`, `DerivedData`. Якщо знайдено — fail, **окрім** випадку, коли `package.json.nitra` або `capacitor.config.json.nitra` (як JSON-об’єкт) має `iosCocoaPodsBecausePluginsLackSpm === true` або `iosCocoaPodsAllowed === true`, **або** в `capacitor.config.ts` / `capacitor.config.mjs` фрагмент тіла об’єкта `nitra: { ... }` містить `iosCocoaPodsBecausePluginsLackSpm: true` чи `iosCocoaPodsAllowed: true`.
- Якщо `ios/` немає — iOS-блок повністю пропускається (`pass` із поясненням).
- Якщо capacitor-конфіг є, а `@capacitor/core` не знайдено в жодному `package.json` — fail (треба додати залежність з версією `^8.0.0`).
- Помилки I/O і JSON у `package.json` / JSON-конфігах не падають check, а трактуються як «нічого не знайдено» в цій точці.
