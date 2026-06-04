# overlay-paths.mjs

## Огляд

Модуль `overlay-paths.mjs` містить набір допоміжних чистих функцій (path-helpers) для роботи зі шляхами в контексті abie-overlay-перевірок у моно-репозиторії. Він обслуговує правила перевірки структури Kubernetes-маніфестів пакетів, у яких передбачена `base/`-шар та overlay у піддиректорії `ua/`.

Модуль покриває такі задачі:

- **Класифікація шляхів** — визначення, чи певний відносний шлях належить до `ua/kustomization.yaml` (abie overlay) або до `base/`-шару (`isUaKustomizationPath`, `isAbieK8sBaseYamlPath`).
- **Вилучення каталогу пакета** з overlay-шляху — повернення абсолютного шляху каталогу-предка (`abiePackageDirFromK8sOverlay`).
- **Умовний gate для HTTPRoute** — перевірка, чи пакет використовує Vite (`abieOverlayRequiresHttpRouteByVite`); HTTPRoute-вимога застосовується лише до Vite-пакетів.
- **Перевірка наявності `Deployment`** — у дереві `k8s/` пакета через переданий набір каталогів (`abieOverlayK8sTreeHasDeployment`).
- **Належність yaml до base-шару** — поза піддеревом `ua/` (`isK8sYamlInAbiePackageExcludingUaOverlay`).

