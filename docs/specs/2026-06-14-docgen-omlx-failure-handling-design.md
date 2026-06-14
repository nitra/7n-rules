# Опрацювання omlx-збоїв у docgen-оркестраторі — дизайн-спека

Дата: 2026-06-14
Власник: @vitaliytv
Статус: Approved (2026-06-14)

## Мета

Зробити масовий прогін файлової документації (`doc-files gen`, сотні файлів) **стійким до omlx-збоїв**: відрізняти transient / systemic / permanent помилки й реагувати на кожен клас по-різному, замість теперішнього «усе → `✗` → continue», який генерує каскади фейкових помилок і марно палить час.

Принцип (рішення власника): **швидше помилятись і рухатись далі, ніж довго чекати** — мінімум ретраїв/пауз, жодних cooldown-циклів.

Корінь проблеми (жива діагностика 2026-06-14): на 57-му з 266 файлів машина впёрлася в `memory ceiling`, і **решта ~200 файлів згоріли однаково** — бо оркестратор не має ні класифікації помилок, ні запобіжника на систему.

## Передісторія (фактичний стан коду)

- **`npm/rules/doc-files/js/docgen-files-batch.mjs`** — оркестратор: `generateOne` (114-139) stateless-виклик на файл; цикл (188-191) послідовний; `catch` (134-137) трактує **будь-яку** помилку однаково. Preflight (`preflightProblem`, 66-80) — **лише на старті**.
- **`npm/lib/omlx.mjs`** — `callOmlxRaw` (105-170): ретраїть лише curl-коди `{18,52,56}` **без паузи**; spawnSync-таймаут (`r.error`, ETIMEDOUT) → `break` **без ретраю**. `DEFAULT_OMLX_MODEL` (49) = `mlx-community--gemma-4-e2b-it-4bit` — **указує на видалену модель**.
- **`npm/lib/llm.mjs`** — `omlxHealthCheck` (137-150) вже мапить `error.message` → причини (зародок класифікатора).
- **`npm/rules/doc-files/js/docgen-scan.mjs`** — `scanForDocFiles` (87-115): fs-walk + `isDocgenIgnored` (хардкод-глоби в `docgen-ignore.mjs`); **`.gitignore` НЕ враховує**.
- **Модель**: `DEFAULT_LOCAL_MODEL` (`docgen-gen.mjs:372`) = `N_CURSOR_DOCGEN_MODEL ?? (resolveModel('min') || omlx/${DEFAULT_OMLX_MODEL})`; `resolveModel('min')` → `N_LOCAL_MIN_MODEL` (уже primary).

### Жива діагностика (2026-06-14)

| Симптом | Клас | Природа |
|---|---|---|
| `curl error: spawnSync curl ETIMEDOUT`, `curl exit 18/52/56` | **transient** | сервер живий, але повільний/зайнятий |
| `Cannot load gemma… memory ceiling`, сервер не відповідає | **systemic** | хост/сервер впёрся в RAM-стелю → каскад |
| `Prompt too long: 9177917 tokens exceeds max context window` | **permanent** | `run/auth/src/lib/lib/euscp.js` — мініфікований vendored-лоб 9.17M токенів |

### Зроблено в рамках цієї роботи

- **`~/.omlx/settings.json` → `model.model_fallback: true`** (рестарт, перевірено: запит до неіснуючої моделі повертає відповідь наявної, не 404). Каскад через «модель не та/відсутня» усунено на рівні сервера.
- Застереження: при fallback відповідь у полі `model` **ехоїть запитаний id**, не фактичний → точність trace тримає канонічний model-id (рішення 4).

## Scope

**In:** класифікатор; ETIMEDOUT+backoff у `callOmlxRaw`; circuit breaker у батчі; permanent→skip; stdout-діагностика розмірів; scan поважає `.gitignore`; прибрати хардкод `DEFAULT_OMLX_MODEL` (fail-loud); тести.

**Out:** size-guard як гейт (не потрібен — лише діагностика); preflight unload/load (одна модель); кастомні minified/vendored глоби (тільки `.gitignore`); пороги в env (усе хардкод).

## Рішення 1: класифікатор помилок (D6 → `llm.mjs`)

Мала чиста функція `classifyOmlxError(message) → 'transient'|'systemic'|'permanent'` **у `llm.mjs`** (поряд із `omlxHealthCheck`, що рефакториться поверх неї — складність низька, окремий модуль зайвий). Класифікація **пост-ретрайна** (після того, як `callOmlxRaw` вичерпав внутрішні спроби):

- `permanent` ← `too long` / `exceeds … context` / `not found` — детерміновано, ретрай не поможе;
- `systemic` ← `memory ceiling`, `authentication_error`, `omlx curl …` (down), `ETIMEDOUT` — каскадить на всі файли;
- `transient` ← решта (`empty content`, `bad json`) — рідкісне, не каскадить.

## Рішення 2: transient → ретрай+backoff усередині `callOmlxRaw` (D2: хардкод)

