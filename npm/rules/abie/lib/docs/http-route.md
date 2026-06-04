# http-route.mjs

## Огляд

Модуль `http-route.mjs` (шлях: `npm/rules/abie/lib/http-route.mjs`) реалізує крос-документну аналітику ресурсів Kubernetes Gateway API `HTTPRoute` у пакеті правила `abie`. Його основне призначення — перебрати base-маніфести пакета (всі yaml-файли в каталозі `k8s/`, що НЕ належать overlay `ua`), знайти серед них об'єкти `kind: HTTPRoute` і підрахувати, скільки разів у їх `spec.rules[].backendRefs[]` згадуються спільні крос-namespace сервіси (`auth-run-hl`, `file-link-hl`). Паралельно перевіряється правило: кожне таке посилання повинно мати поле `namespace: dev` (інакше додається помилка в `abie.mdc`-стилі).

Отримане число посилань (`refCount`) і список base-помилок використовується концерном `ua_http_route` правила `abie`, щоб переконатися, що кількість patch-ів namespace у overlay `ua` відповідає кількості base-reference на shared `-hl` сервіси. Тобто модуль виступає джерелом правди для подальшої cross-overlay-валідації.

Модуль чистий за побічними ефектами — він лише читає файли з диска (через делегування у `yaml.mjs`) і не змінює систему.

## Експорти / API

| Експорт | Тип | Призначення |
| --- | --- | --- |
| `ABIE_SHARED_CROSS_NS_BACKEND_NAMES` | `readonly string[]` (заморожений) | Канонічний перелік назв спільних `-hl` бекендів, які мають бути в namespace `dev` |
| `analyzeAbieSharedBackendRefsInPackageK8s(root, pkgAbs, yamlFilesAbs)` | `async function` | Головна точка входу: повертає `{ refCount, baseErrors }` для пакета |

Внутрішні (не експортовані) функції:

- `checkSharedBackendRef(br, rel, errors)` — валідація одного `backendRef`.
- `httpRouteDocSharedCrossNsBackendStats(obj, rel)` — статистика для одного YAML-документа.

Внутрішня константа:

- `ABIE_SHARED_CROSS_NS_BACKEND_SET` — `Set<string>`, побудований з `ABIE_SHARED_CROSS_NS_BACKEND_NAMES` для O(1) перевірки належності.

## Функції

### `checkSharedBackendRef(br, rel, errors)`

Перевіряє один елемент масиву `backendRefs`.

