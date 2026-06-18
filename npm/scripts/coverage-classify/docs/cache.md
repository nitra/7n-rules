---
type: JS Module
title: cache.mjs
resource: npm/scripts/coverage-classify/cache.mjs
docgen:
  crc: 53b251b1
---

Модуль `cache.mjs` реалізує **file-hash-keyed cache** для вердиктів класифікатора покриття мутаційного тестування (`coverage-classify`). Призначення — уникати повторної (зазвичай дорогої — через LLM) класифікації того ж самого мутанта в незмінному файлі.

Ключова ідея кешу:

- Ключ кешу формується з трьох компонентів:
  1. `blob-hash` — sha1-хеш контенту source-файла (отримується через `git hash-object` з fallback на власне sha1 від `readFileSync`).
  2. Координати мутанта в файлі: `line:col`.
  3. `base64url` від рядка-replacement мутанта (щоб ключ був безпечним для будь-яких символів).
- Формат ключа: `` `<blob-hash>:<line>:<col>:<base64url(replacement)>` ``.

Логіка інвалідації:

- Будь-яка зміна source-файла → новий `blob-hash` → старий ключ більше ніколи не співпадає → `cache miss` → мутант буде перекласифіковано.
- Інвалідація автоматична: жодного TTL, версіонування user-input або ручного очищення не потрібно.

Схема кешу на диску:

```json
{
  "version": 1,
  "model": "string|null",
  "entries": {
    "<key>": {
      "verdict": "...",
      "confidence": "...",
      "reason": "...",
      "suggestedTest": "...",
      "classifiedAt": "..."
    }
  }
}
```

Поле `version` використовується як schema-guard: при зміні константи `CACHE_VERSION` всі старі файли кешу автоматично трактуються як порожні (без помилок), що дозволяє безпечно еволюціонувати схему.

## Експорти / API

Модуль експортує три іменовані функції (ESM):

| Функція                            | Призначення                                                                    |
| ---------------------------------- | ------------------------------------------------------------------------------ |
| `deriveBlobHash(filePath)`         | Обчислити sha1-хеш контенту файла.                                             |
| `deriveCacheKey(filePath, mutant)` | Сформувати повний ключ кешу для конкретного мутанта в конкретному стані файла. |
| `readCache(cachePath)`             | Безпечно прочитати cache з диска з порожнім fallback.                          |
| `writeCache(cachePath, cache)`     | Записати cache на диск (з автостворенням батьківських директорій).             |

Внутрішня (не експортована) константа:

- `CACHE_VERSION = 1` — поточна версія schema.

## Функції

### `deriveBlobHash(filePath)`

Обчислює 40-символьний hex sha1-хеш контенту файла.

- **Сигнатура:** `deriveBlobHash(filePath: string): string | null`
- **Параметри:**
  - `filePath` — абсолютний шлях до source-файла.
- **Повертає:**
  - 40-символьний hex-рядок (sha1) — якщо файл прочитано.
  - `null` — якщо файл не існує (`existsSync` повернув `false`).
- **Алгоритм:**
  1. Якщо файл відсутній — повернути `null`.
  2. Спробувати викликати `git hash-object <file>` через `execFileSync` з кодуванням `utf8` і обрізати whitespace (`.trim()`). Це детерміністичний хеш в межах working tree; точно такий же хеш Git використовує внутрішньо для blob-ів.
  3. Якщо `git` недоступний або кинув помилку — fallback: прочитати файл (`readFileSync`) і обчислити `createHash('sha1').update(content).digest('hex')`.
- **Side effects:** виконує зовнішній процес `git`; читає файл (у fallback-гілці).
- **Чому два шляхи:** `git hash-object` працює швидше для великих репозиторіїв і додає до хешу префікс `blob <size>\0` як справжній Git. Однак скрипт може бути запущений у середовищі без `git` (CI worker, контейнер) — звідси sha1-fallback. Для двох однакових файлів обидва методи дають **різні** хеші, але це **не критично**, бо ключ кешу самосумісний у межах одного запуску — головне, щоб хеш був детерміністичним для тих самих байтів.

