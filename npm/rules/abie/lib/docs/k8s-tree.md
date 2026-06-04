# k8s-tree.mjs

## Огляд

Модуль `k8s-tree.mjs` відповідає за обхід дерева репозиторію у пошуку Kubernetes-маніфестів, які належать правилу `abie` (Application Build / Image / Env). Він виконує дві ключові задачі:

1. **Пошук YAML-файлів під сегментом `k8s/`** — повертає відсортований список абсолютних шляхів усіх `.yaml`/`.yml` файлів, які знаходяться в межах піддерева з директорією `k8s/`. Каталог `.github/` свідомо виключається, оскільки належить до іншого правила (`ga.mdc`).
2. **Збір каталогів з Deployment-маніфестами** — повертає множину абсолютних шляхів каталогів, у яких хоча б один YAML-документ має `kind: Deployment`.

Особливості модуля:

- **Memoization на рівні модуля** — обидві функції кешують результати у `Map` на час життя процесу (one-run cache). Ключ кешу враховує `root` та (для YAML-обходу) відсортовані `ignorePaths`, а для збору Deployment-каталогів — відсортований список вхідних YAML-файлів.
- **Promise-based caching** — у `Map` зберігається саме `Promise`, тому конкурентні виклики з тим самим ключем «склеюються» в один фізичний обхід FS.
- **Стабільний порядок результатів** — повертається відсортований за `localeCompare` список, що забезпечує детермінованість виводу для подальших правил/тестів.
- **Tolerant до помилок парсингу** — за замовчуванням пошкоджені YAML-документи мовчки пропускаються; зовнішній reporter `fail` можна передати, якщо caller хоче формально їх логувати.

Файл написаний у форматі ES Modules (`.mjs`), використовує JSDoc для типізації та orієнтований на серверне середовище Node.js / Bun.

## Експорти / API

| Експорт | Тип | Призначення |
| --- | --- | --- |
| `findK8sYamlFiles(root, ignorePaths?)` | named function | Знаходить усі `.yaml`/`.yml` файли під сегментом `k8s/` у дереві репо. |
| `collectDeploymentDirs(root, yamlAbs, fail?)` | named function | Зі списку YAML-файлів вибирає унікальні каталоги, де є `kind: Deployment`. |

Внутрішні (не експортуються):

- `YAML_EXTENSION_RE` — регулярний вираз `/\.ya?ml$/iu` для перевірки розширення.
- `yamlCache` — `Map<string, Promise<string[]>>`, кеш результатів `findK8sYamlFiles`.
- `deploymentCache` — `Map<string, Promise<Set<string>>>`, кеш результатів `collectDeploymentDirs`.
- `cacheKey(root, ignorePaths)` — допоміжна функція побудови стабільного ключа кешу.
- `silentFail(_msg)` — no-op fail-handler за замовчуванням.

## Функції

### `cacheKey(root, ignorePaths)`

Внутрішня. Будує стабільний рядковий ключ кешу для `findK8sYamlFiles`.

- **Сигнатура:** `function cacheKey(root: string, ignorePaths: string[]): string`
- **Параметри:**
  - `root` — абсолютний шлях до кореня репозиторію.
  - `ignorePaths` — масив абсолютних шляхів-виключень.
- **Повертає:** рядок у форматі `${root}|${sortedIgnorePaths.join(':')}`. Сортування виконується через `toSorted` з `localeCompare`, щоб порядок аргументів не впливав на ключ.
- **Side effects:** немає (pure).

### `findK8sYamlFiles(root, ignorePaths = [])`

Експортується. Збирає абсолютні шляхи всіх `.yaml`/`.yml`-файлів, які лежать у дереві, що містить сегмент `k8s/`.

- **Сигнатура:** `function findK8sYamlFiles(root: string, ignorePaths?: string[]): Promise<string[]>`
- **Параметри:**
  - `root` — корінь репозиторію (абсолютний шлях).
  - `ignorePaths` — (опційно) масив абсолютних шляхів каталогів-виключень для `walkDir`. За замовчуванням — порожній масив.