Усі функції — синхронні, без побічних ефектів окрім тих, що читають файлову систему через `existsSync` (`abieOverlayRequiresHttpRouteByVite`). Усі шляхи нормалізуються до posix-формату (`\` замінюється на `/`).

## Експорти / API

Модуль експортує п'ять іменованих функцій (без default-експорту):

| Назва | Тип | Призначення |
|---|---|---|
| `isUaKustomizationPath(rel)` | `(string) => boolean` | Чи `rel` — це `…/ua/kustomization.yaml`. |
| `abiePackageDirFromK8sOverlay(root, kustomizationAbs)` | `(string, string) => string \| null` | Каталог пакета (батько `k8s/`) для overlay. |
| `abieOverlayRequiresHttpRouteByVite(root, kustomizationAbs)` | `(string, string) => boolean` | Чи пакет використовує Vite. |
| `abieOverlayK8sTreeHasDeployment(deploymentDirs, root, kustomizationAbs)` | `(Set<string>, string, string) => boolean` | Чи у дереві `k8s/` пакета є Deployment. |
| `isAbieK8sBaseYamlPath(rel)` | `(string) => boolean` | Чи `rel` — це `…/k8s/base/…` (base-шар). |
| `isK8sYamlInAbiePackageExcludingUaOverlay(relFromRoot, pkgRelFromRoot)` | `(string, string) => boolean` | Чи yaml у `<pkgRel>/k8s/**` поза `ua/`. |

## Функції

### `isUaKustomizationPath(rel)`

**Сигнатура:** `(rel: string) => boolean`

**Параметри:**

- `rel` — posix- або win-стилізований відносний шлях від кореня репозиторію.

**Повертає:** `true`, якщо нормалізований шлях відповідає регулярному виразу `^(?:.*\/)?ua\/kustomization\.yaml$` (тобто закінчується на `ua/kustomization.yaml`); інакше `false`.

**Side effects:** немає. Функція суто обчислювальна.

**Деталі:** перед перевіркою всі бекслеші замінюються на прямі (`replaceAll('\\', '/')`), що дозволяє коректно обробляти шляхи Windows.

### `abiePackageDirFromK8sOverlay(root, kustomizationAbs)`

**Сигнатура:** `(root: string, kustomizationAbs: string) => string | null`

**Параметри:**

- `root` — абсолютний шлях до кореня репозиторію.
- `kustomizationAbs` — абсолютний шлях до файлу `ua/kustomization.yaml`.

**Повертає:**

- Абсолютний шлях до каталогу пакета (тобто батьківського каталогу `k8s/`), якщо відносний шлях відповідає шаблону `^(.+)\/k8s\/ua\/kustomization\.yaml$`.
- `null`, якщо шлях не відповідає цьому шаблону (overlay не є kustomization-overlay-ом abie-пакета).

**Алгоритм:**

1. Обчислити `rel = relative(root, kustomizationAbs)` і нормалізувати слеші.
2. Якщо `relative` повернув порожній рядок — використати оригінальний `kustomizationAbs`.
3. Виділити перший capture-group через regex `OVERLAY_PACKAGE_DIR_RE`.
4. Якщо matched — повернути `join(root, m[1])`; інакше `null`.

**Side effects:** немає.

### `abieOverlayRequiresHttpRouteByVite(root, kustomizationAbs)`

**Сигнатура:** `(root: string, kustomizationAbs: string) => boolean`

**Параметри:**

- `root` — абсолютний шлях до кореня репозиторію.
- `kustomizationAbs` — абсолютний шлях до файлу `ua/kustomization.yaml`.

**Повертає:** `true`, якщо у каталозі пакета існує хоч один із файлів:

- `vite.config.js`
- `vite.config.mjs`
- `vite.config.ts`

В іншому разі — `false` (включаючи випадок, коли `abiePackageDirFromK8sOverlay` повернув `null`).

**Side effects:** виконує до трьох викликів `existsSync` із `node:fs` (читання метаданих файлової системи). Це єдина функція в модулі з I/O.

**Призначення:** використовується як gate для HTTPRoute-перевірок — abie вимагає наявність HTTPRoute лише для Vite-пакетів.

### `abieOverlayK8sTreeHasDeployment(deploymentDirs, root, kustomizationAbs)`

**Сигнатура:** `(deploymentDirs: Set<string>, root: string, kustomizationAbs: string) => boolean`

**Параметри:**

- `deploymentDirs` — `Set` абсолютних каталогів, у яких знайдено `Deployment`-маніфести (зазвичай отримується із зовнішньої функції `collectDeploymentDirs`).
- `root` — абсолютний шлях до кореня репозиторію.
- `kustomizationAbs` — абсолютний шлях до файлу `ua/kustomization.yaml`.

**Повертає:** `true`, якщо існує хоча б один каталог із `deploymentDirs`, який або точно дорівнює `<pkg>/k8s`, або починається з префіксу `<pkg>/k8s/`; інакше `false`. Якщо `abiePackageDirFromK8sOverlay` повернув `null` — також `false`.

**Алгоритм:**

1. Отримати каталог пакета `pkg`.
2. Обчислити `k8sRoot = join(pkg, 'k8s')` і нормалізувати слеші.
3. Пройти по `deploymentDirs` і перевірити кожен елемент на точну рівність `k8sRoot` або префіксність `k8sRoot/`.

**Side effects:** немає (I/O вже зроблено упорядкуванням `deploymentDirs` ззовні).

### `isAbieK8sBaseYamlPath(rel)`

**Сигнатура:** `(rel: string) => boolean`

**Параметри:**

- `rel` — відносний шлях від кореня репозиторію.

**Повертає:** `true`, якщо в нормалізованому шляху присутній сегмент `base/` (тобто початок рядка або слеш перед `base/`); інакше `false`.

**Side effects:** немає.

**Зауваження:** функція не звужує перевірку до `k8s/base/…` — використовує лише наявність сегмента `base/` будь-де у шляху після нормалізації. Дійсна семантика очікує, що виклик відбувається на шляхах yaml-файлів у дереві abie-пакета, тож контекстна звуженість покладається на caller.

### `isK8sYamlInAbiePackageExcludingUaOverlay(relFromRoot, pkgRelFromRoot)`

**Сигнатура:** `(relFromRoot: string, pkgRelFromRoot: string) => boolean`

**Параметри:**

- `relFromRoot` — відносний шлях yaml-файлу від кореня репозиторію.
- `pkgRelFromRoot` — відносний шлях каталогу пакета від кореня репозиторію (можливо з кінцевим слешем).

**Повертає:** `true`, якщо `relFromRoot` починається з `<pkg>/k8s/` і залишок шляху після цього префіксу **не** починається з `ua/`; інакше `false`.

**Алгоритм:**

1. Нормалізувати обидва шляхи (заміна `\` → `/`).
2. У `pkg` додатково обрізати кінцевий слеш через `TRAILING_SLASH_RE`.
3. Сформувати префікс `${pkg}/k8s/`.
4. Якщо `relFromRoot` не починається з цього префіксу — повернути `false`.
5. Обчислити суфікс `after = relFromRoot.slice(prefix.length)`.
6. Повернути `!after.startsWith('ua/')`.

**Side effects:** немає.

## Залежності

### Зовнішні (Node.js builtins)

- `node:fs` — імпортується `existsSync` для перевірки наявності файлів `vite.config.{js,mjs,ts}`.
- `node:path` — імпортуються `join` (для побудови шляхів) та `relative` (для приведення абсолютного шляху до relative-від-`root`).

### Внутрішні константи (модульно-приватні)

- `UA_KUSTOMIZATION_PATH_RE = /(^|\/)ua\/kustomization\.yaml$/u` — посилається на overlay-файл abie.
- `OVERLAY_PACKAGE_DIR_RE = /^(.+)\/k8s\/ua\/kustomization\.yaml$/u` — capture для каталогу пакета.
- `BASE_SEGMENT_RE = /(^|\/)base\//u` — наявність сегмента `base/`.
- `TRAILING_SLASH_RE = /\/$/u` — для обрізання кінцевого слеша в `pkgRelFromRoot`.

### Контекстні залежності

- Функція `abieOverlayK8sTreeHasDeployment` очікує `deploymentDirs`, який зовнішньо формується (з документації — за допомогою `collectDeploymentDirs`). Сам модуль `collectDeploymentDirs` не імпортує — це інверсія залежності.

## Потік виконання / Використання

Модуль використовується як набір примітивів у складі abie-правил (`npm/rules/abie/`), які перевіряють коректну структуру `k8s/`-маніфестів пакетів моно-репозиторію. Типовий потік:

1. **Класифікація файлу:** правило отримує список змінених yaml-файлів і викликає `isUaKustomizationPath(rel)` для виявлення overlay-файлів, чи `isAbieK8sBaseYamlPath(rel)` для виявлення base-шарів.

2. **Резолюція каталогу пакета:** для знайденого overlay викликається `abiePackageDirFromK8sOverlay(root, abs)`, щоб отримати абсолютний шлях каталогу пакета — від нього вже доступні `package.json`, `vite.config.*`, дерево `k8s/`.

3. **Умовний gate:**
   - `abieOverlayRequiresHttpRouteByVite(root, abs)` повертає `true` лише для Vite-пакетів — правило HTTPRoute активується тільки в такому випадку.
   - `abieOverlayK8sTreeHasDeployment(deploymentDirs, root, abs)` перевіряє наявність Deployment у дереві `k8s/` пакета, щоб правило могло вимагати супутні маніфести (Service, HTTPRoute тощо) лише за наявності Deployment.

4. **Перевірка base-шару:** `isK8sYamlInAbiePackageExcludingUaOverlay(relFromRoot, pkgRelFromRoot)` дозволяє правилу обчислити yaml-файли base-шару конкретного пакета без overlay-файлів — наприклад, для перевірки що base містить очікувані ресурси.

### Приклад використання

```js
import {
  isUaKustomizationPath,
  abiePackageDirFromK8sOverlay,
  abieOverlayRequiresHttpRouteByVite,
  abieOverlayK8sTreeHasDeployment,
  isK8sYamlInAbiePackageExcludingUaOverlay,
  isAbieK8sBaseYamlPath,
} from './overlay-paths.mjs'

const root = '/repo'
const rel = 'apps/web/k8s/ua/kustomization.yaml'

if (isUaKustomizationPath(rel)) {
  const abs = `${root}/${rel}`
  const pkgDir = abiePackageDirFromK8sOverlay(root, abs)
  // pkgDir === '/repo/apps/web'

  if (abieOverlayRequiresHttpRouteByVite(root, abs)) {
    // вимагати HTTPRoute, бо є vite.config.*
  }

  if (abieOverlayK8sTreeHasDeployment(deploymentDirs, root, abs)) {
    // вимагати супутні маніфести
  }
}

if (isAbieK8sBaseYamlPath('apps/web/k8s/base/deployment.yaml')) {
  // це base-шар
}

if (isK8sYamlInAbiePackageExcludingUaOverlay('apps/web/k8s/base/svc.yaml', 'apps/web')) {
  // yaml належить base-шару пакета apps/web
}
```

### Особливості

- **Кросплатформна нормалізація шляхів:** усі публічні функції перед regex-перевіркою замінюють `\` на `/`, що забезпечує однакову поведінку на Windows та POSIX-системах.
- **Чистота функцій:** усі функції, окрім `abieOverlayRequiresHttpRouteByVite`, не звертаються до файлової системи. Це робить їх тривіально тестовими — достатньо передавати рядкові шляхи без mock-у `fs`.
- **Інверсія залежностей:** для перевірки `Deployment` модуль приймає вже-зібраний `Set` каталогів — він не сканує файлову систему сам, що дозволяє caller'у кешувати/префільтрувати результат.
- **Розпізнавання `null` результатів:** `abiePackageDirFromK8sOverlay` повертає `null`, коли шлях не відповідає шаблону abie-overlay-у; залежні функції (`abieOverlayRequiresHttpRouteByVite`, `abieOverlayK8sTreeHasDeployment`) перетворюють `null` на безпечний `false`.