- **Сигнатура:** `function checkSharedBackendRef(br: unknown, rel: string, errors: string[]): number`
- **Параметри:**
  - `br` — окремий запис `backendRef` з YAML (очікується об'єкт-літерал; будь-який інший тип ігнорується).
  - `rel` — відносний (від кореня репозиторію) шлях файла з нормалізованими `/`, використовується у текстах помилок.
  - `errors` — мутабельний масив, у який функція додає рядок-помилку, якщо знайдено порушення namespace.
- **Повертає:** `1`, якщо `br` — це посилання на shared `-hl` сервіс (незалежно від того, чи додалася помилка); `0` в інших випадках (включно з тим, коли `br` не є плоским об'єктом, або його `name` не входить у `ABIE_SHARED_CROSS_NS_BACKEND_SET`).
- **Side effects:** мутація `errors` через `errors.push(...)`. Повідомлення формується як ``${rel}: HTTPRoute backendRefs до ${name} має містити namespace: dev (abie.mdc)``.
- **Алгоритм:**
  1. Відфільтрувати все, що не `Record<string, unknown>` (null, не-об'єкт, масив) → повернути `0`.
  2. Прочитати поле `name`; якщо це не рядок або імені немає в наборі shared-бекендів → повернути `0`.
  3. Якщо `namespace` не дорівнює рядку `"dev"` → запушити помилку.
  4. Повернути `1`, фіксуючи факт shared-reference.

### `httpRouteDocSharedCrossNsBackendStats(obj, rel)`

Збирає статистику по одному YAML-документу (одному об'єкту Kubernetes).

- **Сигнатура:** `function httpRouteDocSharedCrossNsBackendStats(obj: unknown, rel: string): { refCount: number, errors: string[] }`
- **Параметри:**
  - `obj` — корінь YAML-документа після `toJSON()`. Очікується об'єкт зі схемою `HTTPRoute`; будь-яка інша структура коректно деградує до `{ refCount: 0, errors: [] }`.
  - `rel` — відносний шлях файла (для повідомлень помилок).
- **Повертає:** об'єкт `{ refCount, errors }`:
  - `refCount` — скільки saved backend-references на shared `-hl` сервіси знайдено в документі.
  - `errors` — локальний список помилок (нові, не накопичувальний).
- **Side effects:** немає; функція чиста. Помилки збираються у новий локальний масив.
- **Алгоритм:**
  1. Перевірити, що `obj` — плоский об'єкт. Якщо ні — повернути нульовий результат.
  2. Перевірити, що `kind === 'HTTPRoute'`; інакше повернути нульовий результат.
  3. Дістати `spec`; якщо не плоский об'єкт — повернути нульовий результат.
  4. Дістати `spec.rules`; якщо це не масив — повернути нульовий результат.
  5. Для кожного `rule` (плоского об'єкта): дістати `rule.backendRefs`; якщо це масив — для кожного `br` викликати `checkSharedBackendRef(br, rel, errors)` і додати результат (`0` або `1`) до `refCount`.

### `analyzeAbieSharedBackendRefsInPackageK8s(root, pkgAbs, yamlFilesAbs)`

Точка входу, що працює на рівні пакета.

- **Сигнатура:** `async function analyzeAbieSharedBackendRefsInPackageK8s(root: string, pkgAbs: string, yamlFilesAbs: string[]): Promise<{ refCount: number, baseErrors: string[] }>`
- **Параметри:**
  - `root` — абсолютний шлях кореня репозиторію; служить базою для `relative(...)`.
  - `pkgAbs` — абсолютний шлях каталогу пакета (того, чий `abie`-маніфест аналізується).
  - `yamlFilesAbs` — повний список абсолютних шляхів yaml-файлів під `k8s/`, які потенційно належать пакету; фільтрація під базовий шар виконується через `isK8sYamlInAbiePackageExcludingUaOverlay`.
- **Повертає:** `Promise<{ refCount, baseErrors }>`:
  - `refCount` — сумарна кількість shared `-hl` backend-references по всіх base-документах пакета.
  - `baseErrors` — плоский агрегований масив повідомлень про порушення `namespace: dev` (можуть бути дублі за кількістю порушень).
- **Side effects:** дискові операції — читання yaml-файлів через `readAndParseYamlDocs(abs, rel, silentFail)`. Помилки парсингу проковтуються через `silentFail` (документ просто пропускається). Жоден yaml не пишеться.
- **Алгоритм:**
  1. Обчислити `pkgRel = relative(root, pkgAbs)`, нормалізувати слеші у `/`. Якщо результат порожній — використати `pkgAbs`.
  2. Ініціалізувати лічильник `refCount = 0` і порожній `baseErrors`.
  3. Для кожного `abs` зі списку:
     - Обчислити `rel = relative(root, abs)` (з тією ж нормалізацією і fallback на `abs`).
     - Викликати `isK8sYamlInAbiePackageExcludingUaOverlay(rel, pkgRel)`; якщо `false` — пропустити (це може бути файл іншого пакета або файл під overlay `ua`).
     - Прочитати документи: `await readAndParseYamlDocs(abs, rel, silentFail)`. Якщо повернулося falsy — пропустити.
     - Для кожного `doc` з `docs`: якщо `doc.errors.length === 0` (документ розпарсився без помилок) — викликати `doc.toJSON()` і передати у `httpRouteDocSharedCrossNsBackendStats(json, rel)`; інакше документ ігнорується.
     - Додати `st.refCount` до загального лічильника, розширити `baseErrors` через `...st.errors`.
  4. Повернути агрегований об'єкт.

## Залежності

### Зовнішні (Node.js standard library)

- `node:path` → `relative` — обчислення відносних шляхів від `root` до файла/пакета.

### Внутрішні (модулі того ж рівня)

- `./overlay-paths.mjs` → `isK8sYamlInAbiePackageExcludingUaOverlay(rel, pkgRel)` — фільтр, який гарантує: файл знаходиться у `k8s/` цього пакета і поза overlay `ua`.
- `./yaml.mjs` → `readAndParseYamlDocs(abs, rel, errorHandler)` — асинхронне читання й парсинг YAML у багатодокументний контейнер (елементи мають `.errors`, `.toJSON()`); `silentFail` — обробник, що проковтує помилки IO/parse.

### Споживачі

Модуль безпосередньо споживається концерном `ua_http_route` правила `abie` (за коментарем у заголовку файла) для звіряння кількості base-references зі вмістом overlay `ua`.

## Потік виконання / Використання

Типовий сценарій інтеграції (псевдо-приклад):

```js
import { analyzeAbieSharedBackendRefsInPackageK8s, ABIE_SHARED_CROSS_NS_BACKEND_NAMES } from './http-route.mjs'

// root — корінь репо; pkgAbs — каталог пакета з abie-маніфестами;
// yamlFilesAbs — попередньо зібраний список усіх *.yaml/*.yml під k8s/.
const { refCount, baseErrors } = await analyzeAbieSharedBackendRefsInPackageK8s(root, pkgAbs, yamlFilesAbs)

if (baseErrors.length > 0) {
  // У base-шарі є HTTPRoute з backendRefs до auth-run-hl/file-link-hl без namespace: dev.
}

// refCount далі звіряється з кількістю патчів namespace у overlay ua.
// ABIE_SHARED_CROSS_NS_BACKEND_NAMES — публічний перелік контрольованих сервісів.
```

Послідовність роботи на рівні одного пакета:

1. Викликач передає список yaml-файлів, корінь репо і каталог пакета.
2. `analyzeAbieSharedBackendRefsInPackageK8s` нормалізує `pkgRel`.
3. Для кожного файла перевіряється приналежність до base-шару пакета через `isK8sYamlInAbiePackageExcludingUaOverlay`.
4. Підходящий файл читається, парситься на документи; кожен валідний документ перевіряється на `kind === 'HTTPRoute'`.
5. У `HTTPRoute.spec.rules[].backendRefs[]` шукаються елементи з `name ∈ {auth-run-hl, file-link-hl}`.
6. Кожне таке посилання:
   - Інкрементує `refCount`.
   - Якщо `namespace !== 'dev'` — додається помилка у `baseErrors`.
7. Викликач отримує агрегований результат і використовує його для подальшої перевірки overlay `ua`.

Захисні властивості потоку:

- Будь-яка некоректна структура (масиви замість об'єктів, `null`, відсутність очікуваних ключів) безпечно деградує до нульового результату — функції ніколи не кидають через "криву" форму YAML.
- Помилки парсингу yaml-файлів проковтуються (`silentFail`) і не зупиняють обхід інших файлів.
- Документи з непорожнім `doc.errors` (yaml-помилки) пропускаються, але інші документи в тому ж файлі продовжують аналізуватися.
- Усі шляхи в повідомленнях нормалізовані до `/`, тож вихід однаковий на POSIX і Windows.
