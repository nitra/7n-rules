# Fix verbose LLM-block у `--full` режимі — дизайн-спека

Дата: 2026-06-24
Власник: @vitaliytv
Статус: Draft

## Мотивація

Під час `npx @nitra/cursor lint --full` fix-конвеєр викликає LLM per-rung і показує лише
підсумкову стрічку (`⚡ local-min (omlx/...): rule ❌ error`). Ані запит до моделі, ані її
thinking-монолог не видно. Це ускладнює налаштування промптів і діагностику невдалих рунгів.

Мета — після кожного рунга друкувати **окремий verbose-блок** із стислим описом промпту та
повним thinking-текстом (якщо модель його згенерувала).

## Тригер

`npx @nitra/cursor lint --full` — **завжди**, без додаткового прапорця.
Delta-режим (`lint` без `--full`) — **без блоку** (LLM не викликається в delta-шляху).

## Thinking у Gemma 4

Gemma 4 E2B/E4B (вийшла квітень 2026) підтримує thinking через параметр `thinking_budget`
в OpenAI-сумісному API omlx. При `thinking_budget > 0` відповідь містить поле
`reasoning_content` із внутрішнім монологом (до 4000+ токенів). Поточна `extractReasoning()`
у `npm/lib/omlx.mjs` вже читає це поле як `reasoningSource: 'field'` — зміни в парсері не потрібні.

Зараз `callOmlxRaw` **не передає** `thinking_budget` у тіло запиту — потрібно додати.

## Формат виводу

Блок друкується **після рядка рунга** (outcome вже відомий):

```
⚡ local-min (omlx/gemma-4-e4b-it-OptiQ-4bit): js ❌ parse error

  prompt:
    rule:      n-js.mdc (1 204 chars)
    violation: 87 chars
    files:     3 файли (4.2 KB)
    feedback:  (none)

  thinking [field, 312 chars]:
    Розглянемо порушення: правило вимагає що JS-файл...
    (перші 500 chars, далі … якщо довший)
```

Успішний рунг з feedback:

```
✅ local-min-retry (omlx/gemma-4-e4b-it-OptiQ-4bit): js

  prompt:
    rule:      n-js.mdc (1 204 chars)
    violation: 102 chars
    files:     3 файли (4.2 KB)
    feedback:  model=omlx/gemma-4-e4b-it-OptiQ-4bit, 2 changes, error="parse error"

  thinking [field, 890 chars]:
    Попередня спроба змінила файл але...
    (перші 500 chars)
```

Pi-бекенд (cloud model — pi не повертає reasoning):

```
✅ cloud-min (anthropic/claude-haiku-4-5): js

  prompt:
    rule:      n-js.mdc (1 204 chars)
    violation: 87 chars
    files:     3 файли (4.2 KB)
    feedback:  (none)

  thinking: (none)
```

### Поля prompt-блоку

| Поле        | Значення                                           |
| ----------- | -------------------------------------------------- |
| `rule`      | `n-{id}.mdc ({N} chars)` — довжина `.mdc`-вмісту   |
| `violation` | `{N} chars` — довжина violation output             |
| `files`     | `{K} файл(ів) ({total} KB)` або `(none)` якщо нема |
| `feedback`  | `(none)` або `model=…, {K} changes, error="…"`     |

Файли показуються **тільки кількісно** — вміст не дублюється у stdout.

### Thinking-блок

| Стан                              | Вивід                                      |
| --------------------------------- | ------------------------------------------ |
| `reasoning === null`              | `thinking: (none)`                         |
| `reasoningSource === 'field'`     | `thinking [field, {N} chars]:` + текст     |
| `reasoningSource === 'think_tag'` | `thinking [think_tag, {N} chars]:` + текст |
| `reasoningSource === 'truncated'` | `thinking [truncated, {N} chars]:` + текст |

Текст thinking: перші **500 chars**, далі ` … (+{M} chars)` якщо `reasoning.length > 500`.

## Зміни по шарах

### 1. `npm/lib/omlx.mjs` — `callOmlxRaw`

Додати `thinkingBudget?: number` до opts. При `thinkingBudget > 0` — включати у тіло запиту:

```js
const body = JSON.stringify({
  model: m,
  messages,
  max_tokens: maxTokens,
  temperature,
  ...(thinkingBudget ? { thinking_budget: thinkingBudget } : {})
})
```

Дефолт: `0` (thinking вимкнено, backward-compatible).

### 2. `npm/lib/llm.mjs` — `callLlm`

**Зміна контракту**: повертає `{ content, reasoning, reasoningSource }` замість `string`.

