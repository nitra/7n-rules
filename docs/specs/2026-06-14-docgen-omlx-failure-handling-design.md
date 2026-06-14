# Опрацювання omlx-збоїв у docgen-оркестраторі — дизайн-спека

Дата: 2026-06-14
Власник: @vitaliytv
Статус: Draft (чекає рішень за «Відкриті питання»)

## Мета

Зробити масовий прогін файлової документації (`doc-files gen`, сотні файлів) **стійким до omlx-збоїв**: відрізняти transient / systemic / permanent помилки й реагувати на кожен клас по-різному, замість теперішнього «усе → `✗` → continue», який генерує каскади фейкових помилок і марно палить час.

Корінь проблеми (жива діагностика 2026-06-14): на 57-му з 266 файлів машина впёрлася в `memory ceiling`, і **решта ~200 файлів згоріли однаково** — бо оркестратор не має ні класифікації помилок, ні запобіжника на систему.

## Передісторія (фактичний стан коду)

- **`npm/rules/doc-files/js/docgen-files-batch.mjs`** — оркестратор: `generateOne` (рядки 114-139) на кожен файл будує свіжий stateless-виклик; головний цикл (188-191) послідовний. `catch` (134-137) трактує **будь-яку** помилку однаково: `stats.err++`, `errors.push`, друк `✗`, далі. Preflight (`preflightProblem`, 66-80) є **лише на старті** — деградація пам'яті **посеред** прогону не помічається.
- **`npm/lib/omlx.mjs`** — `callOmlxRaw` (105-170): ретраїть лише curl-коди `{18,52,56}` і **без паузи** (`continue`, рядок 151). spawnSync-таймаут (`r.error`, ETIMEDOUT) → `break` **без ретраю** (144-147). API-помилки (`memory ceiling`, `Prompt too long`) → throw одразу (161).
- **`npm/lib/llm.mjs`** — `omlxHealthCheck` (137-150) вже мапить `error.message` → причини (`memory-guard` / `auth` / `down` / `error`). Це **зародок класифікатора**, який треба узагальнити й перевикористати.
- **Модель**: `DEFAULT_LOCAL_MODEL` (`docgen-gen.mjs:372`) = `N_CURSOR_DOCGEN_MODEL ?? (resolveModel('min') || omlx/${DEFAULT_OMLX_MODEL})`; `resolveModel('min')` → `N_LOCAL_MIN_MODEL`. Тобто `N_LOCAL_MIN_MODEL` **уже primary**. `DEFAULT_OMLX_MODEL` (`omlx.mjs:49`) = `mlx-community--gemma-4-e2b-it-4bit` — **указує на видалену модель** (остання-резервна соломинка → фантом у headless-шелі без env).

### Жива діагностика (2026-06-14)

Три **різні** класи збоїв у логах одного прогону:

| Симптом | Клас | Природа |
|---|---|---|
| `curl error: spawnSync curl ETIMEDOUT`, `curl exit 18/52/56` | **transient** | сервер живий, але повільний/зайнятий |
| `Cannot load gemma… memory ceiling`, сервер не відповідає | **systemic** | хост/сервер впёрся в RAM-стелю посеред прогону → каскад |
| `Prompt too long: 9177917 tokens exceeds max context window` | **permanent** | детерміновано: `run/auth/src/lib/lib/euscp.js` — мініфікований vendored-лоб на 9.17M токенів |

Корінь systemic-каскаду в той день: дві gemma конкурували за стелю 12.7 GB (`e4b-OptiQ` 7.86 GB резидентна + `e2b` 3.76 GB, якого хотів батч). Зараз залишено **одну** модель `gemma-4-e4b-it-OptiQ-4bit`.

### Зроблено в рамках цієї роботи

- **`~/.omlx/settings.json` → `model.model_fallback: true`** (рестарт виконано, перевірено: запит до неіснуючої моделі повертає відповідь наявної, а не 404). **Каскад через «модель не та / відсутня» більше неможливий.**
- Застереження: при fallback відповідь у полі `model` **ехоїть запитаний id**, не фактичний → для wire-trace це розбіжність. Звідси — рішення 4 (канонічний model-id).

