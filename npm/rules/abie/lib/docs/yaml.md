# `yaml.mjs` — Спільні YAML-хелпери для abie-перевірок

## Огляд

Модуль `npm/rules/abie/lib/yaml.mjs` — це невеликий набір спільних хелперів, які використовуються в abie-перевірках (правила пакета `abie` в каталозі `npm/rules/abie/`) для роботи з YAML-файлами Kubernetes-маніфестів та інших YAML-документів.

Він вирішує три типові задачі, що зустрічаються в кожній abie-перевірці, яка читає YAML:

1. Прибрання `BOM`-символу (`U+FEFF`) на початку файлу — інакше парсер `yaml` може спіткнутися.
2. Розпізнавання й видалення першого рядка з `# yaml-language-server: $schema=...` (так звана `modeline`), яку IDE-плагіни вставляють для підказок схеми. Така директива не є валідним YAML-документом і має ігноруватися.
3. Уніфіковане читання файлу з диска + парсинг усіх документів YAML (`---`-розділених) у масив об'єктів `Document` з пакета `yaml`, з тихим failover на користувацький `failFn` замість викидання винятків назовні.

Окремо модуль експортує сталі-регулярки (`MODELINE_RE`, `LINE_SPLIT_RE`), хелпер-предикат для `kind: Deployment` (`isDeploymentDoc`) і no-op fail-handler `silentFail` для випадків, коли пошкоджені файли вже ловить інша перевірка (`check-k8s`) і дублювати помилку не треба.

Усі функції — pure / async-pure (єдина side effect — `readFile` в `readAndParseYamlDocs`).

## Експорти / API

Модуль є ESM (`.mjs`), має лише іменовані експорти. Default export відсутній.

| Експорт | Тип | Призначення |
| --- | --- | --- |
| `MODELINE_RE` | `RegExp` | Розпізнає рядок `# yaml-language-server: $schema=<url>`. |
| `LINE_SPLIT_RE` | `RegExp` | Розділювач рядків `\r?\n` з прапором `u`. |
| `stripBom(s)` | `(string) => string` | Прибирає `BOM`-символ із початку рядка. |
| `isDeploymentDoc(obj)` | `(unknown) => boolean` | Предикат: корінь YAML — це `kind: Deployment`. |
| `silentFail(_msg)` | `(string) => void` | No-op fail-handler (нічого не робить). |
| `readAndParseYamlDocs(abs, rel, failFn)` | `(string, string, (msg: string) => void) => Promise<Document[] \| null>` | Читає файл і парсить усі YAML-документи. |

### `MODELINE_RE`

```js
export const MODELINE_RE = /^#\s*yaml-language-server:\s*\$schema=(\S+)\s*$/
```

Регулярний вираз для розпізнавання `modeline` редактора (підтримка `$schema` через `yaml-language-server`). Якірі `^` і `$` означають, що рядок має містити саме цю директиву без жодного хвоста (окрім пробілів). Захоплює одну групу — URL/шлях схеми.

Зауваження: на момент написання код не використовує захоплену групу — лише викликає `.test()` для перевірки факту наявності modeline.

### `LINE_SPLIT_RE`

```js
export const LINE_SPLIT_RE = /\r?\n/u
```

Розділювач рядків, який коректно обробляє як Unix (`\n`), так і Windows (`\r\n`) переноси. Прапор `u` (Unicode-mode) не змінює поведінку для ASCII, але стандартизує семантику виразу.

### `stripBom(s)`

```js
export function stripBom(s) {
  return s.startsWith('﻿') ? s.slice(1) : s
}
```

- **Параметри**: `s: string` — вхідний текст файлу.
- **Повертає**: `string` — той самий текст, але без `BOM` на початку, якщо він був.
- **Side effects**: жодних.
- **Особливості**: літерал `'﻿'` у вихідному коді — це символ `U+FEFF` (zero-width no-break space / byte-order mark). Перевірка через `startsWith` означає, що зрізається рівно один символ — лише якщо файл саме з нього починається.

### `isDeploymentDoc(obj)`

```js
export function isDeploymentDoc(obj) {
  return (
    obj !== null &&
    typeof obj === 'object' &&
    !Array.isArray(obj) &&
    /** @type {Record<string, unknown>} */ (obj).kind === 'Deployment'
  )
}
```

