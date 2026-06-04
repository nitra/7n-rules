# `ua_http_route.mjs`

## Огляд

Файл `ua_http_route.mjs` — це чек-модуль правила `abie` (див. ADR `abie.mdc`), який верифікує конфігурацію HTTPRoute-патчів у overlay `ua/` (production-кластер `abie`) для пакетів-сервісів у монорепозиторії. Перевірка стосується винятково тих пакетів, що мають у каталозі ознаку Vite-додатку (`vite.config.{js,mjs,ts}`).

Файл експортує єдину асинхронну функцію `check(cwd)`, яка:

1. Знаходить усі kustomization-маніфести Kubernetes-overlay-ів, шлях яких ідентифікується як `ua/` (production `abie`).
2. Для кожного такого overlay-у визначає, чи відповідний пакет є Vite-пакетом (тільки тоді HTTPRoute-патч обов'язковий).
3. Звіряє inline-патч HTTPRoute у `kustomization.yaml` overlay-у з вимогами правила `abie`:
   - непорожнє `target.name`;
   - правильне значення `/spec/hostnames` (домени `abie`);
   - правильне значення `/spec/parentRefs/0/namespace` (`ua` або `ua-*`);
   - кількість JSON6902-патчів для `backendRef.namespace` дорівнює кількості посилань `auth-run-hl`/`file-link-hl` у base-HTTPRoute пакета (зі значенням `value: ua`).
4. Накопичує результати через `createCheckReporter()` і повертає кінцевий exit-код процесу.

Модуль є частиною монорепо-механізму статичних чеків (npm/rules), які запускаються Cursor-харнесом або CI: формат `check(cwd) -> Promise<number>` стандартний для всіх чек-правил у `npm/rules/<rule>/js/`.

## Експорти / API

| Експорт | Тип | Опис |
|---------|-----|------|
| `check` | `async function(cwd?: string): Promise<number>` | Основна точка входу чек-правила. Повертає exit-код (`0` — успіх, ненульовий — є помилки). |

Інших експортів файл не має. Експорт іменований (named export); за конвенцією правил `npm/rules/*/js/*.mjs` він узгоджений із системою-завантажувачем чек-правил.

## Функції

### `check(cwd = process.cwd())`

**Сигнатура:**

```js
export async function check(cwd = process.cwd()): Promise<number>
```

**Параметри:**

- `cwd` (`string`, опціональний) — абсолютний шлях до кореня репозиторію, відносно якого здійснюється пошук маніфестів. За замовчуванням використовується `process.cwd()`.

**Повертає:** `Promise<number>` — exit-код від `reporter.getExitCode()`:
- `0` — усі перевірки пройшли (`pass`) або жодного `ua/`-overlay-у в дереві k8s нема (немає що перевіряти);
- ненульовий — зафіксовано принаймні один `fail`.

**Алгоритм (покроково):**

1. Створює репортер: `const reporter = createCheckReporter()`, витягує функції `pass` та `fail`.
2. Завантажує список глобальних ignore-шляхів через `loadCursorIgnorePaths(root)` (інтеграція з `.cursorignore`/конфігом Cursor).
3. Шукає всі Kubernetes-YAML-файли в дереві за допомогою `findK8sYamlFiles(root, ignorePaths)`.
4. Фільтрує знайдені абсолютні шляхи, залишаючи лише ті, які `isUaKustomizationPath(...)` ідентифікує як `ua/kustomization.yaml` (нормалізація: відносний шлях, заміна `\\` на `/`).
5. Якщо `ua/`-overlay-ів немає взагалі — фіксує загальний `pass` із поясненням і повертає exit-код.
6. Створює локальний кеш `cache: Map<pkgAbs, Promise<{ refCount, baseErrors }>>` для уникнення повторного аналізу одного й того самого пакета (коли кілька overlay-ів вказують на спільний пакет).
7. Для кожного абсолютного шляху `abs` overlay-у `ua/kustomization.yaml`:
   - Обчислює відносний шлях `rel` (нормалізований до `/`).
   - Якщо `abieOverlayRequiresHttpRouteByVite(root, abs)` повертає `false` — фіксує `pass` (HTTPRoute не вимагається через відсутність `vite.config.*` у пакеті) і пропускає overlay.
   - Викликає `abiePackageDirFromK8sOverlay(root, abs)` для визначення каталогу пакета. Якщо повернуто falsy — фіксує `fail` «внутрішня помилка abie overlay» і пропускає.
   - Перевіряє кеш `cache` за ключем `pkgAbs`; якщо немає — запускає `analyzeAbieSharedBackendRefsInPackageK8s(root, pkgAbs, yamls)` і кладе обіцянку в кеш.
   - `await`-ить результат `sharedAnalysis = { refCount, baseErrors }`.
   - Якщо `sharedAnalysis.baseErrors` непорожній — викликає `fail(err)` для кожної помилки, виставляє `hasBaseError = true` і `continue` (пропускає валідацію overlay-патчів, бо base некоректний).
   - Інакше читає сирий вміст overlay-файлу через `readFile(abs, 'utf8')` у блоці try/catch. У разі помилки I/O — фіксує `fail` із текстом причини і `continue`.
   - Витягує комбінований текст патчів через `getCombinedNginxRunPatchTextFromKustomization(raw)`.
   - Викликає `validateAbieNginxRunHttpRoutePatches(combined, 'ua', raw, sharedAnalysis.refCount)`:
     - якщо результат `null` — патчі коректні: фіксує `pass`;
     - інакше — повернутий рядок є описом порушення: фіксує `fail` із префіксом `rel`.
8. Повертає `reporter.getExitCode()`.

**Side effects:**

- Файлова система: лише читання (`readFile`, рекурсивне сканування через `findK8sYamlFiles`, читання `cursorignore`-конфігу). Запис у ФС відсутній.
- Стан репортера: акумулює `pass`/`fail`-події у замкненому об'єкті `reporter`. Безпосередньо в `stdout`/`stderr` виводить через імплементацію `createCheckReporter` (поза цим файлом).
- Залежить від `process.cwd()` за замовчуванням.
- Не змінює `process.exit` напряму — повертає `exitCode`-число, рішення про термінацію приймає викликач.

**Обробка помилок:**

- Помилки читання overlay-YAML-файлу не «протікають» назовні: ловляться в `try/catch`, формуються в людиночитний `fail`-запис із текстом причини.
- Помилки, виявлені у base-HTTPRoute (`sharedAnalysis.baseErrors`), реєструються через `fail` і блокують подальшу перевірку overlay-патчів для цього пакета (логіка «спершу полагодь base»).
- Внутрішня неузгодженість (`abiePackageDirFromK8sOverlay` повертає falsy) — фіксується як окремий `fail` із позначкою «внутрішня помилка abie overlay».

## Залежності

### Стандартні модулі Node.js

- `node:fs/promises` — імпортується `readFile` для асинхронного читання overlay-YAML.
- `node:path` — імпортується `relative` для обчислення відносних шляхів до кореня репозиторію.

### Внутрішні утиліти репозиторію

- `../../../scripts/lib/check-reporter.mjs` — `createCheckReporter()`: фабрика репортера з API `{ pass, fail, getExitCode }`.
- `../../../scripts/lib/load-cursor-config.mjs` — `loadCursorIgnorePaths(root)`: повертає список шляхів-винятків для скану.
- `../lib/http-route.mjs` — `analyzeAbieSharedBackendRefsInPackageK8s(root, pkgAbs, yamls)`: аналізує base-HTTPRoute пакета на предмет посилань на спільні сервіси (`auth-run-hl`/`file-link-hl`), повертає `{ refCount, baseErrors }`.
- `../lib/k8s-tree.mjs` — `findK8sYamlFiles(root, ignorePaths)`: рекурсивний пошук YAML-файлів k8s у дереві.
- `../lib/kustomization-patches.mjs` — пара функцій:
  - `getCombinedNginxRunPatchTextFromKustomization(raw)`: витягує і конкатенує текст inline-патчів із `kustomization.yaml`;
  - `validateAbieNginxRunHttpRoutePatches(combined, env, raw, refCount)`: валідує патчі HTTPRoute для заданого середовища (`'ua'`) з очікуваною кількістю backendRef-патчів; повертає `null` при успіху або текст помилки.
- `../lib/overlay-paths.mjs` — три функції:
  - `abiePackageDirFromK8sOverlay(root, abs)`: визначає абсолютний шлях каталогу пакета для даного k8s-overlay-у;
  - `abieOverlayRequiresHttpRouteByVite(root, abs)`: повертає `true`, якщо пакет містить `vite.config.{js,mjs,ts}` (умова обов'язковості HTTPRoute-патчу);
  - `isUaKustomizationPath(relPath)`: розпізнавання шляху `ua/kustomization.yaml` за маскою.

### Зовнішні залежності

Прямих залежностей від npm-пакетів немає. Уся YAML-логіка інкапсульована в `lib/`-функціях.

## Потік виконання / Використання

### Як викликається

Файл є чек-модулем правила `abie` і викликається через стандартний механізм запуску чеків `npm/rules/*/js/*.mjs`. Конвенція:

```js
import { check } from 'npm/rules/abie/js/ua_http_route.mjs'

const exitCode = await check()  // або await check('/abs/path/to/repo')
process.exit(exitCode)
```

У контексті Cursor-харнесу/CI правило завантажується автоматично за іменем `abie/ua_http_route`, а exit-код агрегується у загальний звіт.

### Логічна модель

1. **Скоп overlay-ів:** скануємо все дерево k8s, але звужуємо до `ua/kustomization.yaml`.
2. **Триггер перевірки:** конкретний overlay перевіряється лише за наявності `vite.config.*` у пакеті (правило `abie` стосується лише Vite-веб-пакетів).
3. **Двофазна валідація:**
   - **Phase A — base:** один раз на пакет аналізуємо base-HTTPRoute (`analyzeAbieSharedBackendRefsInPackageK8s`). Якщо base некоректний — overlay не валідується (нема сенсу).
   - **Phase B — overlay patch:** для коректного base витягуємо inline-патчі з overlay-у і звіряємо їх із вимогами (`validateAbieNginxRunHttpRoutePatches`) для середовища `ua` із параметром `refCount` зі стадії A.
4. **Кешування:** аналіз пакета (Phase A) кешується в `Map` за ключем `pkgAbs`, тож кілька `ua/`-overlay-ів, що належать одному пакету, не запускають дорогий аналіз повторно. Кеш зберігає `Promise`, що уникає race-condition і повторного await-у.
5. **Репортинг:** кожен висновок (`pass`/`fail`) включає префікс `rel` — відносний шлях до overlay-маніфесту, що дозволяє звітам бути локалізованими у файлі для UX і CI-логів.

### Сценарії результатів

- **Немає `ua/`-overlay-ів** — один загальний `pass`, `exitCode = 0`.
- **Overlay є, але пакет не Vite** — `pass` із поясненням «HTTPRoute patch (ua) не застосовується».
- **Overlay є, пакет Vite, base коректний, патч коректний** — `pass: «HTTPRoute patch (ua) відповідає abie.mdc»`.
- **Overlay є, пакет Vite, base має помилки** — серія `fail` із текстом помилок base.
- **Overlay є, пакет Vite, base ок, патч порушує вимоги** — `fail` з конкретним описом порушення.
- **I/O-помилка читання overlay-у** — `fail` із текстом причини, інші overlay-и продовжують перевірятися.
- **Внутрішня помилка визначення каталогу пакета** — `fail` із міткою «внутрішня помилка abie overlay».

### Зв'язок із правилом `abie.mdc`

Файл реалізує перевірочну логіку для пунктів правила:

- *«inline-patch HTTPRoute»* у `ua/kustomization.yaml` для Vite-пакетів — перевіряється через `validateAbieNginxRunHttpRoutePatches`;
- *«непорожній `target.name`»* — частина валідації патчів;
- *`/spec/hostnames`* — домени abie — частина валідації;
- *`/spec/parentRefs/0/namespace`* (`ua`/`ua-*`) — частина валідації;
- *спільні сервіси `auth-run-hl`/`file-link-hl`* — патчі `backendRef.namespace` зі `value: ua` та кількістю, рівною кількості посилань у base — забезпечується передачею `sharedAnalysis.refCount` у валідатор.

## Rebuild Test

Контрольні точки, за якими можна відновити логіку файлу без перегляду коду:

1. **Експорт:** єдина іменована асинхронна функція `check(cwd?)`, повертає `Promise<number>`.
2. **Параметр:** `cwd` за замовчуванням — `process.cwd()`.
3. **Кроки алгоритму:** reporter → ignore-шляхи → `findK8sYamlFiles` → фільтр `isUaKustomizationPath` → ранній вихід якщо порожньо → цикл по overlay-ах → перевірка Vite-тригера → визначення `pkgAbs` → кешований `analyzeAbieSharedBackendRefsInPackageK8s` → перевірка `baseErrors` → читання overlay-у з `try/catch` → `getCombinedNginxRunPatchTextFromKustomization` → `validateAbieNginxRunHttpRoutePatches(combined, 'ua', raw, refCount)` → `pass`/`fail` за результатом → `reporter.getExitCode()`.
4. **Кешування:** `Map<pkgAbs, Promise<{ refCount, baseErrors }>>` для one-time аналізу base пакета.
5. **Семантика результатів валідатора:** `null` = ok; рядок = текст помилки.
6. **Жодних мутацій ФС, жодних мережевих викликів, жодних викликів `process.exit`.**
7. **Залежності:** дві з `node:` + дві з `../../../scripts/lib/` + три з `../lib/` (http-route, k8s-tree, kustomization-patches, overlay-paths).
8. **Конвенція повідомлень `pass`/`fail`:** префікс — відносний шлях overlay-у; суфікс — людиночитне пояснення українською з посиланнями на `abie.mdc` та середовище `ua`.
9. **Прив'язка до правила:** `ua` — production-overlay; `vite.config.{js,mjs,ts}` — тригер; спільні сервіси — `auth-run-hl`/`file-link-hl`; пара патчів — inline + JSON6902.
