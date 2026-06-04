# env-dns.mjs

## Огляд

Модуль `env-dns.mjs` реалізує перевірку відповідності внутрішньокластерних URL у env-файлах сервісу **abie** до фактичного GKE-кластера, на який цей env-файл націлений. Сервіс abie живе у двох кластерах:

- `abie-dev.internal` — кластер dev-середовища;
- `abie-ua.internal` — кластер продакшен-середовища UA.

Кожне середовище має свій env-файл за конвенцією імені (`*.dev.env`, `*.ua.env`, опційно з провідною крапкою — `.dev.env`, `.ua.env`). Всередині env-файлів зустрічаються внутрішньокластерні HTTP URL вигляду `http://<service>.<namespace>.svc.<cluster-dns>` (Kubernetes service DNS). Логіка цього модуля гарантує, що:

1. суфікс кластерного DNS у URL відповідає кластеру, відповідному імені env-файла (`dev.env` → `abie-dev.internal`, `ua.env` → `abie-ua.internal`);
2. namespace має відповідний префікс (`dev-` для dev-кластера, `ua-` для UA-кластера).

Локальний `.env`-файл без імені середовища (девелоперський оверрайд) свідомо виключено з валідації — він не належить жодному кластеру abie.

Модуль експортує три самостійні функції: класифікатор файлу за basename, сканер вмісту з накопиченням повідомлень про помилки та збирач списку файлів-кандидатів обходом дерева репозиторію.

## Експорти / API

| Експорт | Тип | Призначення |
| --- | --- | --- |
| `abieEnvNameFromBasename(basenameOfEnvFile)` | function | Класифікує basename env-файла: повертає `'dev'`, `'ua'` або `null`. |
| `validateAbieEnvInternalUrls(content, envName)` | function | Шукає у тексті env-файла всі internal-URL і повертає масив рядків з повідомленнями про помилки. |
| `collectAbieEnvFiles(root, ignorePaths)` | async function | Обходить дерево `root`, повертає відсортований список абсолютних шляхів до файлів, які є abie env. |

Внутрішні (не експортовані) константи модуля:

- `ABIE_ENV_FILE_BASENAME_RE` — `^\.?(dev|ua)\.env$` (Unicode-флаг). Базовий регулярний вираз для розпізнавання abie env-файлів за basename. Капчура `dev` або `ua`. Допускає одну необов'язкову провідну крапку (формат як `dev.env`, так і `.dev.env`).
- `ABIE_INTERNAL_URL_GLOBAL_RE` — глобальний регулярний вираз із трьома капчурами:
  - група 1: service (підмен DNS);
  - група 2: namespace;
  - група 3: cluster DNS (закінчується на `.internal`).

  Регулярний вираз додатково проковтує необов'язковий порт (`:<digits>`) та необов'язковий path-сегмент (до пробілу або лапки), але капчури їх не утримують. Прапори: `g`, `i`, `u`.

- `ABIE_ENV_CLUSTER_DNS_MAP` — заморожена мапа (`Object.freeze`) очікувань для кожного середовища:

  ```
  dev → { clusterDns: 'abie-dev.internal', namespacePrefix: 'dev-' }
  ua  → { clusterDns: 'abie-ua.internal',  namespacePrefix: 'ua-' }
  ```

  Структура також заморожена на рівні значень, щоб виключити випадкові мутації під час перевірки.

## Функції

### `abieEnvNameFromBasename(basenameOfEnvFile)`

- **Сигнатура:** `(basenameOfEnvFile: string) => 'dev' | 'ua' | null`
- **Параметри:**
  - `basenameOfEnvFile` — basename файла (без шляху). Наприклад: `dev.env`, `.ua.env`, `production.env`, `.env`.
- **Повертає:**
  - `'dev'` — якщо basename відповідає `dev.env` або `.dev.env`;
  - `'ua'` — якщо basename відповідає `ua.env` або `.ua.env`;
  - `null` — у будь-якому іншому випадку (включно з порожнім рядком, локальним `.env`, файлами типу `production.env`, `test.env` тощо).