- **Параметри**: `obj: unknown` — корінь YAML-документа (зазвичай результат `doc.toJS()` із пакета `yaml`).
- **Повертає**: `boolean` — `true`, якщо `obj` є plain-object (не `null`, не масив) і його поле `kind` дорівнює рядку `'Deployment'`.
- **Side effects**: жодних.
- **Use case**: швидкий guard у перевірках, що стосуються лише Kubernetes-`Deployment`. Дозволяє безпечно ігнорувати `Service`, `ConfigMap`, `Job` тощо без ризику кинути `TypeError` на null/array значеннях.

### `silentFail(_msg)`

```js
export const silentFail = _msg => {
  /* silent — пошкоджені файли ловить check-k8s */
}
```

- **Параметри**: `_msg: string` — повідомлення про помилку, ігнорується (підкреслення в імені — конвенція ESLint про навмисно невикористаний аргумент).
- **Повертає**: `void` (undefined).
- **Side effects**: жодних.
- **Призначення**: передається як `failFn` у `readAndParseYamlDocs`, коли модуль-споживач не хоче зіпсувати загальний результат перевірки через помилку файлу — інша перевірка (`check-k8s`) гарантовано репортить такі помилки, тож дублювати не треба.

### `readAndParseYamlDocs(abs, rel, failFn)`

```js
export async function readAndParseYamlDocs(abs, rel, failFn) {
  let raw
  try {
    raw = await readFile(abs, 'utf8')
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    failFn(`${rel}: не вдалося прочитати (${msg})`)
    return null
  }
  const body = stripBom(raw)
  const lines = body.split(LINE_SPLIT_RE)
  const first = lines[0] ?? ''
  const rest = MODELINE_RE.test(first.trim()) ? lines.slice(1).join('\n') : body
  try {
    return parseAllDocuments(rest)
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    failFn(`${rel}: YAML (${msg})`)
    return null
  }
}
```

- **Параметри**:
  - `abs: string` — абсолютний шлях до файлу на диску, який треба прочитати.
  - `rel: string` — відносний шлях (від кореня проєкту/правила), використовується лише в текстах повідомлень для `failFn`, щоб юзер бачив зручний шлях, а не довгий `abs`.
  - `failFn: (msg: string) => void` — callback, що викликається при помилці читання або парсингу. Очікується, що `failFn` додасть проблему до списку порушень правила або тихо проігнорує (`silentFail`).
- **Повертає**: `Promise<import('yaml').Document[] | null>` — масив YAML-документів (`parseAllDocuments` пакета `yaml`) або `null` у разі будь-якої помилки.
- **Side effects**:
  - Читає файл із диска (`fs/promises.readFile`).
  - Може викликати `failFn` (зовнішній callback) — інших побічних ефектів немає.
- **Обробка помилок**: винятки не пробрасуються — функція завжди резолвиться, або з масивом документів, або з `null`. Це робить її зручною для batch-обходу багатьох файлів у CI-перевірках без `try/catch` зовні.
- **Алгоритм**:
  1. Спроба прочитати файл як UTF-8. Якщо `readFile` кидає — повідомити через `failFn` і повернути `null`.
  2. Прибрати `BOM` через `stripBom`.
  3. Розбити вміст на рядки за `LINE_SPLIT_RE`.
  4. Узяти перший рядок (з дефолтом `''` через `??` на випадок порожнього файлу), `trim` його, перевірити проти `MODELINE_RE`. Якщо це modeline — підготувати `rest` як решту рядків, склеєних через `\n`; інакше — використати весь `body` без змін.
  5. Спробувати `parseAllDocuments(rest)`. Помилку парсингу повідомити через `failFn` (з префіксом `: YAML (...)`) і повернути `null`.
  6. У випадку успіху повернути масив `Document` (може бути порожнім для файлу без YAML-вмісту, але це не помилка).
- **Тонкі моменти**:
  - При склеюванні `rest` використовується саме `'\n'`, а не оригінальний роздільник, тому Windows-стиль `\r\n` тут «нормалізується» до Unix лише в гілці з modeline. Це не впливає на парсер `yaml`, бо він толерантний до обох стилів.
  - `first.trim()` дозволяє modeline мати провідні/хвостові пробіли; сам же `MODELINE_RE` уже допускає пробіли в кінці через `\s*$`.
  - Підстановка `lines[0] ?? ''` захищає від `undefined` — на практиці `split` ніколи не повертає порожній масив, але це pattern для строгого типчекінгу.