### `deriveCacheKey(filePath, mutant)`

Формує ключ кешу для конкретного мутанта в конкретному стані файла.

- **Сигнатура:** `deriveCacheKey(filePath: string, mutant: { line: number, col: number, replacement: string }): string | null`
- **Параметри:**
  - `filePath` — абсолютний шлях до source-файла, в якому міститься мутант.
  - `mutant` — об'єкт-опис мутанта:
    - `line: number` — номер рядка (1-based, як прийнято в Stryker/інших мутаторах).
    - `col: number` — номер колонки.
    - `replacement: string` — рядок-заміна, який мутатор вставляє замість оригінального коду.
- **Повертає:**
  - Рядок виду `` `<sha1>:<line>:<col>:<base64url>` ``.
  - `null` — якщо `deriveBlobHash` повернув `null` (файл недоступний → ключ створити неможливо).
- **Алгоритм:**
  1. Отримати `blobHash` через `deriveBlobHash(filePath)`.
  2. Якщо `null` — повернути `null` (попереджаючий контракт: caller має обробити cache-miss).
  3. Закодувати `mutant.replacement` як `base64url` (без `=` padding і без `/`/`+`, що робить його безпечним і для filename, і для key).
  4. Зібрати ключ template-literal-ом.
- **Side effects:** ті ж, що й у `deriveBlobHash` (виклик `git`/`readFileSync`).
- **Чому `base64url`:** `replacement` може містити будь-які символи (двокрапки, переноси рядків, юнікод). `base64url` гарантує однорядковий ASCII-ключ без колізій по роздільнику `:`.

### `readCache(cachePath)`

Безпечно читає cache з диска. Будь-яка аномалія (відсутність файла, битий JSON, чужа схема) **не кидає** помилку, а повертає порожній cache.

- **Сигнатура:** `readCache(cachePath: string): { version: number, model: string | null, entries: Record<string, object> }`
- **Параметри:**
  - `cachePath` — абсолютний шлях до файла `cache.json`.
- **Повертає:** об'єкт cache-схеми. Або реальні дані з диска, або **empty cache**:

  ```js
  { version: CACHE_VERSION, model: null, entries: {} }
  ```

- **Алгоритм (5 умов повернення empty):**
  1. Файл не існує (`!existsSync(cachePath)`) → empty.
  2. `JSON.parse` кинув виняток → empty (catch).
  3. `data?.version !== CACHE_VERSION` (включно з `data === null`/`undefined`) → empty.
  4. `!data.entries` → empty.
  5. `typeof data.entries !== 'object'` або `Array.isArray(data.entries)` → empty.
  6. Інакше повернути `data` як є.
- **Side effects:** читає файл з диска (`readFileSync` з кодуванням `utf8`).
- **Інваріант:** ніколи не кидає винятки — гарантовано повертає валідний cache-об'єкт.

### `writeCache(cachePath, cache)`

Серіалізує cache в JSON і записує на диск.

- **Сигнатура:** `writeCache(cachePath: string, cache: { version: number, model: string | null, entries: Record<string, object> }): void`
- **Параметри:**
  - `cachePath` — абсолютний шлях, куди писати (наприклад `<repo>/.cache/coverage-classify/cache.json`).
  - `cache` — cache-об'єкт у відповідності до schema.
- **Повертає:** `void`.
- **Алгоритм:**
  1. `mkdirSync(dirname(cachePath), { recursive: true })` — гарантовано створює всі батьківські директорії; не падає, якщо вони вже існують.
  2. `writeFileSync(cachePath, JSON.stringify(cache, null, 2) + '\n', 'utf8')` — двопробільний indent для людиночитності + trailing newline (POSIX-конвенція).
- **Side effects:** створює директорії, перезаписує файл повністю (атомарність не гарантується — це звичайний `writeFileSync`).

## Залежності

Лише модулі стандартної бібліотеки Node.js (ESM):

