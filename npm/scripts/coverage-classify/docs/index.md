# `coverage-classify/index.mjs`

## Огляд

Модуль `coverage-classify/index.mjs` — це **публічна точка входу** (Public API) класифікатора survived-мутантів за допомогою Claude API від Anthropic. Він відповідає за оркестрацію LLM-класифікації мутантів, які пережили mutation-testing раунд (тобто не були вбиті жодним тестом), і повертає для кожного з них вердикт у форматі `{ verdict, confidence, reason, suggestedTest? }`.

Призначення модуля — допомогти автоматичним інструментам типу `/n-coverage-fix` ухвалювати рішення, чи варто дописувати тест на конкретний survived-мутант, чи можна його ігнорувати як equivalent / not-worth-testing.

Ключові архітектурні характеристики:

- **Graceful degradation:** відсутність змінної `ANTHROPIC_API_KEY` або непрацездатний dynamic import пакета `@anthropic-ai/sdk` не приводить до краху — функція мовчки повертає порожній масив `[]`, попередньо вивівши попередження у `console.warn`.
- **Persistent cache:** результати класифікації кешуються на диск через утиліти з `./cache.mjs`. При зміні `MODEL` кеш повністю інвалідується (entries чистяться, поле `model` оновлюється). Це гарантує консистентність вердиктів між запусками за умови незмінного контексту мутанта.
- **Prompt caching на стороні API:** системний промпт передається з `cache_control: { type: 'ephemeral' }` — усі мутанти одного прогону reuse кешований префікс на стороні Anthropic API (економія токенів).
- **Retry з експоненційним backoff:** кожен мутант отримує до `MAX_RETRIES + 1 = 3` спроб; між спробами — затримка `retryDelayMs * 2 ** attempt`. Після вичерпання спроб — повертається **conservative fallback** `worth-testing/confidence=0`, щоб не втратити мутант з виду.

Модуль не виконує мережевих викликів самостійно — він делегує їх в `client.messages.create(...)` (за замовчуванням це інстанс `new Anthropic()` з SDK).

## Експорти / API

| Експорт      | Тип      | Опис                                                                                          |
| ------------ | -------- | --------------------------------------------------------------------------------------------- |
| `classify`   | function | Іменований async-експорт. Класифікує всіх survived-мутантів і повертає масив `{ key, verdict }`. |

Інші ідентифікатори файлу (`MODEL`, `MAX_RETRIES`, `DEFAULT_RETRY_DELAY_MS`, `FALLBACK_VERDICT`, `classifyOne`) — **внутрішні**, не експортуються.

### Сигнатура `classify`

```js
export async function classify(survived, cwd, opts = {})
```

**Параметри:**

- `survived` — `Array<{ file: string, mutants: Array<object>, exampleTest?: object|null, recommendationText?: string|null }>` — список survived-груп. Структура аналогічна до використовуваної в `COVERAGE.md` (звіт mutation-testing). Кожна група відповідає одному файлу та містить масив мутантів.
- `cwd` — `string` — абсолютний шлях кореня проєкту. Використовується для:
  - формування дефолтного шляху кешу (`<cwd>/npm/reports/coverage-classify.cache.json`);
  - резолвінгу шляхів до файлів-джерел мутантів (для побудови юзер-промпта та cache key).
- `opts` — `{ cachePath?: string, client?: object, retryDelayMs?: number }` — опціональні ін'єкції для тестування:
  - `cachePath` — кастомний шлях до файлу кешу.
  - `client` — підставний Anthropic SDK client (для unit-тестів без реальних мережевих викликів). Має мати метод `messages.create(...)`.
  - `retryDelayMs` — базова затримка для exp-backoff у мс. `0` фактично вимикає sleep між retries (зручно для тестів).

**Повертає:** `Promise<Array<{ key: string, verdict: object }>>`

- `key` — рядок формату `<file>:<line>:<col>:<replacement>`, який однозначно ідентифікує мутант для зовнішнього коду.
- `verdict` — об'єкт з полями `{ verdict, confidence, reason, suggestedTest? }` (формат описаний у `./verdict-schema.mjs`).

