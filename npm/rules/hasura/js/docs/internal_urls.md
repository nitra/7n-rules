# internal_urls.mjs

## Огляд

Модуль `npm/rules/hasura/js/internal_urls.mjs` реалізує перевірку правила `hasura.mdc` для проєктів **nitra** та **abie**. Його єдина мета — гарантувати, що значення змінної середовища `HASURA_GRAPHQL_ENDPOINT`, заданої в будь-якому файлі `*.env` репозиторію, є **внутрішнім кластерним URL** (GKE/GCP DNS-суфікс `<cluster>.internal`), а не публічним доменом.

Логіка активується лише за умови, що поле `repository` кореневого `package.json` вказує на одну з організацій:

- `https://github.com/nitra/...`
- `https://github.com/abinbevefes/...`

Якщо ці маркери відсутні, перевірка пропускається без помилок (аналогічно до інших abie-перевірок).

Очікуваний формат URL:

```
http://<service>.<namespace>.svc.<cluster>.internal:<port>
```

Приклад валідного значення:

```
http://contract-h-hl.ua-contract.svc.abie-ua.internal:8080
```

Сегменти `<service>` та `<namespace>` за наявності YAML-файлів `hasura/k8s/base/svc-hl.yaml` (поле `metadata.name`, headless-сервіс із суфіксом `-h-hl`) та `hasura/k8s/base/namespace.yaml` (поле `metadata.name`) додатково звіряються з фактичними значеннями kubernetes-маніфестів.

Скануються всі файли, що відповідають масці `*.env` (наприклад, `dev.env`, `production.env`). Файл з іменем рівно `.env` (локальний файл розробника) **виключається** з перевірки. Не обходяться службові каталоги: `node_modules`, `.git`, `dist`, `coverage`, `.turbo`, `.next` (відповідно до конфігурації `walkDir`).

## Експорти / API

Модуль є ES-модулем (`.mjs`) і експортує:

| Експорт                       | Тип             | Призначення                                                                                       |
| ----------------------------- | --------------- | ------------------------------------------------------------------------------------------------- |
| `parseInternalHasuraEndpoint` | функція         | Розбирає URL-рядок на сегменти кластерної DNS-адреси (`service`, `namespace`, `cluster`, `port`). |
| `isEnvFile`                   | функція         | Чи підлягає файл за відносним шляхом перевірці hasura.mdc.                                        |
| `isNitraOrAbieRepository`     | функція         | Чи репозиторій належить організаціям nitra / abinbevefes.                                         |
| `check`                       | функція (async) | Точка входу: запускає повну перевірку для cwd, повертає exit-код процесу.                         |

Внутрішні (не експортовані) допоміжні функції: `readYamlMetadataName`, `collectEnvFiles`, `checkEnvFile`, `readRootRepositoryUrl`.

Внутрішні константи:

| Константа                     | Значення                            | Призначення                                                             |
| ----------------------------- | ----------------------------------- | ----------------------------------------------------------------------- |
| `NITRA_REPOSITORY_URL_MARKER` | `'https://github.com/nitra/'`       | Маркер репозиторіїв організації nitra.                                  |
| `ABIE_REPOSITORY_URL_MARKER`  | `'https://github.com/abinbevefes/'` | Маркер репозиторіїв організації abinbevefes (abie).                     |
| `HASURA_BASE_DIR`             | `'hasura/k8s/base'`                 | Базовий каталог k8s-маніфестів Hasura.                                  |
| `HASURA_SVC_HL_FILE`          | `'hasura/k8s/base/svc-hl.yaml'`     | Шлях до headless-сервіса.                                               |
| `HASURA_NAMESPACE_FILE`       | `'hasura/k8s/base/namespace.yaml'`  | Шлях до namespace-маніфесту.                                            |
| `ENV_FILE_RE`                 | `/\.env$/u`                         | Регулярка-маркер `*.env` файлів.                                        |
| `HASURA_ENDPOINT_LINE_RE`     | (див. нижче)                        | Регулярка для знаходження рядка `HASURA_GRAPHQL_ENDPOINT=...` у `.env`. |
| `INTERNAL_HASURA_URL_RE`      | (див. нижче)                        | Регулярка валідації внутрішнього кластерного URL.                       |
| `INTERNAL_DNS_SUFFIX`         | `'.internal'`                       | DNS-суфікс GKE/GCP-кластера.                                            |

Регулярні вирази:

- `HASURA_ENDPOINT_LINE_RE = /^[ \t]*(?:export[ \t]+)?HASURA_GRAPHQL_ENDPOINT[ \t]*=[ \t]*['"]?([^'"\r\n#]+)/mu`
  - Multiline, Unicode. Підтримує `export ` префікс, табуляції/пробіли навколо `=`, опційне обрамлення лапками (`'` або `"`). Капчурить значення до символа лапки, перенесення рядка або `#` (коментар).
- `INTERNAL_HASURA_URL_RE = /^http:\/\/([^./]+)\.([^./]+)\.svc\.([^./:]+\.internal):(\d+)\/?$/u`
  - Дозволяє лише схему `http://` (TLS усередині кластера зайвий).
  - Капчурить чотири сегменти: `service`, `namespace`, DNS-суфікс (з обов'язковим `.internal`), `port`.
  - Допускає необов'язковий завершальний слеш.

## Функції

### `parseInternalHasuraEndpoint(url)`

**Сигнатура:**

```js
export function parseInternalHasuraEndpoint(url)
```

**Параметри:**

- `url` (`string`) — значення `HASURA_GRAPHQL_ENDPOINT`, попередньо очищене від обрамляючих лапок (для надійності функція ще раз застосовує `.trim()`).

**Повертає:**

- При успіху: `{ ok: true, service: string, namespace: string, cluster: string, port: string }`. Поле `cluster` містить ім'я кластера **без** суфіксу `.internal` (наприклад, `abie-ua`).
- При невідповідності формату: `{ ok: false }`.

**Поведінка та особливості:**

- Дозволяє виключно протокол `http://` і DNS-суфікс `<cluster>.internal` (GKE/GCP-конвенція).
- Усі сегменти повертаються як рядки (включно з `port`, попри те що значення цифрове).
- Side effects відсутні.

### `readYamlMetadataName(absPath, kind)` (внутрішня)

**Сигнатура:**

```js
async function readYamlMetadataName(absPath, kind)
```

**Параметри:**

- `absPath` (`string`) — абсолютний шлях до YAML-файла.
- `kind` (`string`) — очікуваний `kind` ресурсу (`'Service'`, `'Namespace'` тощо).

**Повертає:** `Promise<string | null>` — значення `metadata.name` першого документа з відповідним `kind`, або `null`, якщо:

- файл не існує;
- парсинг YAML не вдався (`parseAllDocuments` кинув виключення);
- жоден документ у файлі не має заданого `kind` або не має `metadata.name`.

**Side effects:** одне читання з файлової системи (`readFile`); жодних винятків назовні не пропускає.

### `isEnvFile(relPath)`

**Сигнатура:**

```js
export function isEnvFile(relPath)
```

**Параметри:**

- `relPath` (`string`) — posix-шлях файла відносно кореня репозиторію.

**Повертає:** `boolean`.

- `true` — для файлів, у яких є ім'я перед `.env`: `dev.env`, `nitra.env`, `production.env`.
- `false` — для всіх інших, **зокрема** для файла рівно `.env` без імені (локальний файл розробника, виключений з правила hasura.mdc).

**Side effects:** немає.

### `collectEnvFiles(root, ignorePaths)` (внутрішня)

**Сигнатура:**

```js
async function collectEnvFiles(root, ignorePaths)
```

**Параметри:**

- `root` (`string`) — абсолютний шлях кореня репозиторію.
- `ignorePaths` (`string[]`) — абсолютні шляхи каталогів, які слід повністю пропустити при обході (зчитуються з cursor-конфігу).

**Повертає:** `Promise<string[]>` — відсортовані за `localeCompare` posix-шляхи `*.env` файлів відносно `root`.

**Поведінка:**

- Використовує `walkDir` з callback-фільтром.
- Конвертує windows-роздільники `\` у posix-роздільники `/` перед перевіркою `isEnvFile`.
- Працює дитерміновано завдяки сортуванню `toSorted`.

**Side effects:** обхід файлової системи.

### `checkEnvFile(relPath, cwd, expected, reporter)` (внутрішня)

**Сигнатура:**

```js
async function checkEnvFile(relPath, cwd, expected, reporter)
```

**Параметри:**

- `relPath` (`string`) — відносний posix-шлях файла (для повідомлень репортера).
- `cwd` (`string`) — корінь репозиторію (для побудови абсолютного шляху).
- `expected` (`{ service: string | null, namespace: string | null }`) — очікувані сегменти, прочитані з YAML-маніфестів; `null`-поля пропускаються.
- `reporter` (`{ pass: (msg: string) => void, fail: (msg: string) => void }`) — обробник результатів (зазвичай з `createCheckReporter`).

**Повертає:** `Promise<void>`. Результат комунікується через `reporter`.

**Поведінка по гілках:**

1. Якщо в файлі **немає** змінної `HASURA_GRAPHQL_ENDPOINT` — функція мовчки виходить без виклику `pass`/`fail`.
2. Якщо значення не парситься як внутрішній кластерний URL — викликає `fail` з прикладом очікуваного формату (`https://<service>.<namespace>.svc.<cluster>.internal:<port>`).
3. Якщо `expected.service` задане і не збігається — `fail` з посиланням на `hasura/k8s/base/svc-hl.yaml`.
4. Якщо `expected.namespace` задане і не збігається — `fail` з посиланням на `hasura/k8s/base/namespace.yaml`.
5. Інакше — `pass` з підтвердженням, що URL внутрішній кластерний.

**Side effects:** читання файла, виклики методів `reporter`.

**Примітка:** в `fail`-повідомленні приклад наведений зі схемою `https://`, хоча сама регулярка `INTERNAL_HASURA_URL_RE` дозволяє лише `http://` (так задумано — TLS усередині кластера зайвий).

### `readRootRepositoryUrl(cwd)` (внутрішня)

**Сигнатура:**

```js
async function readRootRepositoryUrl(cwd)
```

**Параметри:**

- `cwd` (`string`) — корінь репозиторію.

**Повертає:** `Promise<string | null>` — URL з поля `repository` (нормалізований через `getRepositoryUrl`) або `null`, якщо:

- `package.json` не існує;
- JSON не валідний;
- поле `repository` відсутнє / нерозпізнаний формат.

**Side effects:** одне читання `package.json`.

### `isNitraOrAbieRepository(url)`

**Сигнатура:**

```js
export function isNitraOrAbieRepository(url)
```

**Параметри:**

- `url` (`string | null | undefined`) — URL репозиторію.

**Повертає:** `boolean`.

- `true`, якщо `url` — рядок і містить (case-insensitive) маркер `https://github.com/nitra/` або `https://github.com/abinbevefes/`.
- `false` — у решті випадків (включно з `null`, `undefined`, не-рядковими значеннями).

**Side effects:** немає.

### `check(cwd?)`

**Сигнатура:**

```js
export async function check(cwd = process.cwd())
```

**Параметри:**

- `cwd` (`string`, опційний, за замовчуванням `process.cwd()`) — корінь репозиторію.

**Повертає:** `Promise<number>` — exit-код процесу (`0` — OK або правило не застосовується, `1` — є хоча б одне порушення). Конкретне значення формує `reporter.getExitCode()`.

**Поведінка (послідовно):**

1. Створює репортер через `createCheckReporter()`.
2. Зчитує URL репозиторію з `package.json`. Якщо це не nitra/abie — `pass('Пропущено: …')` і повертає exit-код (зазвичай `0`).
3. Зчитує очікувані `service` і `namespace` з YAML-маніфестів (обидва можуть бути `null`).
4. Завантажує `ignorePaths` з cursor-конфігу (`loadCursorIgnorePaths`).
5. Збирає всі `*.env` файли. Якщо їх немає — `pass('Не знайдено жодного *.env файла — нічого перевіряти')` і повертає exit-код.
6. Послідовно (без паралелізму) викликає `checkEnvFile` для кожного знайденого файла.
7. Якщо після перевірок exit-код залишився `0` і **жоден** файл не мав `HASURA_GRAPHQL_ENDPOINT` (тобто не було ні `pass`, ні `fail` зі змістом перевірки), додає підсумкове `pass` з кількістю та іменами перевірених файлів.

**Side effects:** читання файлів, обхід каталогів, виведення повідомлень репортера (зазвичай у stdout/stderr).

## Залежності

### Зовнішні модулі (npm)

- `yaml` — функція `parseAllDocuments` для парсингу мульти-документних YAML-файлів kubernetes-маніфестів.

### Node.js core

- `node:fs` — `existsSync` для синхронної перевірки наявності `package.json` та YAML-файлів.
- `node:fs/promises` — `readFile` для асинхронного читання файлів у UTF-8.
- `node:path` — `basename`, `join`, `relative` для роботи зі шляхами.

### Внутрішні модулі репозиторію

- `../../../scripts/auto-rules.mjs` — `getRepositoryUrl` для нормалізації поля `repository` у `package.json` (підтримує і рядкову, і об'єктну форму).
- `../../../scripts/lib/check-reporter.mjs` — `createCheckReporter` для уніфікованого механізму репортингу `pass`/`fail` та обчислення exit-коду.
- `../../../scripts/lib/load-cursor-config.mjs` — `loadCursorIgnorePaths` для отримання списку каталогів, виключених з обходу (повертає абсолютні шляхи).
- `../../../scripts/utils/walkDir.mjs` — `walkDir` для рекурсивного обходу файлової системи з callback-логікою і набором default-ignore (`node_modules`, `.git`, `dist`, `coverage`, `.turbo`, `.next`).

### Файли, що читаються в рантаймі

- `<cwd>/package.json` — джерело поля `repository`.
- `<cwd>/hasura/k8s/base/svc-hl.yaml` — джерело очікуваного `service` (якщо існує).
- `<cwd>/hasura/k8s/base/namespace.yaml` — джерело очікуваного `namespace` (якщо існує).
- `<cwd>/**/*.env` (без рівно `.env` і без ignore-каталогів) — файли, що перевіряються.

## Потік виконання / Використання

### Сценарій 1. Запуск як check-функції правила hasura.mdc

Модуль очікувано викликається з єдиної точки входу `check()` через інфраструктуру `npm/rules`/`scripts`. Типове використання:

```js
import { check } from './internal_urls.mjs'

const exitCode = await check(process.cwd())
process.exitCode = exitCode
```

### Сценарій 2. Послідовність кроків при виконанні `check()`

1. **Препроцесинг репозиторію.** Зчитується `package.json`. Якщо `repository` не вказує на nitra/abie — правило мовчки пропускається з повідомленням `pass`.
2. **Підготовка очікуваних значень.** Зчитуються `metadata.name` з `svc-hl.yaml` (як `Service`) і `namespace.yaml` (як `Namespace`). Кожне поле може бути `null` (тоді відповідна перевірка для сегмента URL не виконується).
3. **Збір кандидатів.** Через `walkDir` з ignore-списком з cursor-конфігу збираються усі `*.env` файли (відсортовано). Якщо колекція порожня — повідомляється `pass` і завершується.
4. **Перевірка кожного файла.** Для кожного знайденого `*.env`:
   - Якщо у файлі немає `HASURA_GRAPHQL_ENDPOINT` — пропуск без репортингу.
   - Інакше значення розбирається `parseInternalHasuraEndpoint`. Якщо парсинг не вдався — `fail`.
   - Якщо `expected.service` заданий і `parsed.service` не збігається — `fail`.
   - Якщо `expected.namespace` заданий і `parsed.namespace` не збігається — `fail`.
   - Інакше — `pass`.
5. **Підсумок.** Якщо за результатом усіх перевірок exit-код залишився `0` (тобто жодного `fail` не було), додається підсумкове `pass` з переліком імен файлів. Це покриває кейс, коли всі `*.env` не містили змінної взагалі.
6. **Exit-код.** Повертається через `reporter.getExitCode()`: `0` — успіх, `1` — є порушення.

### Сценарій 3. Що вважається валідним URL

Валідні приклади:

- `http://contract-h-hl.ua-contract.svc.abie-ua.internal:8080`
- `http://hasura-h-hl.nitra-prod.svc.nitra-cluster.internal:8080/`

Невалідні приклади (викличуть `fail`):

- `https://my.public.domain:443` — публічний домен.
- `http://hasura-h-hl.nitra-prod.svc.cluster.local:8080` — DNS-суфікс `.local`, а не `.internal`.
- `http://hasura-h-hl.svc.abie-ua.internal:8080` — відсутній сегмент `namespace`.
- `http://hasura-h-hl.nitra-prod.svc.abie-ua.internal` — відсутній port.
- `http://hasura-h-hl.nitra-prod.svc.abie-ua.internal:8080/graphql` — є шлях після `/`.

### Сценарій 4. Інтеграція в репортинг

Для цілісного запуску модуль не виводить нічого сам — усі повідомлення (`pass`/`fail`) делегуються `createCheckReporter()`. Це означає, що формат логів, кольори та сумарний exit-код узгоджені з рештою rule-перевірок у `npm/rules`.

### Сценарій 5. Граничні випадки

- **Файл `.env`** (без імені, локальний розробницький) **пропускається** на рівні `isEnvFile`.
- **Відсутнє `repository` в `package.json`** → правило пропускається з `pass`.
- **YAML-файли відсутні / невалідні** → відповідне поле `expected` стане `null` і перевірка сегмента не виконується (але формат URL все одно валідується).
- **`HASURA_GRAPHQL_ENDPOINT` у `.env` закоментований через `#` після значення** → регулярка зупиниться на `#`, повернувши значення до коментаря.
- **Значення в подвійних/одинарних лапках** → лапки відкидаються регуляркою-капчуром.