## Scope

**In:**
- Класифікатор `classifyOmlxError(message) → 'transient' | 'systemic' | 'permanent'` (узагальнення `omlxHealthCheck`).
- transient: ETIMEDOUT → ретрай-гілка в `callOmlxRaw`; ретрай із backoff на рівні оркестратора.
- systemic: circuit breaker у батч-циклі (streak підряд → cooldown+recheck → abort з actionable-меседжем і окремим exit-кодом).
- permanent: pre-send size/token-guard + scan-exclude мініфікованих/vendored файлів; окремий лічильник `skipped[]` (не `errors[]`).
- Модель: полагодити stale `DEFAULT_OMLX_MODEL`; канонічний resolved model-id у виклику (для коректного trace при fallback).
- Тести на класифікатор, circuit breaker, size-guard, scan-exclude.

**Out:**
- Preflight «unload competitors / load target» через `/v1/models/*` — **знято**: одна модель + `model_fallback: true` роблять це непотрібним (повернути в окрему задачу, якщо знову буде кілька моделей).
- Зміна самих порогів `memory_guard_*` у omlx — конфіг сервера, поза кодом пакета.

## Рішення 1: класифікатор помилок

Один чистий предикат (де — див. Відкрите D6), що мапить `error.message`:

- `transient` ← `omlx curl error: …ETIMEDOUT`, `curl exit 18/52/56`, `omlx empty content`, `bad json`;
- `systemic` ← `memory ceiling` / `memory-guard`, сервер `down` (curl exit 7 / connection refused), `authentication_error`;
- `permanent` ← `Prompt too long … exceeds … context window`, `Model … not found` (теоретично; при fallback не виникне), інші детерміновані 4xx-семантики.

`omlxHealthCheck` рефакториться поверх цього ж предиката (єдине джерело правди класифікації).

## Рішення 2: transient → ретрай із backoff

- `callOmlxRaw`: гілку `r.error` (spawnSync timeout/ETIMEDOUT) перевести з `break` на **retryable** (як curl-коди {18,52,56}).
- Ретрай із **паузою** (зараз `continue` миттєвий): backoff на рівні оркестратора (async-`await`, бо `generateOne` async; у sync-`callOmlxRaw` блокуючий sleep небажаний). `generateOne` обгортає виклик у N спроб із зростаючою затримкою.
- Параметри (кількість спроб, backoff) — Відкрите D2.

## Рішення 3: systemic → circuit breaker (а не каскад)

У `stats` — лічильник **підряд**-systemic-фейлів. У головному циклі:

1. файл упав із `systemic` → `streak++`;
2. `streak ≥ K` → **cooldown**: пауза + повторний `omlxHealthCheck`;
   - відновилось → `streak = 0`, продовжити;
   - ні → **abort батчу** з actionable-меседжем («omlx memory-guard посеред прогону; звільни RAM і повтори — зроблено N/total») і **окремим exit-кодом** (відрізнити «середовище впало» від «N файлів з помилками»);
3. будь-який не-systemic результат (успіх / transient-fail після ретраїв / permanent-skip) → `streak = 0`.

Resume безкоштовний: невдалі файли **не пишуться** → лишаються `stale` → наступний прогін підбирає їх через CRC. (Параметри K, cooldown — Відкрите D1.)

## Рішення 4: permanent → skip + size-guard + scan-exclude + канонічний model-id

- **Pre-send guard**: до виклику оцінити розмір промпта; якщо вище порогу (відносно `max_context_window` моделі, напр. 131072 для e4b) — **не слати**, позначити `permanent`/skip. (Метрика й поріг — Відкрите D3.)
- **Scan-exclude**: мініфіковані/vendored файли виключити ще в `scanForDocFiles` (їм машинна дока не потрібна): напр. `**/lib/lib/**`, `**/*.min.js`, + евристика «середня довжина рядка > N». (Глоби — Відкрите D4.)
- **Окремий лічильник `skipped[]`** у звіті (не `errors[]`): permanent-skip — не «помилка для перегону», тому не впливає на exit-код «1 = були помилки».
- **Канонічний model-id**: оркестратор завжди шле resolved id (`DEFAULT_LOCAL_MODEL`), не голий `omlx/` — щоб при `model_fallback: true` wire-trace фіксував реальну модель, а не ехо.