При відсутності API-ключа або SDK — повертає `[]`.

## Функції

### `classify(survived, cwd, opts)` — публічна

**Сигнатура:** `async function classify(survived, cwd, opts = {}) -> Promise<Array<{key, verdict}>>`

**Параметри:** див. розділ «Експорти / API» вище.

**Повертає:** `Promise<Array<{ key: string, verdict: object }>>` — плаский список вердиктів по всіх мутантах усіх груп (порядок: group-by-group, mutant-by-mutant у межах групи).

**Кроки виконання (orchestration):**

1. Резолвить `cachePath` (дефолт: `<cwd>/npm/reports/coverage-classify.cache.json`) та `retryDelayMs` (дефолт: `DEFAULT_RETRY_DELAY_MS = 1000`).
2. Перевіряє `env.ANTHROPIC_API_KEY`. Якщо відсутній — `console.warn` + `return []`.
3. Виконує `await import('@anthropic-ai/sdk')`. Якщо пакет не встановлено — `console.warn` + `return []`.
4. Створює клієнт: `opts.client ?? new Anthropic()`.
5. Завантажує кеш через `readCache(cachePath)`. Якщо `cache.model !== MODEL` — повністю чистить `cache.entries` і виставляє `cache.model = MODEL` (інвалідація при зміні моделі).
6. Ітерує `survived.mutants`:
   - Будує `lookupKey = "<group.file>:<line>:<col>:<replacement>"`.
   - Обчислює `cacheKey = deriveCacheKey(join(cwd, group.file), mutant)`.
   - Якщо в кеші є запис — повертає його (нормалізуючи поля, опціонально розгортаючи `suggestedTest`).
   - Інакше викликає `classifyOne(client, group, mutant, cwd, retryDelayMs)` і записує результат у `cache.entries[cacheKey]` з полем `classifiedAt: new Date().toISOString()` (якщо `cacheKey` truthy).
7. Зберігає кеш на диск через `writeCache(cachePath, cache)`.
8. Повертає накопичений `verdicts`.

**Side effects:**

