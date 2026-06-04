# hc_pairing.mjs

## Огляд

Модуль реалізує JS-частину правила `abie` (Application Backend Infrastructure Element) — перевіряє **парність** Kubernetes `Deployment` і файлу `hc.yaml` поруч у дереві `k8s/`, а також валідність `modeline` (директива `yaml-language-server $schema`) у цьому `hc.yaml`.

Правило `abie` вимагає, щоб у кожному каталозі під `k8s/`, де лежить маніфест із `kind: Deployment`, поруч знаходився файл `hc.yaml` — `HealthCheckPolicy`, прив’язана до відповідного сервісу. Цей чек закриває два аспекти контракту:

1. **FS-парність** — існування `hc.yaml` поруч із кожним `Deployment`-каталогом.
2. **Modeline** — кожен такий `hc.yaml` починається з валідної `yaml-language-server`-директиви, яка вказує на правильну JSON-schema (для коректних підказок у IDE).

Структурна валідація вмісту `HealthCheckPolicy` (поля `apiVersion`, `requestPath`, `port`, наявність суфікса `-hl` у `targetRef.name` тощо) **не** виконується тут — її робить CLI окремо через policy `policy/health_check_policy/target.json` (walkGlob по `hc.yaml` у k8s-дереві).

Файл — стандартний `check-{id}.mjs` для правил `n-cursor`: експортує одну асинхронну функцію `check(cwd)`, яка повертає числовий exit-код через `createCheckReporter`.

## Експорти / API

| Експорт | Тип | Призначення |
| --- | --- | --- |
| `check` | `async (cwd?: string) => Promise<number>` | Запускає перевірку `abie/hc_pairing` для дерева `k8s/` під `cwd`. Повертає exit-код (0 — все OK, ≠ 0 — є помилки). |

Інших експортів немає. Файл — ESM-модуль (`.mjs`), default-експорту немає.

## Функції

### `check(cwd = process.cwd())`

**Сигнатура.**

```js
async function check(cwd?: string): Promise<number>
```

**Параметри.**

- `cwd` *(string, опційно)* — абсолютний шлях до кореня репозиторію, від якого ведеться пошук `k8s/`-дерева й обчислюються відносні шляхи у повідомленнях. За замовчуванням — `process.cwd()`.

**Повертає.**

- `Promise<number>` — exit-код від `reporter.getExitCode()`:
  - `0` — `Deployment` не знайдено взагалі **або** всі `hc.yaml` присутні з валідним modeline;
  - `≠ 0` — хоча б один `fail(...)` зафіксував порушення (відсутній `hc.yaml`, помилка читання чи невалідний modeline).

**Алгоритм (по кроках).**

1. Створити репортер: `const reporter = createCheckReporter()`, дістати з нього функції `pass` і `fail`.
2. Прийняти `root = cwd`.
3. Завантажити список ігнорованих шляхів із `.cursorignore`-конфігурації:
   `const ignorePaths = await loadCursorIgnorePaths(root)`.
4. Зібрати усі YAML-файли в дереві `k8s/`:
   `const yamls = await findK8sYamlFiles(root, ignorePaths)`.
5. Зібрати множину каталогів, у яких є хоч один `kind: Deployment` (у `collectDeploymentDirs` помилки парсингу YAML йдуть у переданий `fail`):
   `const deploymentDirs = await collectDeploymentDirs(root, yamls, fail)`.
