# Захоплення LLM wire-trace (reasoning + сліди) — дизайн-спека

Дата: 2026-06-10
Власник: @vitaliytv
Статус: Approved (2026-06-10)

## Мета

Фіксувати на **єдиній точці LLM-викликів** (`callLlm`, `npm/lib/llm.mjs`) обидва канали даних для обох бекендів (локальний omlx + хмарний pi):

- **reasoning** — текст думок моделі (thinking-моделі через прямий omlx),
- **спостережуваний слід** — request/response/usage/latency/retry/помилки,

у **проєктно-локальний** append-лог, щоб згодом (окрема, аналітична спека) дистилювати з нього висновки про покращення проєкту й **коммітити їх у git назавжди**.

Ключова теза: це **два окремі канали**. Слід існує незалежно від thinking; reasoning — опціональний канал, повний лише на прямому omlx-HTTP (pi конкатенує ролі в plain-text і reasoning не віддає — асиметрія fidelity очікувана й допустима).

## Передісторія (фактичний стан коду)

Частину інфраструктури вже зроблено в попередніх інкрементах:

- **`npm/lib/llm.mjs`** (ADR 260610-2228) — **єдина точка** `callLlm(messages, model, opts)` над обома бекендами; маршрут за префіксом `omlx/` (→ `callOmlx`) vs решта (→ `callPi`). Це обраний у дискусії варіант C.
- **Мінімальний wire-trace вже є** в `callLlm` (ADR 260610-1516/1524): opt-in через `N_CURSOR_LLM_TRACE=<file>`, append JSONL, fail-safe. Поля бідні: `{ts, backend, model, ms, promptChars, outChars, ok, error}`.
- **Auth до omlx працює** в клієнті: `callOmlx` шле `Authorization: Bearer` через `resolveOmlxApiKey` (opts → `N_CURSOR_OMLX_KEY` → `~/.omlx/settings.json`).

Дві структурні дірки, які закриває ця спека:

1. **`callOmlx` викидає найцінніше.** Повертає лише `choices[0].message.content` (рядок 144); `usage`, `reasoning_content`, `finish_reason` парсяться поряд і губляться.
2. **Не всі виклики йдуть через `callLlm`.** `fix/llm-worker.mjs:99` і `coverage-classify/index.mjs:39` кличуть `callOmlx` **напряму**, минаючи `callLlm` → не трасуються (blind spot уже в локалі).

### Жива перевірка (2026-06-10)

Прямий виклик до `http://127.0.0.1:8000/v1/chat/completions`, модель `Qwen3-4B-Thinking-2507-4bit`:

- **reasoning приходить полем** `message.reasoning_content` (НЕ `<think>`-теги; на завершеній думці `content` чистий: `391`). `message` keys: `['role','content','reasoning_content']`.
- `usage` багатий: `prompt_tokens, completion_tokens, total_tokens, prompt_tokens_details.cached_tokens, model_load_duration, total_time`.
- **Edge-case:** при `finish_reason: "length"` (зріз `max_tokens`) thinking **витікає в `content` без `<think>`-тега**, а `reasoning_content` лишається порожнім.

## Scope

**In:**

- **Replace** наявного мінімального trace у `callLlm` на багатий always-on (рішення A=replace).
- **Surface** `reasoning_content` + `usage` + `finish_reason` з `callOmlx` через багатший internal-return; публічний `callOmlx` лишається `string` (рішення B).
- Багатий нормалізований JSONL-запис на кожен виклик (обидва канали; pi-поля null де backend не дає).
- Always-on у `<cwd>/.n-cursor/llm-trace.jsonl` (gitignored, **raw-шар**), `N_CURSOR_LLM_TRACE` лишається override-шляхом, `N_CURSOR_LLM_TRACE=0` — kill-switch.
- **Недеструктивна** ротація за розміром.
- **Міграція** `fix/llm-worker` і `coverage-classify` з прямого `callOmlx` на `callLlm` (рішення C).
- `.gitignore` → `.n-cursor/`.

**Out (окремі спеки / задачі):**

- Детектор сигналів + LLM-аналіз «що покращити» + запис агрегату в `docs/omlx-insights/` — **друга, аналітична спека**.

### Двошарова модель даних (raw → aggregate)

| Шар | Що | Доля |
|---|---|---|
| **Raw** `<cwd>/.n-cursor/llm-trace.jsonl` (+ архіви) | потік wire-записів: код, reasoning, великий, шумний | **gitignored**, локальний; лежить, доки батч-агрегація не спожиє |
| **Aggregate** | дистильовані висновки | **коммітиться в git** (`docs/omlx-insights/`), назавжди — історія + code-review |

«Назавжди» — про **агрегат**, не про сирий потік. Тому raw-ротація **недеструктивна**: дані доживають до агрегації.

## Рішення 1: replace trace у `callLlm`

Наявні `trace()` + бідна схема в `npm/lib/llm.mjs` **видаляються** й замінюються викликом нового модуля `omlx-trace`. `callLlm` навколо обох бекендів:

1. стартує таймер, рахує внесок (caller/model/backend);
2. для omlx-гілки бере **багатий результат** (content+reasoning+usage+finish+attempts), для pi-гілки — лише content;
3. формує запис і append-ить його завжди (kill-switch `N_CURSOR_LLM_TRACE=0`);
4. помилку запису ковтає (trace ніколи не валить виклик).

## Рішення 2: багатший internal-return з `callOmlx`

`omlx.mjs` отримує **ядро** `callOmlxRaw(messages, model, opts) → { content, reasoning, reasoningSource, finishReason, usage, attempts }` (увесь curl/retry-цикл там). Публічний `callOmlx` стає тонкою обгорткою `callOmlxRaw(...).content` — **контракт `string` незмінний** для будь-яких прямих споживачів. `callLlm` (omlx-гілка) кличе `callOmlxRaw` і дістає всі поля для запису.