Ретрай лишається **у `callOmlxRaw`** (там уже цикл) — без другого шару в оркестраторі:
- `r.error` із кодом `ETIMEDOUT` → переходить із `break` у retryable-гілку (як curl-коди);
- backoff **між** спробами (зараз нема): **2s → 8s**, хардкод, sync-sleep (`Atomics.wait`); 3 спроби = 2 паузи.

## Рішення 3: systemic → circuit breaker, fail-fast (D1: без cooldown)

Лічильник **підряд**-systemic у циклі. `streak ≥ 3` → **негайний abort** батчу (без cooldown/recheck — рухаємось далі швидше) з actionable-меседжем («omlx memory-guard посеред прогону; звільни RAM і повтори — зроблено N/total») і **окремим exit-кодом 2** (відрізнити «середовище впало» від «N файлів з помилками»). Будь-який не-systemic результат → `streak = 0`. Resume через CRC (невдалі не пишуться → лишаються stale).

## Рішення 4: permanent → skip + stdout-діагностика + `.gitignore` + канон-id

- **Без size-guard-гейта** (D3): великий файл просто впаде на `permanent` і піде у skip. Натомість — **stdout-діагностика розміру** (байти + груба оцінка токенів) у прогрес-рядку кожного файлу, для дослідження, що саме роздуває контекст.
- **Окремий `skipped[]`** (не `errors[]`): permanent-skip не впливає на exit «1 = були помилки».
- **Scan поважає `.gitignore`** (D4): у `scanForDocFiles` — батч-фільтр `git check-ignore --stdin` поверх наявних `DOCGEN_IGNORE_GLOBS` (graceful, якщо не git-репо). Кастомних minified/vendored глобів не додаємо. `euscp.js` не в `.gitignore` → лишається кандидатом, впаде на permanent + діагностику (свідомо).
- **Канон-id**: оркестратор шле resolved `DEFAULT_LOCAL_MODEL`, не голий `omlx/`, щоб trace при fallback фіксував реальну модель.

## Рішення 5: прибрати хардкод `DEFAULT_OMLX_MODEL` + fail-loud (D5)

- `omlx.mjs`: прибрати baked-константу; `fallbackModel = env.N_CURSOR_OMLX_MODEL ?? ''`; у `callOmlxRaw` за порожньої моделі — `throw` із меседжем «постав N_LOCAL_MIN_MODEL (або N_CURSOR_OMLX_MODEL)».
- `docgen-gen.mjs`: `DEFAULT_LOCAL_MODEL = N_CURSOR_DOCGEN_MODEL ?? resolveModel('min')` (без omlx-fallback).
- `docgen-files-batch.mjs`: preflight fail-loud, якщо `DEFAULT_LOCAL_MODEL` порожній.
- Кожен налаштовує модель локально через `N_LOCAL_MIN_MODEL`.

## Deliverable

1. `npm/lib/omlx.mjs`: ETIMEDOUT→retry + backoff; прибрати `DEFAULT_OMLX_MODEL` + fail-loud.
2. `npm/lib/llm.mjs`: `classifyOmlxError`; `omlxHealthCheck` поверх нього.
3. `npm/rules/doc-files/js/docgen-files-batch.mjs`: circuit breaker (streak→abort, exit 2); `skipped[]`; класифікація в `catch`; fail-loud preflight; канон-id.
4. `npm/rules/doc-files/js/docgen-gen.mjs`: `DEFAULT_LOCAL_MODEL` без omlx-fallback; stdout-діагностика розміру.
5. `npm/rules/doc-files/js/docgen-scan.mjs`: `.gitignore` через `git check-ignore`.
6. Тести: класифікатор, circuit breaker, ETIMEDOUT-ретрай, gitignore-scan; оновити `omlx.test.mjs` під прибраний хардкод.
7. CHANGELOG через `.changes/`.

## Ризики / нотатки

- `model_fallback: true` маскує misconfig — точність моделі тримає лише канон-id + trace.
- Circuit breaker K=3 підряд — поодинокий стрибок RAM не abortить; стійка стеля — abort.
- ETIMEDOUT класифіковано як systemic: після внутрішніх ретраїв стійкий таймаут = перевантажений сервер; K=3-підряд захищає від хибного abort на разовому.

## Вирішені рішення

- **D1** K=3 підряд-systemic → негайний abort (без cooldown), exit 2.
- **D2** ретрай у `callOmlxRaw`, хардкод backoff 2s→8s, +ETIMEDOUT.
- **D3** size-guard не робимо; лише stdout-діагностика розміру.
- **D4** scan поважає `.gitignore` (git check-ignore), без кастомних глобів.
- **D5** прибрати хардкод `DEFAULT_OMLX_MODEL`, fail-loud.
- **D6** класифікатор у `llm.mjs`; пороги хардкод (не env).
- **model_fallback: true** застосовано; preflight unload/load — out of scope.