6. **Ранній вихід:** якщо `deploymentDirs.size === 0` — `pass('Немає Deployment у дереві k8s — перевірку hc.yaml пропущено')` і одразу `return reporter.getExitCode()`. Це OK-сценарій (репозиторій без `k8s/`-маніфестів чи без `Deployment`).
7. Інакше — повідомити `pass(\`Знайдено Deployment у ${deploymentDirs.size} директорія(ї/й) k8s — перевіряємо hc.yaml поруч\`)`.
8. Відсортувати каталоги детерміновано (`toSorted` із `localeCompare`) і пройти по них:
   - Сформувати абсолютний шлях `hcAbs = \`${dir}/hc.yaml\`` та відносний `relHc` (з нормалізацією `\` → `/`; якщо `relative()` поверне порожній рядок — використати літерал `'hc.yaml'`).
   - Якщо `existsSync(hcAbs) === false` — викликати:
     `fail(\`${relative(root, dir) || dir}: є Deployment, але немає hc.yaml поруч — додай HealthCheckPolicy (abie.mdc)\`)` і перейти до наступного каталогу (`continue`).
   - Інакше — прочитати файл: `hcRaw = await readFile(hcAbs, 'utf8')`. У `try/catch`: при помилці —
     `fail(\`${relHc}: не вдалося прочитати (${msg})\`)` і `continue`. `msg` отримується з `error.message` (якщо `error instanceof Error`) або зі `String(error)`.
   - Перевірити modeline: `const modelineErr = validateAbieHcModeline(hcRaw, relHc)`.
     - Якщо `modelineErr === null` — `pass(\`${relHc}: modeline OK\`)`.
     - Інакше — `fail(modelineErr)` (повідомлення вже містить контекст `relHc`).
9. Повернути `reporter.getExitCode()`.

**Side effects.**

- **FS-операції:** `existsSync` для перевірки наявності `hc.yaml`, `readFile` для зчитування вмісту. Запис у FS відсутній.
- **STDOUT/STDERR:** не пише напряму — усі повідомлення йдуть через `pass`/`fail` репортера (агрегування виводу — відповідальність `createCheckReporter`).
- **process:** не змінює змінні оточення, не реєструє хендлери; читає лише `process.cwd()` як дефолт для `cwd`.
- **Детермінізм:** результат не залежить від порядку файлів у FS — каталоги відсортовані `localeCompare`.

**Помилкові сценарії, які логуються через `fail`.**

- Каталог містить `kind: Deployment`, але `hc.yaml` поруч відсутній.
- `hc.yaml` існує, але не читається (немає прав, race condition тощо).
- `validateAbieHcModeline(hcRaw, relHc)` повернув не-`null` (рядок із поясненням, що саме не так із modeline).
- Помилки парсингу YAML у `findK8sYamlFiles` / `collectDeploymentDirs` (фіксуються всередині цих хелперів через переданий `fail`).

## Залежності

### Зовнішні (Node.js core)

- `node:fs` → `existsSync` — синхронна перевірка існування `hc.yaml`.
- `node:fs/promises` → `readFile` — асинхронне читання `hc.yaml` у UTF-8.
- `node:path` → `relative` — обчислення відносних шляхів від `root` для повідомлень репортера.

### Внутрішні (проєктні)

- `../../../scripts/lib/check-reporter.mjs` → `createCheckReporter` — фабрика репортера з API `{ pass, fail, getExitCode }`, що агрегує результат перевірки в єдиний exit-код.
- `../../../scripts/lib/load-cursor-config.mjs` → `loadCursorIgnorePaths` — завантажує список ігнорованих шляхів із `.cursorignore`-конфігурації, щоб виключити їх з обходу `k8s/`-дерева.
- `../lib/hc-yaml.mjs` → `validateAbieHcModeline(hcRaw, relHc)` — перевіряє рядок modeline (`yaml-language-server $schema`) у вмісті `hc.yaml`; повертає `null` при успіху або готовий рядок-повідомлення з префіксом `relHc` при помилці.
- `../lib/k8s-tree.mjs` →
  - `findK8sYamlFiles(root, ignorePaths)` — знаходить усі YAML-файли під `k8s/`, з урахуванням ігнор-списку;
  - `collectDeploymentDirs(root, yamls, fail)` — повертає `Set<string>` абсолютних шляхів каталогів, у яких хоч один YAML містить `kind: Deployment`; помилки YAML-парсингу делегує в передану функцію `fail`.

### Контракт залежностей (припущення модуля)

- `reporter.pass(msg)` і `reporter.fail(msg)` — обидва приймають один рядок-повідомлення.
- `reporter.getExitCode()` — повертає `number` (0 — успіх, інше — помилка), детерміновано на основі викликів `fail`.
- `collectDeploymentDirs` повертає об’єкт із доступним `.size` та підтримкою ітерації (`Set<string>` або сумісний).
- `validateAbieHcModeline` повертає `null | string`: `null` — modeline валідний; `string` — готове повідомлення помилки (без додаткового форматування на боці виклику).

## Потік виконання / Використання

Файл реєструється як `check`-модуль правила `abie` у системі правил `n-cursor` і викликається разом з іншими `check-*.mjs` через CLI або раннер тестів правил.

### Типовий виклик (програмно)

```js
import { check } from './hc_pairing.mjs'

const exitCode = await check(process.cwd())
process.exit(exitCode)
```

### Логічний потік

```
check(cwd)
  ├─ createCheckReporter()                      → { pass, fail, getExitCode }
  ├─ loadCursorIgnorePaths(root)                → ignorePaths
  ├─ findK8sYamlFiles(root, ignorePaths)        → yamls[]
  ├─ collectDeploymentDirs(root, yamls, fail)   → Set<dir>
  │
  ├─ if Set.size === 0
  │     pass('Немає Deployment …')
  │     return getExitCode()
  │
  ├─ pass('Знайдено Deployment у N директорія(ї/й) …')
  │
  ├─ for dir of sorted(Set):
  │     hcAbs = `${dir}/hc.yaml`
  │     relHc = relative(root, hcAbs) | 'hc.yaml'
  │     ├─ if !existsSync(hcAbs)
  │     │     fail('… немає hc.yaml поруч — додай HealthCheckPolicy (abie.mdc)')
  │     │     continue
  │     ├─ try readFile(hcAbs, 'utf8')
  │     │     catch → fail(`${relHc}: не вдалося прочитати (${msg})`); continue
  │     ├─ modelineErr = validateAbieHcModeline(hcRaw, relHc)
  │     │     null → pass(`${relHc}: modeline OK`)
  │     │     else → fail(modelineErr)
  │
  └─ return getExitCode()
```

### Розподіл відповідальності з CLI

Цей JS-чек **навмисно** обмежений FS-парністю та modeline:

- **JS (цей файл):** «чи є `hc.yaml` поруч із кожним `Deployment`-каталогом?» + «чи коректний рядок `yaml-language-server $schema` у цьому файлі?».
- **CLI / policy:** структурна валідація вмісту `HealthCheckPolicy` (`apiVersion`, `requestPath`, `port`, наявність `targetRef.name` із суфіксом `-hl` тощо) — описано в `policy/health_check_policy/target.json`, проганяється walkGlob по `hc.yaml`.

Такий поділ дозволяє JS-частині залишатися швидкою й детермінованою (без YAML-парсингу вмісту `hc.yaml`), а складну валідацію тримати у декларативній policy.

### Очікувана структура `k8s/`-дерева

```
k8s/
  service-a/
    deployment.yaml          ← kind: Deployment
    hc.yaml                  ← обов’язково поруч (HealthCheckPolicy)
  service-b/
    deployment.yaml
    (hc.yaml відсутній)      ← fail: «є Deployment, але немає hc.yaml поруч»
```

### Інтеграція в раннер правил

- Модуль не має побічного запуску при імпорті (немає top-level `await check(...)`) — це чистий експорт `check`, що дозволяє раннеру викликати його коли потрібно й кілька разів із різним `cwd` у тестах.
- Усі повідомлення локалізовані українською (відповідно до конвенції `n-cursor`-чеків).
- Сортування каталогів через `localeCompare` гарантує стабільний порядок виводу між запусками — це важливо для золотих snapshot-тестів.
