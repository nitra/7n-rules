# ua_node_selector.mjs

## Огляд

Модуль `ua_node_selector.mjs` — це check-скрипт правила **abie** (за `abie.mdc`), що перевіряє наявність обовʼязкового inline-патча `nodeSelector` для ресурсу `Deployment` у файлі `ua/kustomization.yaml` всередині кожного пакета, який містить `Deployment` у своєму дереві `k8s/`.

Бізнес-вимога правила:

- Якщо в дереві `k8s/` пакета знайдено хоча б один обʼєкт `Deployment`, то в overlay-конфігурації `ua/kustomization.yaml` цього пакета має існувати inline-patch з:
  - `target.kind: Deployment`,
  - JSON6902-патчем на шлях `/spec/template/spec/nodeSelector`,
  - параметром `preem: false`.

Модуль виконує винятково `abie`-специфічну перевірку. Структурні обмеження JSON6902 (наприклад, заборона комбінації `remove + add` на той самий path) перевіряються в окремому правилі `k8s.mdc` / `k8s.kustomization` rego — тут вони не дублюються.

Зворотний звʼязок виводиться через стандартний reporter (`createCheckReporter`), що повертає коректний exit-code для CI.

## Експорти / API

| Назва   | Тип       | Опис                                                                                                  |
| ------- | --------- | ----------------------------------------------------------------------------------------------------- |
| `check` | `async function(cwd?: string) => Promise<number>` | Іменований експорт. Основна функція перевірки. Повертає exit-code reporter-а (0 — успіх, 1 — помилки). |

Інших експортів файл не містить.

## Функції

### `check(cwd?)`

```js
export async function check(cwd = process.cwd()): Promise<number>
```

#### Параметри

| Імʼя  | Тип      | Обовʼязковий | За замовчуванням      | Опис                                  |
| ----- | -------- | ------------ | --------------------- | ------------------------------------- |
| `cwd` | `string` | ні           | `process.cwd()`       | Абсолютний шлях до кореня репозиторію. |

#### Повертає

`Promise<number>` — exit-code, отриманий з `reporter.getExitCode()`. Значення:

- `0` — усі перевірки пройдені (`pass`);
- ненульове — зафіксовано принаймні один `fail`.

#### Алгоритм

1. Створює репортер: `reporter = createCheckReporter()` і витягує методи `pass` / `fail`.
2. Зчитує ігнор-шляхи з `.cursorignore` через `loadCursorIgnorePaths(root)`.
3. Сканує дерево репозиторію функцією `findK8sYamlFiles(root, ignorePaths)` — повертає абсолютні шляхи до всіх YAML-файлів у структурі `k8s/`.
4. Викликає `collectDeploymentDirs(root, yamls, fail)` — отримує `Set` директорій, у яких є хоча б один обʼєкт `Deployment`.
5. **Early exit "немає Deployment":** якщо `deploymentDirs.size === 0`, репортить `pass('Немає Deployment у дереві k8s — patch nodeSelector (ua) не вимагається')` і повертає exit-code.
6. Будує список `uaAbsList` — підмножина `yamls`, де `relative(root, abs)` (з нормалізацією Windows-слешів `\\` → `/`) задовольняє `isUaKustomizationPath(...)`. Якщо `relative` повертає порожній рядок, береться `abs`.
7. **Early exit "немає ua/kustomization.yaml":** якщо `uaAbsList.length === 0`, репортить `fail('Є Deployment у k8s — додай ua/kustomization.yaml з patch на Deployment: path /spec/template/spec/nodeSelector, preem false (abie.mdc)')` і повертає exit-code.
8. Ітерує по `uaAbsList`. Для кожного абсолютного шляху `abs`:
   1. Обчислює `rel` (relative-шлях для повідомлень, з нормалізацією слешів; fallback на `abs` якщо relative порожній).
   2. Перевіряє `abieOverlayK8sTreeHasDeployment(deploymentDirs, root, abs)`. Якщо `false` — у відповідному пакеті немає `Deployment` у дереві `k8s`, тож patch не потрібен: `pass("${rel}: nodeSelector patch (ua) не застосовується — немає Deployment у дереві k8s цього пакета (abie)")` та `continue`.
   3. Намагається прочитати файл: `raw = await readFile(abs, 'utf8')`. У разі помилки витягує текст: `error instanceof Error ? error.message : String(error)`, репортить `fail("${rel}: не вдалося прочитати (${msg})")` і `continue`.
   4. Викликає `kustomizationHasAbieDeploymentNodeSelectorPatch(raw, 'ua')`. Якщо `false` — патч відсутній або не відповідає вимогам: `fail("${rel}: потрібен patch target kind Deployment: path /spec/template/spec/nodeSelector та preem: false (abie.mdc)")` і `continue`.
   5. Інакше — `pass("${rel}: nodeSelector patch (ua) відповідає abie.mdc")`.
9. Повертає `reporter.getExitCode()`.

#### Side effects

- **Файлова система (read-only):**
  - читання `.cursorignore` (через `loadCursorIgnorePaths`);
  - сканування дерева репозиторію (через `findK8sYamlFiles` та `collectDeploymentDirs`);
  - читання вмісту кожного `ua/kustomization.yaml` (`readFile(abs, 'utf8')`).