| Імпорт                                                     | Звідки               | Призначення                                                        |
| ---------------------------------------------------------- | -------------------- | ------------------------------------------------------------------ |
| `execFileSync`                                             | `node:child_process` | Виклик `git hash-object` як зовнішнього процесу.                   |
| `createHash`                                               | `node:crypto`        | sha1-fallback, якщо `git` недоступний.                             |
| `existsSync`, `mkdirSync`, `readFileSync`, `writeFileSync` | `node:fs`            | Sync-FS-операції для cache та source-файлів.                       |
| `dirname`                                                  | `node:path`          | Виокремити батьківську директорію з cache-шляху перед `mkdirSync`. |

Зовнішніх npm-залежностей **немає**. Усі імпорти — з prefix `node:` (рекомендований формат для Node.js core-модулів).

Опціональна зовнішня залежність: бінарник `git` у `$PATH`. Якщо його немає — модуль автоматично переходить на sha1-fallback.

## Потік виконання / Використання

Типовий sequence використання у класифікаторі:

1. На старті прогону: `cache = readCache(cachePath)`.
2. Для кожного мутанта:
   1. `key = deriveCacheKey(filePath, mutant)`.
   2. Якщо `key === null` — пропустити (файл-джерело недоступний) або повторити пізніше.
   3. Якщо `cache.entries[key]` існує — використати збережений verdict, **не** викликати LLM.
   4. Інакше — викликати класифікатор (LLM/heuristic), отримати `verdict` і записати:
      ```js
      cache.entries[key] = { verdict, confidence, reason, suggestedTest, classifiedAt: new Date().toISOString() }
      ```
3. На завершенні прогону: `writeCache(cachePath, cache)`.

Граничні випадки та їх обробка:

- **Source файл видалили** → `deriveBlobHash` повертає `null` → `deriveCacheKey` повертає `null`. Caller повинен пропустити кешування.
- **Git недоступний** → автоматичний fallback на sha1. Ключі будуть відрізнятися від ключів, отриманих через `git hash-object` для того ж файла. Тому при міграції оточення можливий повний cache-miss — але це безпечно (просто повторна класифікація).
- **Cache-файл пошкоджений** → `readCache` повертає empty cache. Жодних винятків. Старий битий вміст буде перезаписаний при наступному `writeCache`.
- **Зміна `CACHE_VERSION`** → всі попередні файли кешу мовчки трактуються як empty. Безпечний шлях для еволюції schema.

Приклад мінімального використання:

```js
import { readCache, writeCache, deriveCacheKey } from './cache.mjs'

const cachePath = '/abs/path/to/cache.json'
const cache = readCache(cachePath)

const key = deriveCacheKey('/abs/path/to/src/foo.js', { line: 10, col: 5, replacement: '' })
if (key && cache.entries[key]) {
  // Cache hit — використати готовий verdict.
  const verdict = cache.entries[key]
  console.log(verdict)
} else if (key) {
  // Cache miss — викликати класифікатор і зберегти.
  const verdict = await classify(/* ... */)
  cache.entries[key] = { ...verdict, classifiedAt: new Date().toISOString() }
}

writeCache(cachePath, cache)
```

## Rebuild Test

Розумова перевірка: чи можна за цією документацією відтворити модуль без читання source? Так:

- Заявлені 4 експорти (`deriveBlobHash`, `deriveCacheKey`, `readCache`, `writeCache`) — всі описані з сигнатурами, типами параметрів, повертанням, side effects і алгоритмом.
- Внутрішня константа `CACHE_VERSION = 1` згадана.
- Schema cache-файла наведена.
- Алгоритм формування ключа (3 компоненти + base64url для replacement) пояснений однозначно.
- Fallback-логіка `git hash-object` → `sha1(readFileSync)` описана.
- Поведінка `readCache` при кожному типі помилки (5 пунктів) перерахована.
- Імпорти node-core модулів перелічені з їх роллю.
- Жодного зовнішнього npm-пакета не використано.