- **Повертає:** `Promise<string[]>` — відсортований за `localeCompare` список абсолютних шляхів YAML-файлів.
- **Алгоритм:**
  1. Обчислює `cacheKey(root, ignorePaths)`.
  2. Якщо за цим ключем уже є записаний `Promise` у `yamlCache` — повертає його (memoization).
  3. Інакше створює асинхронний IIFE, який викликає `walkDir(root, visitor, ignorePaths)`.
  4. Visitor для кожного знайденого шляху `p`:
     - Будує relative-шлях через `relative(root, p).replaceAll('\\', '/')` (normalize до POSIX-роздільників).
     - Якщо relative починається з `.github/` — пропускає (належить правилу `ga.mdc`).
     - Якщо `pathHasK8sSegment(p, root)` повертає `false` — пропускає.
     - Якщо `YAML_EXTENSION_RE` не матчить — пропускає.
     - Інакше додає `p` в накопичувач `out`.
  5. Повертає копію `out`, відсортовану через `toSorted((a, b) => a.localeCompare(b))`.
  6. Зберігає створений `Promise` у `yamlCache`.
- **Side effects:**
  - Читання файлової системи через `walkDir` (асинхронне обходження дерева).
  - Запис у module-level `yamlCache`.

### `silentFail(_msg)`

Внутрішня. No-op fail-handler за замовчуванням для `collectDeploymentDirs`.

- **Сигнатура:** `function silentFail(_msg: string): void`
- **Параметри:** `_msg` — повідомлення про помилку (ігнорується).
- **Повертає:** `undefined`.
- **Side effects:** немає.
- **Призначення:** дозволяє виконувати cross-rule сканування без шуму від пошкоджених YAML, перекладаючи відповідальність за reporting на caller.

### `collectDeploymentDirs(root, yamlAbs, fail = silentFail)`

Експортується. Зі списку YAML-файлів обчислює множину каталогів, у яких є хоча б один `kind: Deployment`.

- **Сигнатура:** `function collectDeploymentDirs(root: string, yamlAbs: string[], fail?: (msg: string) => void): Promise<Set<string>>`
- **Параметри:**
  - `root` — абсолютний корінь репо; використовується для побудови relative-шляхів у повідомленнях про помилки.
  - `yamlAbs` — масив абсолютних шляхів YAML-файлів (зазвичай отриманих з `findK8sYamlFiles`).
  - `fail` — (опційно) callback `(msg: string) => void` для логування помилок парсингу. За замовчуванням `silentFail` (no-op).
- **Повертає:** `Promise<Set<string>>` — множина абсолютних шляхів каталогів, де знайдено Deployment-маніфести.
- **Алгоритм:**
  1. Будує ключ кешу: `${root}|${[...yamlAbs].toSorted((a, b) => a.localeCompare(b)).join(':')}`.
  2. Якщо за цим ключем уже є `Promise` у `deploymentCache` — повертає його.
  3. Інакше створює асинхронний IIFE:
     - Створює порожній `Set<string> dirs`.
     - Для кожного `abs` з `yamlAbs`:
       - Будує relative-шлях `relative(root, abs).replaceAll('\\', '/')` або фалбек на `abs`, якщо relative порожній.
       - Викликає `readAndParseYamlDocs(abs, rel, fail)`.
       - Якщо результат істинний (`docs`), ітерує по документах: для кожного `doc`, в якого `doc.errors.length === 0` і `isDeploymentDoc(doc.toJSON())` — додає `dirname(abs)` у `dirs`.
     - Повертає `dirs`.
  4. Зберігає створений `Promise` у `deploymentCache`.
- **Side effects:**
  - Читання файлів YAML через `readAndParseYamlDocs` (асинхронне I/O).
  - Можливе викликання `fail` для пошкоджених документів.
  - Запис у module-level `deploymentCache`.

## Залежності

### Стандартні модулі Node.js

- `node:path`:
  - `dirname(path)` — для отримання каталогу YAML-файлу при додаванні в `Set<string>` Deployment-каталогів.
  - `relative(from, to)` — для побудови relative-шляхів і normalize до POSIX (`replaceAll('\\', '/')`).

### Внутрішні модулі проєкту

- `../../k8s/js/manifests.mjs`:
  - `pathHasK8sSegment(p, root)` — перевірка, чи містить шлях `p` сегмент `k8s/` всередині дерева `root`.
- `../../../scripts/utils/walkDir.mjs`:
  - `walkDir(root, visitor, ignorePaths)` — асинхронний обхід дерева каталогів із підтримкою виключень.
- `./yaml.mjs`:
  - `isDeploymentDoc(json)` — предикат: чи YAML-документ описує `kind: Deployment`.
  - `readAndParseYamlDocs(abs, rel, fail)` — читає файл, парсить його як multi-document YAML, повертає масив `Document` (або falsy при помилці).

### Зовнішнє API документів