```js
// до:
export function callLlm(messages, model, opts = {}) { ... return content }

// після:
export function callLlm(messages, model, opts = {}) {
  // ... opts тепер приймає thinkingBudget
  return { content, reasoning, reasoningSource }
}
```

Нові opts: `thinkingBudget?: number` — проксується в `callOmlxRaw`.

**Оновлення споживачів** — усі місця де `callLlm(...)` використовується як рядок напряму:

- `fix/llm-worker.mjs` — `callModel()` — оновити (нижче)
- `npm/rules/doc-files/js/docgen-files-batch.mjs` — деструктурувати `.content`
- `npm/rules/text/js/cspell-fix.mjs` — деструктурувати `.content`
- інші — grep `callLlm(` і перевірити

Wire-trace (`buildTraceRecord`) вже отримує `reasoning`/`reasoningSource` з `raw` — не міняється.

### 3. `fix/llm-worker.mjs` — `callModel` і `runLlmWorker`

`callModel` повертає `{ text, reasoning, reasoningSource, error }`:

```js
function callModel(prompt, model, caller, timeoutMs, thinkingBudget) {
  try {
    const { content, reasoning, reasoningSource } = callLlm(
      [{ role: 'user', content: prompt }],
      model,
      { timeoutMs, caller, thinkingBudget }
    )
    return { text: content, reasoning, reasoningSource }
  } catch (error) { ... }
}
```

`runLlmWorker` повертає `{ ..., reasoning, reasoningSource, promptSummary }`:

```js
// promptSummary формується до виклику моделі
const promptSummary = {
  ruleMdcLen: ruleMdc.length,
  violationLen: violationOutput.length,
  filesCount: files.length,
  filesTotalBytes: files.reduce((s, f) => s + f.content.length, 0),
  hasFeedback: !!feedback,
  feedbackModel: feedback?.previousModel ?? null,
  feedbackChangesCount: feedback?.previousChanges?.length ?? 0,
  feedbackError: feedback?.previousError ?? null
}
```

`thinkingBudget` береться з `opts.thinkingBudget` (оркестратор передає per-tier) або з
`env.N_CURSOR_OMLX_THINKING_BUDGET` (дефолт `4096` для omlx-моделей, `0` для pi).

### 4. `fix/orchestrator.mjs` — `escalateRule`

Після кожного рунга (після re-check, до наступного рунга) — викликати `printVerboseBlock`:

```js
// після runLlmWorker() і recheckOk-логіки:
if (process.env.N_CURSOR_FIX_VERBOSE !== 'off') {
  printVerboseBlock(workerResult, rung)
}
```

`printVerboseBlock(result, rung)` — нова функція в orchestrator або окремий модуль
`fix/verbose-block.mjs`:

```
  prompt:
    rule:      n-{ruleId}.mdc ({N} chars)
    violation: {N} chars
    files:     {K} файл(ів) ({total} KB)   ← або "(none)"
    feedback:  (none)   ← або "model=…, K changes, error="…""

  thinking [{source}, {N} chars]:
    {перші 500 chars}
    … (+{M} chars)
```

### Env vars

| Змінна                          | Дефолт        | Призначення                                     |
| ------------------------------- | ------------- | ----------------------------------------------- |
| `N_CURSOR_OMLX_THINKING_BUDGET` | `4096`        | tokens бюджет thinking для omlx; `0` вимикає    |
| `N_CURSOR_FIX_VERBOSE`          | _(не задана)_ | `off` — вимкнути verbose-блок навіть у `--full` |

`thinkingBudget` не передається в pi-бекенд (ігнорується якщо модель не `omlx/…`).

## Що НЕ змінюється

- `extractReasoning()` — вже готова, не чіпаємо
- Wire-trace JSONL — вже пише `reasoning`/`reasoningSource`, не чіпаємо
- T0-auto рунг — verbose-блоку немає (немає LLM)
- Формат рядка рунга (`⚡`/`✅`) — не змінюється, блок після нього

## Порядок реалізації

1. `callOmlxRaw` — додати `thinkingBudget` → перевірити curl-відповідь з `reasoning_content`
2. `callLlm` — змінити return type → оновити всіх споживачів (grep + заміна)
3. `callModel` / `runLlmWorker` — прокинути `reasoning`, додати `promptSummary`
4. `printVerboseBlock` — реалізувати окремим модулем `fix/verbose-block.mjs`
5. `escalateRule` — вставити виклик після кожного рунга
6. Тести: `llm-worker` — мок `callLlm` на новий контракт; `verbose-block` — snapshot-тест виводу

## Відкриті питання

- Чи друкувати verbose-блок також для T0-auto (показати що саме зпатчив T0)? Наразі — ні.
- Чи cap thinking-монолог до 500 chars достатній, або потрібен окремий прапорець `--full-thinking`?