- **Поведінка:** виконує одне зіставлення `String.prototype.match` з `ABIE_ENV_FILE_BASENAME_RE`. У разі співпадіння повертає першу капчуру, інакше — `null`.
- **Side effects:** немає, чиста функція.

### `validateAbieEnvInternalUrls(content, envName)`

- **Сигнатура:** `(content: string, envName: 'dev' | 'ua') => string[]`
- **Параметри:**
  - `content` — повний вміст env-файла (UTF-8 рядок).
  - `envName` — імʼя середовища (`'dev'` або `'ua'`), отримане заздалегідь (зазвичай через `abieEnvNameFromBasename`).
- **Повертає:** масив рядків-повідомлень про помилки. Якщо порушень немає — порожній масив. Якщо `envName` не входить у `ABIE_ENV_CLUSTER_DNS_MAP`, повертається порожній масив без помилки.
- **Поведінка:**
  1. Перевіряє `envName` за мапою очікувань; невідоме значення → `[]` (м'який no-op, безпечно для викликача).
  2. Через `content.matchAll(ABIE_INTERNAL_URL_GLOBAL_RE)` ітерує всі співпадіння internal-URL.
  3. Для кожного знайденого URL:
     - Якщо cluster DNS (група 3) не дорівнює очікуваному — додає помилку формату `"<fullUrl>: кластерний DNS \"<clusterDns>\" не відповідає env \"<envName>\" (очікується \"<expected.clusterDns>\")"`.
     - Якщо namespace (група 2) не починається з очікуваного префікса — додає помилку `"<fullUrl>: namespace \"<namespace>\" не починається з \"<expected.namespacePrefix>\" (env \"<envName>\")"`.
  4. Одне URL-співпадіння може дати **дві окремі помилки**, якщо одночасно невірні і DNS, і namespace.
  5. Якщо те саме URL зустрічається у двох змінних — отримаємо два незалежних співпадіння й, відповідно, два набори помилок (тобто помилки можуть дублюватись).
- **Side effects:** немає, чиста функція.
- **Деталі реалізації:** використовується деструктуризація з `match` — `const [fullUrl, , namespace, clusterDns] = match`. Перша капчура (service) свідомо пропущена `,` — повна назва service не потрібна валідатору. `fullUrl` — це елемент індексу 0 (увесь матч).

### `collectAbieEnvFiles(root, ignorePaths)`

- **Сигнатура:** `(root: string, ignorePaths: string[]) => Promise<string[]>`
- **Параметри:**
  - `root` — абсолютний шлях кореня репозиторію, від якого розпочинається рекурсивний обхід.
  - `ignorePaths` — масив абсолютних шляхів каталогів, які слід пропускати (передається у `walkDir` без змін).
- **Повертає:** `Promise`, який резолвиться масивом абсолютних шляхів файлів, basename яких розпізнано як abie env. Масив відсортований стабільно через `Array.prototype.toSorted` із порівнянням `String.prototype.localeCompare`.
- **Поведінка:**
  1. Створює внутрішній акумулятор `out`.
  2. Викликає `walkDir(root, callback, ignorePaths)` із `../../../scripts/utils/walkDir.mjs`.
  3. Колбек для кожного знайденого файла обчислює `basename(absPath)` через `node:path` і, якщо `abieEnvNameFromBasename(...)` не повертає `null`, штовхає `absPath` в `out`.
  4. Після завершення обходу — повертає відсортовану копію `out`.
- **Side effects:** виконує читання файлової системи через `walkDir`. Сам результат — чистий список шляхів, без читання вмісту файлів.

## Залежності

- `node:path` → іменована функція `basename`. Використовується для виділення імені файла зі шляху, повернутого `walkDir`.
- `../../../scripts/utils/walkDir.mjs` → функція `walkDir(root, callback, ignorePaths)`. Інкапсулює асинхронний рекурсивний обхід дерева директорій з виключеннями. Цей модуль розраховує на сигнатуру: перший аргумент — корінь, другий — колбек, що викликається для кожного файла з абсолютним шляхом, третій — список ігнорованих директорій. Контрактна асинхронність: `walkDir` повертає `Promise`, який чекається через `await`.

Зовнішніх npm-залежностей немає.

## Потік виконання / Використання

Модуль призначений для лінт-перевірок репозиторію (правило сімейства `n-rules`). Типовий сценарій використання у викликача:

```
import { readFile } from 'node:fs/promises'
import { basename } from 'node:path'

import {
  abieEnvNameFromBasename,
  collectAbieEnvFiles,
  validateAbieEnvInternalUrls
} from '../lib/env-dns.mjs'

const files = await collectAbieEnvFiles(repoRoot, ignoreList)
for (const file of files) {
  const envName = abieEnvNameFromBasename(basename(file))
  if (envName === null) continue
  const content = await readFile(file, 'utf8')
  const errors = validateAbieEnvInternalUrls(content, envName)
  for (const err of errors) reportError(`${file}: ${err}`)
}
```

Порядок виконання:

1. **Збір кандидатів.** `collectAbieEnvFiles` обходить весь репозиторій від `repoRoot` із врахуванням `ignorePaths` і повертає відсортований перелік abie env-файлів. Сортування забезпечує детермінованість виводу лінтера.
2. **Класифікація.** Для кожного файлу повторно (захищально, тому що collector міг бути викликаний окремо від валідатора) визначається `envName`. Не-abie файли відсіюються (`null`).
3. **Читання вмісту.** Викликач читає файл (модуль не виконує IO над вмістом — це робить ззовні).
4. **Валідація.** `validateAbieEnvInternalUrls(content, envName)` сканує текст регулярним виразом `ABIE_INTERNAL_URL_GLOBAL_RE` і повертає список людиночитних повідомлень про помилки (українська мова, формат `<URL>: <причина>`).
5. **Звітування.** Викликач агрегує помилки в результат правила.

Семантика помилок:

- невідповідність cluster DNS і namespace для одного URL — **дві окремі** записи у масиві;
- повторення того ж URL у різних змінних — окремі співпадіння → окремі помилки (без дедуплікації);
- невідомий `envName` у валідаторі → порожній масив (м'який fallback, без винятків).

Безпека/інваріанти:

- Регулярні вирази мають Unicode-флаг `u` — стійкі до некоректних surrogate-пар.
- `ABIE_ENV_CLUSTER_DNS_MAP` заморожена через `Object.freeze` як на верхньому рівні, так і для кожного зі значень — мутації не можливі.
- Жодна функція не модифікує вхідні аргументи.

## Rebuild Test

Перевірочний чек-лист (mental rebuild) для імплементації з нуля за цим описом:

- [x] Розпізнавання abie env: `dev.env`, `.dev.env`, `ua.env`, `.ua.env` → відповідно `'dev'`/`'ua'`; `production.env`, `.env`, `prod.env` → `null`.
- [x] Регулярний вираз для internal URL із трьома капчурами: service, namespace, cluster DNS (на `.internal`); опційний порт; опційний шлях; прапори `g`, `i`, `u`.
- [x] Мапа очікувань: `dev → abie-dev.internal / dev-`, `ua → abie-ua.internal / ua-`; обидва рівні заморожені.
- [x] Валідатор: ітерує `matchAll`, генерує до двох повідомлень на URL (DNS і namespace), повідомлення українською, містять fullUrl, фактичне і очікуване значення.
- [x] Невідомий `envName` → `[]` без винятків.
- [x] Collector: `walkDir(root, cb, ignorePaths)`, callback приймає абсолютний шлях, push в акумулятор, повертає `toSorted` з `localeCompare`.
- [x] Без зовнішніх npm-залежностей, лише `node:path` і локальний `walkDir`.