Очікується, що документ, який повертає `readAndParseYamlDocs`, має:

- Поле `errors` (масив помилок парсингу — порожній означає валідність).
- Метод `toJSON()` для перетворення в plain JS object для подальшої перевірки `isDeploymentDoc`.

## Потік виконання / Використання

Типова послідовність використання модуля у правилі `abie` чи суміжних check-функціях:

1. Caller (наприклад, check-функція правила) визначає корінь репо `root` і список `ignorePaths`.
2. Викликає `await findK8sYamlFiles(root, ignorePaths)` — отримує відсортований список абсолютних YAML-шляхів. Повторні виклики з тим самим `(root, ignorePaths)` не роблять FS-обхід.
3. (Опційно) Викликає `await collectDeploymentDirs(root, yamlAbs, reporter)`, де `reporter` — функція логування помилок парсингу.
4. Отриманий `Set<string>` каталогів використовується для подальших перевірок (наприклад, що в кожному Deployment-каталозі є очікувані супровідні файли, kustomization patches тощо).

### Кешування та lifecycle

- `yamlCache` та `deploymentCache` — module-level singletons. Вони живуть протягом усього процесу Node.js / Bun (єдиний прогін правил).
- Кеш не має API для інвалідації — це свідомо: всередині одного прогону FS незмінна, а між прогонами процес запускається заново.
- Через те, що в `Map` зберігаються `Promise`, а не вже-розв'язані значення, конкурентні `await findK8sYamlFiles(root, ignorePaths)` з різних check-функцій склеюються в один реальний обхід.

### Семантика виключень

- `.github/` каталог свідомо пропускається у `findK8sYamlFiles`, оскільки маніфести під `.github/` належать до правила `ga.mdc` (GitHub Actions), а не до `abie`.
- `ignorePaths` передаються прямо в `walkDir`, тобто це повна довіра caller — функція не доповнює їх своїми евристиками.

### Стійкість до помилок

- У `collectDeploymentDirs`:
  - Якщо `readAndParseYamlDocs` повертає falsy — файл просто пропускається (без throw).
  - Якщо YAML-документ має `errors.length > 0` — він також пропускається (помилковий документ не може бути Deployment).
  - Зовнішній `fail`-handler викликається тільки при I/O чи parse-помилках у `readAndParseYamlDocs`; у `collectDeploymentDirs` додаткового виклику `fail` немає.

### Детермінізм

- `findK8sYamlFiles` сортує вихідний список через `localeCompare`, що дає стабільний порядок між запусками й платформами.
- Ключі кешу теж сортуються (`ignorePaths`, `yamlAbs`), отже порядок передачі цих масивів не впливає на cache-hit.

## Rebuild Test

Файл `k8s-tree.mjs` концептуально можна відтворити з цієї документації:

- Module-level кеші (`Map<string, Promise<...>>`) для обох публічних функцій.
- Allocated `cacheKey(root, ignorePaths)` з сортуванням `ignorePaths` через `localeCompare` і шаблоном `${root}|${sorted.join(':')}`.
- Регулярний вираз `YAML_EXTENSION_RE = /\.ya?ml$/iu`.
- `findK8sYamlFiles(root, ignorePaths = [])`:
  - memoize через `yamlCache.get(cacheKey)` / `yamlCache.set(cacheKey, promise)`;
  - усередині `walkDir(root, visitor, ignorePaths)` з visitor, який нормалізує separator до `/`, відкидає `.github/`, відкидає шляхи без `k8s/`-сегмента, відкидає не-YAML, а решту пушить;
  - результат сортується через `toSorted((a, b) => a.localeCompare(b))`.
- `silentFail(_msg)` — no-op.
- `collectDeploymentDirs(root, yamlAbs, fail = silentFail)`:
  - ключ кешу — `${root}|${sortedYamlAbs.join(':')}`;
  - memoize через `deploymentCache`;
  - для кожного `abs` будує relative-шлях (з `replaceAll('\\','/')` і фалбеком на `abs`), викликає `readAndParseYamlDocs(abs, rel, fail)`;
  - для кожного `doc` з `errors.length === 0` і `isDeploymentDoc(doc.toJSON())` — додає `dirname(abs)` у `Set`;
  - повертає `Set<string>`.

Подальші правила залежать від точної семантики `walkDir`, `pathHasK8sSegment`, `isDeploymentDoc`, `readAndParseYamlDocs` — вони повторно не описуються тут і мають бути взяті з відповідних модулів-залежностей.