- **Запис у звіт:** виклики `pass(...)` / `fail(...)` змінюють внутрішній стан репортера та (як правило) пишуть повідомлення у stdout/stderr — поведінка інкапсульована у `createCheckReporter()`.
- **Не виконує жодної модифікації файлів** — це лише чек.
- **Не використовує мережу.**
- Помилки читання конкретного файлу не перериваються — фіксуються як `fail` і ітерація продовжується. Винятки інших функцій (`loadCursorIgnorePaths`, `findK8sYamlFiles`, `collectDeploymentDirs`) проброшуються наверх.

## Залежності

### Стандартна бібліотека Node.js

| Імпорт                            | Використання                                       |
| --------------------------------- | -------------------------------------------------- |
| `readFile` з `node:fs/promises`   | Асинхронне читання тексту YAML-файлу overlay-у `ua/kustomization.yaml`. |
| `relative` з `node:path`          | Побудова relative-шляху від `root` до `abs` для повідомлень репортера та для перевірки `isUaKustomizationPath`. |

### Внутрішні модулі проєкту

| Імпорт | Шлях | Використання |
| --- | --- | --- |
| `createCheckReporter` | `../../../scripts/lib/check-reporter.mjs` | Фабрика репортера з методами `pass`, `fail`, `getExitCode`. |
| `loadCursorIgnorePaths` | `../../../scripts/lib/load-cursor-config.mjs` | Завантаження списку шляхів-винятків (`.cursorignore`). |
| `collectDeploymentDirs` | `../lib/k8s-tree.mjs` | Збирає множину директорій, у яких є YAML з `kind: Deployment`. |
| `findK8sYamlFiles` | `../lib/k8s-tree.mjs` | Рекурсивний пошук YAML-файлів у дереві `k8s/`. |
| `kustomizationHasAbieDeploymentNodeSelectorPatch` | `../lib/kustomization-patches.mjs` | Перевірка наявності у вмісті `kustomization.yaml` коректного patch (`target kind: Deployment`, path `/spec/template/spec/nodeSelector`, `preem: false`) у overlay `ua`. |
| `abieOverlayK8sTreeHasDeployment` | `../lib/overlay-paths.mjs` | Перевіряє, чи у дереві `k8s` того пакета, до якого належить даний `ua/kustomization.yaml`, є хоча б один `Deployment`. |
| `isUaKustomizationPath` | `../lib/overlay-paths.mjs` | Чи задовольняє відносний шлях семантиці `ua/kustomization.yaml` (overlay `ua`). |

### Зовнішні правила, на які покликається модуль

- `abie.mdc` — джерело вимоги про `nodeSelector` та `preem: false` для overlay `ua`.
- `k8s.mdc` / `k8s.kustomization` (rego) — структурні обмеження JSON6902, що **не** перевіряються тут.

## Потік виконання / Використання

### Типовий сценарій виклику

Модуль використовується інфраструктурою чек-раннера правил Cursor (`n-cursor` / lint-pipeline), що ітерує по правилах і викликає експорт `check(cwd)`. Сам по собі файл не є CLI: він не має блоку `if (import.meta.url === ...) { ... }` та `process.exit()` — повертає exit-code, а викликач сам інтерпретує його.

Приклад прямого виклику з іншого скрипта:

```js
import { check } from './ua_node_selector.mjs'

const exitCode = await check(process.cwd())
process.exit(exitCode)
```

### Гілки виконання

1. **Немає жодного `Deployment` у дереві `k8s/`** → один `pass`, повертається `0` (за відсутності інших фейлів у репортері).
2. **`Deployment` є, але немає жодного `ua/kustomization.yaml`** → один `fail` з інструкцією додати overlay, повертається ненульовий exit-code.
3. **`Deployment` є, є `ua/kustomization.yaml`** — окремо для кожного знайденого `ua/kustomization.yaml`:
   - 3a. Пакет цього overlay не має `Deployment` у власному дереві `k8s/` (за `abieOverlayK8sTreeHasDeployment`) → `pass`.
   - 3b. Файл не вдалося прочитати → `fail` із текстом помилки.
   - 3c. Файл прочитано, але patch відсутній/невідповідний → `fail` з вимогою додати patch.
   - 3d. Файл містить коректний patch → `pass`.
4. Підсумок: exit-code = 0, якщо жодного `fail` не зафіксовано; інакше — ненульовий (визначається реалізацією `createCheckReporter`).

### Особливості реалізації

- Нормалізація шляхів: усі relative-шляхи перетворюються `replaceAll('\\', '/')`, щоб правила, що оперують POSIX-стилем (`ua/kustomization.yaml`), коректно працювали і на Windows.
- Якщо `relative(root, abs)` повертає порожній рядок (тобто `abs === root`), у повідомленнях та перевірках використовується `abs`.
- Помилка читання одного файлу не зриває весь чек — `continue` дозволяє продовжити обхід решти overlay-файлів.
- Принцип "patch не потрібен" (гілка 3a) важливий: у монорепо overlay `ua/kustomization.yaml` може існувати в пакеті без `Deployment`, і це не помилка.