## Залежності

### Зовнішні (npm)

- **`yaml`** — пакет для парсингу YAML. Імпорт: `parseAllDocuments` (повертає масив `Document` об'єктів). Тип `Document` використовується в JSDoc-типах через `import('yaml').Document[]`. Цей пакет має бути в `dependencies` пакета `abie` (`npm/rules/abie/package.json`).

### Вбудовані (Node.js)

- **`node:fs/promises`** — асинхронний `readFile` для зчитування вмісту файлу як UTF-8 рядка.

### Внутрішні

- Не імпортує жодного локального модуля проєкту.

### Споживачі (взаємодія)

Функції цього модуля типово викликаються з:
- abie-`check-*.mjs` файлів у `npm/rules/abie/` (наприклад, `check-k8s.mjs` та інші правила, що працюють із Kubernetes-маніфестами).
- Будь-яких сусідніх хелперів у `npm/rules/abie/lib/`, що потребують уніфікованого парсингу YAML.

Сама `silentFail` явно посилається на `check-k8s` як на «авторитативного репортера» помилок YAML — тобто інші перевірки, які лише вторинно читають YAML, можуть бути «тихими» й не дублювати ту саму помилку.

## Потік виконання / Використання

### Типовий потік `readAndParseYamlDocs`

```
[abs, rel, failFn]
       │
       ▼
   readFile(abs, 'utf8')
       │              \
       │ ok            \ catch
       ▼                ▼
   stripBom        failFn("${rel}: не вдалося прочитати (...)") → null
       │
       ▼
   split за \r?\n  →  lines[]
       │
       ▼
   first = lines[0] ?? ''
       │
       ▼
   MODELINE_RE.test(first.trim()) ?
       │            \
       │ так          \ ні
       ▼              ▼
   rest = lines.slice(1).join('\n')   rest = body
       │              │
       └──────┬───────┘
              ▼
        parseAllDocuments(rest)
              │              \
              │ ok             \ catch
              ▼                 ▼
        Document[]    failFn("${rel}: YAML (...)") → null
```

### Приклад використання (типовий патерн у abie-правилі)

```js
import { readAndParseYamlDocs, isDeploymentDoc, silentFail } from './lib/yaml.mjs'

async function checkSomething(absPath, relPath, addProblem) {
  const docs = await readAndParseYamlDocs(absPath, relPath, addProblem)
  if (!docs) return // помилку вже додано через addProblem
  for (const doc of docs) {
    const obj = doc.toJS?.()
    if (!isDeploymentDoc(obj)) continue
    // ... власна логіка перевірки Deployment ...
  }
}

// Або, якщо інша перевірка вже репортить помилки YAML:
async function softCheck(absPath, relPath) {
  const docs = await readAndParseYamlDocs(absPath, relPath, silentFail)
  if (!docs) return
  // ... обробка ...
}
```

### Інваріанти / контракти

- `readAndParseYamlDocs` ніколи не кидає виняток назовні — повністю інкапсулює помилки в `failFn` + `null`.
- Повернений масив `Document[]` може бути порожнім (наприклад, для файлу, що складається лише з modeline і коментарів) — споживач має перевіряти `.length`/ітерувати, але не очікувати «хоча б один документ».
- `stripBom` ідемпотентна: повторний виклик на вже очищеному рядку поверне його без змін.
- `isDeploymentDoc(null)`, `isDeploymentDoc([])`, `isDeploymentDoc('Deployment')` усі повертають `false` — це навмисно, щоб уникнути false-positives на нестандартних входах.
- `silentFail` — найпростіший pure-no-op; його сигнатура збігається з очікуваним `failFn`, тому його можна підставляти всюди, де потрібен «нечутний» режим.

## Rebuild Test

Документ описує файл повністю в межах публічного контракту: усі експортовані ідентифікатори (`MODELINE_RE`, `LINE_SPLIT_RE`, `stripBom`, `isDeploymentDoc`, `silentFail`, `readAndParseYamlDocs`) розкриті з сигнатурами, поведінкою, граничними випадками, залежностями (`yaml.parseAllDocuments`, `node:fs/promises.readFile`) та типовим патерном використання. На основі цього опису можна відтворити еквівалентний модуль без перегляду вихідного коду.