## Рішення 5: консолідація конфігу моделі

- Підтвердити `N_LOCAL_MIN_MODEL` як **єдине джерело** (вже primary через `resolveModel('min')`).
- **Полагодити `DEFAULT_OMLX_MODEL`** → `mlx-community--gemma-4-e4b-it-OptiQ-4bit` (наявна модель) **або** прибрати хардкод і фейлити гучно за порожнього `N_LOCAL_MIN_MODEL`. (Вибір — Відкрите D5; зверни увагу: при `model_fallback: true` серверний 404 не настане, тому «fail loud» важить лише для точності trace.)
- `N_CURSOR_DOCGEN_MODEL` / `N_CURSOR_OMLX_MODEL` лишити **задокументованими escape-гачками**, не дефолт-механізмом.

## Deliverable

1. **`npm/lib/omlx.mjs`**: ETIMEDOUT у retryable-гілку; полагоджений `DEFAULT_OMLX_MODEL`.
2. **`npm/lib/llm.mjs`** (або новий `omlx-errors.mjs`): `classifyOmlxError`; `omlxHealthCheck` поверх нього.
3. **`npm/rules/doc-files/js/docgen-files-batch.mjs`**: retry+backoff у `generateOne`; circuit breaker у циклі; `skipped[]` у звіті + exit-коди.
4. **`npm/rules/doc-files/js/docgen-gen.mjs`** / **`docgen-scan.mjs`**: pre-send size-guard; scan-exclude мініфікованих/vendored.
5. **Тести**: класифікатор (усі три класи), circuit breaker (streak→abort, cooldown→resume), size-guard, scan-exclude, ETIMEDOUT-ретрай.
6. **CHANGELOG** через `.changes/`.

## Ризики / нотатки

- **`model_fallback: true` маскує misconfig.** Помилка моделі більше не впаде гучно на сервері; точність «якою моделлю згенеровано» тримає **тільки** канонічний model-id (рішення 4) + wire-trace. Тримати в голові при дебагу.
- **Circuit breaker vs поодинокі systemic.** Занизький K → передчасний abort на разовому стрибку RAM; зависокий → марний прогін. Звідси cooldown+recheck замість миттєвого abort.
- **Size-guard — груба оцінка.** Точний підрахунок токенів — через `/v1/messages/count_tokens`, але це зайвий round-trip; стартуємо з байтової/символьної евристики.

## Вирішені рішення

- **`model_fallback: true`** застосовано й перевірено (каскад через відсутню/іншу модель усунено на рівні сервера).
- **Preflight unload/load — out of scope** (одна модель робить його зайвим).
- **Stateless-per-file лишається** (нічого «забувати» між файлами не треба — підтверджено кодом).

## Відкриті питання (потрібне рішення)

- **D1 — circuit breaker:** K підряд-systemic = ? (старт: 3). Cooldown: одна пауза+recheck перед abort, чи кілька? Тривалість cooldown?
- **D2 — transient retry:** скільки спроб (старт: 2) і backoff-схема (старт: 2s→8s)? Конфігуровно через env чи хардкод-дефолт?
- **D3 — size-guard:** метрика (байти джерела vs оцінка токенів) і поріг (напр. skip якщо est-tokens > 0.5 × `max_context_window`)?
- **D4 — scan-exclude:** які глоби/евристики? (`**/lib/lib/**`, `**/*.min.js`, line-length heuristic — підтвердити список.)
- **D5 — `DEFAULT_OMLX_MODEL`:** оновити на `e4b-OptiQ` **чи** прибрати хардкод + fail-loud?
- **D6 — місце класифікатора:** у `llm.mjs` поряд із `omlxHealthCheck` чи окремий `npm/lib/omlx-errors.mjs`? Чи виносити пороги (K, retries, backoff) в env?