`reasoning` всередині `callOmlxRaw`:
- спершу `message.reasoning_content` → `reasoningSource: "field"`;
- якщо порожнє — regex `<think>(.*?)</think>` з `content` → `"think_tag"`;
- якщо порожнє і `finish_reason == "length"` → `"truncated"` (думку зрізав `max_tokens`, сирий reasoning у `content`);
- інакше `null`.

## Рішення 3: схема запису (rich)

Один JSONL-рядок на виклик:

```jsonc
{
  "ts": "2026-06-10T...",        // ISO, момент завершення
  "caller": "doc-files|fix|coverage|unknown",  // opts.caller ?? env.N_CURSOR_TRACE_CALLER ?? 'unknown'
  "backend": "omlx|pi",
  "model": "omlx/Qwen3-4B-Thinking-2507-4bit",
  "temperature": 0.2,
  "max_tokens": 4096,            // null для pi

  "messages": [ { "role": "system", "content": "…(cap 8000 симв.)…" } ],
  "messages_sha256": "…",        // hash повного (необрізаного) масиву
  "messages_truncated": false,

  "content": "391",
  "reasoning": "Okay, the user…", // null якщо нема
  "reasoning_source": "field|think_tag|truncated|null",
  "finish_reason": "stop",       // null для pi
  "usage": { "...": "verbatim" }, // null для pi

  "ms": 12740,
  "attempts": 1,                 // retry-цикл omlx; 1 для pi
  "ok": true,
  "error": null
}
```

Правила: `messages.content` cap 8000 симв.; `messages_sha256` з повного масиву; `usage` verbatim; на помилці `ok:false`, решта rich-полів null.

## Рішення 4: куди писати + недеструктивна ротація

- Дефолт-шлях: **`<process.cwd()>/.n-cursor/llm-trace.jsonl`** — корінь споживацького проєкту (там же, де `docs/omlx-insights/`), а не корінь пакета `@nitra/cursor`. Override — `N_CURSOR_LLM_TRACE=<file>`.
- `.n-cursor/` у `.gitignore`.
- **Недеструктивна ротація**: якщо активний файл > **50 MB**, перейменувати в `llm-trace.<seq>.jsonl` (наступний вільний `<seq>`, без перезапису архівів), почати новий. Прибирання архівів — відповідальність агрегатора (друга спека).

## Рішення 5: always-on + kill-switch

Логування ввімкнене **завжди**. `N_CURSOR_LLM_TRACE=0` (або `false`) — аварійний вимикач. Будь-яке інше значення трактується як override-шлях.

## Рішення 6: міграція callerів на `callLlm`

`fix/llm-worker.mjs` і `coverage-classify/index.mjs` зараз мають власну гілку `isOmlxModel(model) ? callOmlx(...) : spawnSync('pi', ...)`. Замінюємо цю гілку на єдиний `callLlm(messages, model, opts)`, передаючи `opts.caller`. Прибираємо їхні дубльовані pi-spawn-и. Так увесь трафік обох скілів іде через трасовану точку.

## Deliverable

1. **`npm/lib/omlx-trace.mjs`** (новий): `buildTraceRecord({...})`, `writeTrace(record)`, `rotateIfNeeded(file)`, `capMessages(messages)`, `tracePath()` (cwd-based + override + kill-switch). Чиста, тестована логіка.
2. **`npm/lib/omlx.mjs`**: винести ядро в `callOmlxRaw` (повертає rich-обʼєкт + `attempts` + `reasoning*`); `callOmlx` = обгортка `.content`.
3. **`npm/lib/llm.mjs`**: видалити стару `trace()`/схему; omlx-гілка через `callOmlxRaw`; rich always-on запис; `callLlm` приймає `opts.caller`.
4. **`npm/skills/fix/js/llm-worker.mjs`** і **`npm/scripts/coverage-classify/index.mjs`**: мігрувати на `callLlm`, прибрати власні pi-spawn-и.
5. **`.gitignore`**: `.n-cursor/`.
6. **Тести**: `npm/lib/tests/omlx-trace.test.mjs` (cap+hash, обидві+truncated форми reasoning, схема на ok/error, недеструктивна ротація, kill-switch, cwd-шлях). Оновити наявні тести `llm`/`omlx` під новий контракт (`callOmlxRaw`).
7. **CHANGELOG** через `.changes/`.

## Вирішені рішення

- **A — replace** (не enrich): стара мінімальна схема trace видаляється.
- **B** — багатший internal-return; публічний `callOmlx` лишається `string`.
- **C** — мігрувати `fix`+`coverage` на `callLlm`.
- **D** — server-side `skip_api_key_verification` повернуто в `false`; auth тримає клієнт (`resolveOmlxApiKey`). Перевірено: без ключа сервер відмовляє, з ключем — віддає.
- **Місце агрегату — git, `docs/omlx-insights/`** (власник логіки агрегації — друга спека).

## Ризики / нотатки

- **Чутливість логу.** `messages` містять вихідний код. Лог проєктно-локальний і gitignored; cap 8k + ротація обмежують обсяг. Редакція — за потреби в другій спеці.
- **pi-fidelity.** reasoning/usage/finish_reason для pi = null за побудовою (pi їх не віддає). Це очікувано, не баг.

## Відкриті питання

- Чи протягувати `caller` у `coverage-fix.mjs` (теж має власний pi-spawn, рядок 52) — поза цим scope, бо не використовує omlx-гілку; винести в окрему дрібну задачу.
- Пороги 50 MB / cap 8k — стартові, уточнити після перших днів накопичення.