- **Disk I/O:** читання і запис файлу кешу (`<cwd>/npm/reports/coverage-classify.cache.json` за замовчуванням).
- **Мережа:** виклики `client.messages.create(...)` до Anthropic API (через делегування в `classifyOne`).
- **stdout/stderr:** `console.warn(...)` при відсутності ключа / SDK / при фатальних retry-фейлах окремих мутантів.
- **Час:** функція **очікує** мережеві запити послідовно (no parallelism між мутантами) — у гіршому випадку загальна тривалість = `N × (MAX_RETRIES+1) × API_latency + sum(backoff)`.
- **Стан системи:** мутації `cache` на місці (об'єкт переписується), потім дамп на диск.

### `classifyOne(client, group, mutant, cwd, retryDelayMs)` — внутрішня

**Сигнатура:** `async function classifyOne(client, group, mutant, cwd, retryDelayMs) -> Promise<object>`

**Параметри:**

- `client` — `{ messages: { create: Function } }` — Anthropic SDK client (реальний або mock).
- `group` — `{ file: string }` — група для контексту (з неї потрібно лише `.file` — повний шлях до файлу-джерела).
- `mutant` — `object` — дані мутанта (передаються в `buildUserPrompt` як `{ ...mutant, file: group.file }`).
- `cwd` — `string` — корінь проєкту, потрібний для resolving шляхів у `buildUserPrompt`.
- `retryDelayMs` — `number` — базова затримка для exp-backoff (`0` у тестах вимикає sleep).

**Повертає:** `Promise<object>` — розпарсений вердикт (через `parseVerdict(text)`) або копія `FALLBACK_VERDICT`.

**Кроки виконання:**

1. Будує юзер-промпт: `userPrompt = buildUserPrompt({ ...mutant, file: group.file }, cwd)`.
2. Цикл `for (attempt = 0; attempt <= MAX_RETRIES; attempt++)`:
   - Виконує `client.messages.create({ model: MODEL, max_tokens: 1024, system: [{ type:'text', text: SYSTEM_PROMPT, cache_control:{ type:'ephemeral' } }], messages: [{ role:'user', content: userPrompt }] })`.
   - Дістає текст з `response?.content?.[0]?.text ?? ''`.
   - Повертає `parseVerdict(text)`. Якщо `parseVerdict` кидає — це впаде як виключення і потрапить в `catch` цієї ж ітерації (тобто буде ще одна retry-спроба).
3. На `catch`: запам'ятовує `lastError`. Якщо `attempt < MAX_RETRIES && retryDelayMs > 0` — `await setTimeout(retryDelayMs * 2 ** attempt)`.
4. Після вичерпання спроб: `console.warn` з деталями (file:line:col, кількість спроб, повідомлення останньої помилки) і `return { ...FALLBACK_VERDICT }` (копія, щоб уникнути shared mutation на константі).

**Side effects:**

- Мережевий виклик до Anthropic API (1..MAX_RETRIES+1 разів).
- `setTimeout` з `node:timers/promises` (async sleep).
- `console.warn` при фатальному фейлі.

## Залежності

### Внутрішні (relative imports)

| Шлях                    | Що використовується                                | Призначення                                                                                                 |
| ----------------------- | -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `./cache.mjs`           | `deriveCacheKey`, `readCache`, `writeCache`        | Робота з персистентним кешем класифікацій (deriving детермінованого ключа з мутанта + читання/запис JSON).  |
| `./prompt.mjs`          | `buildUserPrompt`, `SYSTEM_PROMPT`                 | Побудова промптів для LLM: системний (статичний, кешується) та юзер-промпт (динамічний, per-mutant).        |
| `./verdict-schema.mjs`  | `parseVerdict`                                     | Парсинг та валідація JSON-відповіді LLM у структурований об'єкт вердикту.                                   |

### Зовнішні

| Пакет/модуль                  | Що використовується             | Як підключено                                                                |
| ----------------------------- | ------------------------------- | ---------------------------------------------------------------------------- |
| `node:path`                   | `join`                          | Статичний `import`. Збирання шляхів до cache file та source file.            |
| `node:process`                | `env`                           | Статичний `import`. Читання `ANTHROPIC_API_KEY`.                             |
| `node:timers/promises`        | `setTimeout`                    | Статичний `import`. Async sleep для exp-backoff між retries.                 |
| `@anthropic-ai/sdk`           | `Anthropic` (default export)    | **Dynamic** `await import(...)` всередині `classify` — graceful degradation, якщо пакет не встановлено. |

### Зовнішні артефакти середовища

- **Змінна оточення `ANTHROPIC_API_KEY`** — обов'язкова. Без неї модуль не робить мережевих викликів.
- **Файл кешу** — за замовчуванням `<cwd>/npm/reports/coverage-classify.cache.json`. Структура: `{ model: string, entries: { [cacheKey]: { verdict, confidence, reason, suggestedTest?, classifiedAt } } }`.

### Константи модуля

| Константа                  | Значення                  | Призначення                                                                          |
| -------------------------- | ------------------------- | ------------------------------------------------------------------------------------ |
| `MODEL`                    | `'claude-sonnet-4-6'`     | ID моделі Anthropic для класифікації. Зміна → автоматична інвалідація кешу.          |
| `MAX_RETRIES`              | `2`                       | Кількість **повторних** спроб (всього спроб: `MAX_RETRIES + 1 = 3`).                |
| `DEFAULT_RETRY_DELAY_MS`   | `1000`                    | Базова затримка для exp-backoff (мс). Реальні delays: 1000, 2000, 4000.              |
| `FALLBACK_VERDICT`         | `{ verdict: 'worth-testing', confidence: 0, reason: '...' }` | Консервативний вердикт при фатальному фейлі (мутант ще не відкидається). |

## Потік виконання / Використання

### Типовий сценарій виклику

Модуль викликається з вищерівневого pipeline (наприклад, `/n-coverage-fix` або інший CLI поверх mutation-testing звіту):

```js
import { classify } from '<repo>/npm/scripts/coverage-classify/index.mjs'

// survived зазвичай парситься з COVERAGE.md
const survived = [
  {
    file: 'src/utils/foo.mjs',
    mutants: [
      { line: 10, col: 5, replacement: '=== 0', original: '!== 0', mutator: 'EqualityOperator' },
      // ...
    ],
    exampleTest: null,
    recommendationText: null
  },
  // ...
]

const verdicts = await classify(survived, process.cwd())

for (const { key, verdict } of verdicts) {
  if (verdict.verdict === 'worth-testing' && verdict.confidence > 0.5) {
    // дописати тест
  }
}
```

### Стани виходу та граничні випадки

| Стан                                                   | Поведінка                                                                          |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| `ANTHROPIC_API_KEY` не виставлений                     | `console.warn` + `return []` (порожній масив, не помилка).                         |
| Пакет `@anthropic-ai/sdk` не встановлено               | `console.warn` + `return []`.                                                      |
| Кеш hit для мутанта                                    | Мережевий виклик не виконується, повертається cached verdict.                      |
| Кеш miss, успішна класифікація                         | Виклик API, парсинг, запис у кеш, push у verdicts.                                 |
| Кеш miss, всі retry-спроби впали                       | `console.warn` з деталями + `FALLBACK_VERDICT` push у verdicts (мутант не пропадає). |
| Зміна `MODEL` у коді                                   | На наступному запуску `cache.entries` повністю обнуляється.                        |
| `cacheKey === null/undefined` (наприклад, неможливо derive) | Класифікація виконується, але **не** кешується (запис у кеш пропускається).        |

### Послідовність всередині одного прогону (timeline)

1. Читання `survived` (відповідальність caller'а).
2. `classify(...)` запускається → preflight перевірки (API key, SDK).
3. Завантаження дискового кешу → можливе очищення при зміні моделі.
4. **Послідовно** (не паралельно) для кожного `(group, mutant)`:
   - Cache lookup (за `cacheKey`).
   - Якщо miss — `classifyOne` з retry-логікою.
   - Запис у кеш-об'єкт у пам'яті.
5. Після обходу всіх мутантів — атомарний `writeCache` на диск.
6. Повернення `verdicts` caller'у.

### Особливості та інваріанти

- **Послідовність викликів API:** немає паралелізму між мутантами. Це навмисно — обмеження по rate-limits Anthropic API та для стабільної взаємодії з prompt cache.
- **Prompt cache reuse:** оскільки системний промпт ідентичний для всіх мутантів і помічений `cache_control: ephemeral`, Anthropic API повторно використовує кешований префікс — суттєва економія input-токенів на великих прогонах.
- **Ідемпотентність:** повторний запуск з тим же `cachePath` і незмінним `survived` дає той же `verdicts` без додаткових мережевих викликів (повний cache hit).
- **Conservative fallback:** при фейлі класифікації мутант **не** відкидається — він отримує `worth-testing/confidence=0`, що змушує caller свідомо вирішувати, чи приймати такий вердикт. Це усуває ризик «непомітної втрати» мутанта через мережеву помилку.
- **Defensive copy fallback:** повертається `{ ...FALLBACK_VERDICT }`, а не сам об'єкт — щоб caller'и не могли випадково замутувати константу.

### Тестування

Для unit-тестів зручно ін'єктувати:

- `opts.client = { messages: { create: async () => ({ content: [{ text: '...' }] }) } }` — підставний клієнт.
- `opts.cachePath = '/tmp/test-cache.json'` — ізольований кеш.
- `opts.retryDelayMs = 0` — миттєві retries без `setTimeout`-блокувань.

Файл `index.mjs` спроєктований так, що жодних інших залежностей мокати **не потрібно** — `cache.mjs`/`prompt.mjs`/`verdict-schema.mjs` мають детерміновану поведінку для тестів.
