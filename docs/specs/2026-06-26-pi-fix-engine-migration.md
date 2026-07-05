# Міграція fix-engine `@nitra/cursor` на надбудову над pi — дизайн-спека

Дата: 2026-06-26
Власник: @vitaliytv
Статус: Draft (очікує апруву)
Зачіпає: [`npm/lib/llm.mjs`](../../npm/lib/llm.mjs), [`npm/lib/models.mjs`](../../npm/lib/models.mjs), [`npm/lib/omlx.mjs`](../../npm/lib/omlx.mjs), [`npm/lib/omlx-trace.mjs`](../../npm/lib/omlx-trace.mjs), [`npm/scripts/lib/fix/orchestrator.mjs`](../../npm/scripts/lib/fix/orchestrator.mjs), [`npm/scripts/lib/fix/llm-worker.mjs`](../../npm/scripts/lib/fix/llm-worker.mjs), [`npm/scripts/lib/fix/llm-lint-fix.mjs`](../../npm/scripts/lib/fix/llm-lint-fix.mjs), [`npm/scripts/lib/adr/normalize-pipeline.mjs`](../../npm/scripts/lib/adr/normalize-pipeline.mjs), [`npm/rules/doc-files/js/docgen-gen.mjs`](../../npm/rules/doc-files/js/docgen-gen.mjs), [`npm/rules/text/js/cspell-fix.mjs`](../../npm/rules/text/js/cspell-fix.mjs), [`npm/scripts/lib/rule-meta.mjs`](../../npm/scripts/lib/rule-meta.mjs), `npm/package.json`, `~/.n-cursor/telemetry/` (новий, глобальний), `~/.n-cursor/llm-trace.jsonl` (єдиний global trace)

## Мета

Переписати **LLM-fix-engine** `@nitra/cursor` як **надбудову над екосистемою pi** ([earendil-works/pi](https://github.com/earendil-works/pi)), щоб:

1. **Перестати реалізовувати вже реалізоване** — LLM-dispatch, model-routing, patch-apply, response-parsing, file-read, omlx-HTTP делегуються pi.
2. **Підвищити якість фіксу** — слабкий one-shot «дай JSON-changes» замінюється агентним циклом, де модель сама читає контекст і застосовує патч через вбудовані tools.
3. **Запустити маховик самопокращення** — телеметрія агентних фіксів дистилюється у детерміновані `fix-*.mjs` (T0), щоб із кожним прогоном менше навантажувати локальну модель.

Чиста rule-domain логіка (`.mdc` + `check-*.mjs` + Rego, discovery, hooks, doc-files gate, T0-фіксери) **лишається власною** — pi її не має й не повинен мати.

## Передісторія / проблема

Сьогодні `@nitra/cursor` — **batteries-included CLI**, що володіє всім стеком фіксу самостійно:

- [`npm/lib/llm.mjs`](../../npm/lib/llm.mjs) — маршрутизація `omlx/` → прямий curl, решта → `pi` CLI у деградованому режимі (`-p --no-session --mode text --no-tools`, messages злиті в рядок, **tools вимкнено**).
- [`npm/lib/models.mjs`](../../npm/lib/models.mjs) — ручний model-cascade LOCAL→CLOUD.
- [`npm/lib/omlx.mjs`](../../npm/lib/omlx.mjs) — власний HTTP-клієнт до omlx-сервера.
- [`npm/scripts/lib/fix/llm-worker.mjs`](../../npm/scripts/lib/fix/llm-worker.mjs) — будує промпт, чекає `{changes:[{path,content}]}`, сам застосовує через `applyChanges`, парсить відповідь трьома fallback-форматами, читає файли через `find` по basename.
- [`npm/scripts/lib/fix/orchestrator.mjs`](../../npm/scripts/lib/fix/orchestrator.mjs) — escalation-сходи (local-min → local-retry → cloud-min → cloud-avg) з feedback і avg-cap.

**Парадокс:** `@nitra/cursor` уже громадянин pi-екосистеми (`pi.extensions` + keyword `pi-package` у [`npm/package.json`](../../npm/package.json), [`.pi-template/extensions/n-cursor-adr/index.ts`](../../npm/.pi-template/extensions/n-cursor-adr/index.ts), cloud-dispatch через `pi`), але використовує pi як «тупий completion-endpoint», викинувши всю його цінність (agent loop, tool-calling, мульти-провайдер, patch-apply) — і **реалізувавши це самостійно**.

**Чому pi, а не MiMo-Code:** pi — композована бібліотека (`pi-ai`, `pi-agent-core`, `pi-coding-agent`), MIT, TS/Node — її **вбудовуєш**. MiMo-Code — інтерактивний продукт (термінальний асистент із memory/voice/compose), в нього можна лише вбудуватись як плагін, успадкувавши непотрібну batch-лінтеру машинерію. Для неінтерактивного batch-конвеєра pi дає рівно потрібні примітиви.

## Non-goals

- **Не міняти detection-шлях.** `lint --read-only` (CI) лишається чистим JS-rule-checking. Див. «Тверда межа CI».
- **Не паралелізувати фікси.** Упор на одну локальну модель, їй і так важко; worktree-isolation з `pi-dynamic-workflows` — поза обсягом (референс на майбутнє).
- **Не робити інтерактивну/extension-доставку.** Пріоритет — повна автономність. pi-extension hooks (окрема [prior-art спека](../../npm/.worktrees/main-lint/docs/specs/2026-05-25-pi-extensions-adr-hooks-design.md)) — інший дизайн.
- **Не чіпати `.worktrees/`** (захищені директорії).

## Архітектура

Три **незалежні осі** (сплутати їх — головна пастка):

| Вісь                 | Питання                              | Рішення                                                                    |
| -------------------- | ------------------------------------ | -------------------------------------------------------------------------- |
| **A. Substrate**     | Хто крутить agent-loop одного фіксу? | **SDK-embed** `createAgentSession` (`pi-coding-agent`)                     |
| **B. Orchestration** | Хто керує escalation/re-check?       | **Власний послідовний escalator** (`pi-dynamic-workflows` — лише референс) |
| **C. Delivery**      | Як доходить до користувача?          | **Автономний CLI**, без інтерактиву                                        |

```
┌──────────────────────────────────────────────────────────────┐
│ @nitra/cursor (власне)                                        │
│   rule discovery · .mdc/check-*.mjs/Rego · T0 fix-*.mjs       │
│   orchestrator (ladder · per-tier timeout · escalation-log)  │
│   telemetry capture · distillation flywheel                  │
│                          │ lazy import (лише fix-шлях)        │
│                          ▼                                     │
│   ┌────────────────────────────────────────────────┐          │
│   │ pi (надбудова над)                              │          │
│   │   createAgentSession · agent loop · tool-calling│          │
│   │   built-in read/edit/write/grep · pi-ai routing │          │
│   │   ModelRegistry · AuthStorage (~/.pi/agent)     │          │
│   └────────────────────────────────────────────────┘          │
└──────────────────────────────────────────────────────────────┘
```

## Рішення

### 1. Парадигма фіксу — агентний скрізь

Модель працює **агентно** (local gemma-4-e4b + cloud): pi дає вбудовані `read`/`edit`/`write`/`grep` та власний `ast_facts(path)` tool (§3б), агент сам шукає контекст і **застосовує патч**. **Є hard turn-ceiling** як runaway-backstop (§4+5), але немає м'якого turn-budget'а, який штучно стискає поведінку агента всередині нормального attempt'а; замість цього збираємо телеметрію (див. 7). Constrained one-shot **не лишаємо** навіть локально: спайк довів, що 4B-модель тримає агентний tool-calling.

**Викидаємо повністю:** `applyChanges`, парсери `{changes}`-відповіді, `readFilesForFix` — їх замінює `edit`-tool агента.

**Джерело правила для агента — `npm/rules/{id}/js/*.mdc` + `npm/rules/{id}/policy/*/*.mdc`** (пакетні, не скомпільовані). Скомпільований `.cursor/rules/n-{id}.mdc` — лише для IDE Cursor-інтеграції, не для LLM-agent.

#### 1а. Concern-маркери: детермінована прив'язка check → .mdc

Кожен `js/<concern>.mjs` вже має парний `js/<concern>.mdc` (однойменний, convention). `run-rule.mjs` знає ім'я кожного concern у момент його виконання. **Проблема поточного стану**: коли concern провалюється, violation output — plain text без інформації про те, який саме concern failed, → `readRuleMdc` змушений включати `js/*.mdc` **усі**.

**Рішення**: `run-rule.mjs` анотує вихід кожного провального concern маркером із директорією джерела: `[concern:js/<name>]` або `[concern:policy/<name>]`. JS і policy concern справді живуть у різних директоріях; маркер фіксує саме цей relative concern path, а не вводить додаткові метадані у check-функції:

```
[concern:js/layout]
❌ Знайдено заборонений файл: package-lock.json — видали його
[concern:policy/package_json]
❌ Поле packageManager у кореневому package.json — прибери
```

`readRuleMdc` у `llm-worker.mjs` парсить ці маркери → будує точний набір `.mdc`:

- `[concern:js/layout]` → включаємо `js/layout.mdc`
- `[concern:js/package_json]` → включаємо `js/package_json.mdc`
- `[concern:policy/package_json]` → включаємо `policy/package_json/package_json.mdc`
- Жоден маркер не знайдений (violation зі старого коду або зовнішнього інструмента) → fallback: всі `js/*.mdc` + всі `policy/*/*.mdc`

**Convention** (без зайвих метаданих у check-функціях):

- JS concern path `js/<name>` → `js/<name>.mdc`
- Policy concern path `policy/<name>` → `policy/<name>/<name>.mdc`

Маркери — внутрішній формат violation output, прозорий для людини та LLM: вони з'являються як рядки, агент їх ігнорує (або використовує для навігації), але `readRuleMdc` читає детерміновано.

### 2. Рушій — SDK-embed

[`npm/scripts/lib/fix/llm-worker.mjs`](../../npm/scripts/lib/fix/llm-worker.mjs) перебудовується на `createAgentSession` з `pi-coding-agent`, `inMemory()`-сесію на фікс. Low-level `agentLoop` (`pi-agent-core`) — escape-hatch у запасі, не основа.

**systemPrompt ordering** — один рядок у системному промпті кожного рунгу: «Before editing a file, call `ast_facts` on it first». Скорочує redundant read-turns на локальній моделі (Spike 1: verbosity на тривіальних фіксах).

### 3. Транспорт — уніфіковано на pi-ai

Для **LLM-fix-engine** прямий omlx-HTTP-канал ([`npm/lib/omlx.mjs`](../../npm/lib/omlx.mjs)) і ручний routing ([`npm/lib/models.mjs`](../../npm/lib/models.mjs)) **виходять із критичного шляху**. omlx — як custom provider pi-ai (вже сконфігуровано в `~/.pi/agent/models.json` з inline-ключем). Тири (local-min / cloud-min / cloud-avg) = `(provider, id)`-lookup у pi `ModelRegistry`.

Важливо: `npm/lib/llm.mjs` / `models.mjs` **не є лише fix-engine**. Їх зараз використовують shared LLM consumers (`doc-files`, `text/cspell`, ADR-normalize, `llm-lint-fix`, judge/measure helpers). Тому рішення — **широкий hard-cutover без legacy і без compatibility facade**: у Ф1 одночасно мігруємо fix-engine і всі shared consumers на нові pi-native API, після чого видаляємо `llm.mjs`, `models.mjs`, `omlx.mjs`, `omlx-trace.mjs` та старий `{changes}` apply stack.

> `pi-ai` включає лише моделі з **нативним function-calling**; fallback-у для без-tool моделей немає за принципом. Спайк підтвердив, що канон `gemma-4-e4b-it-OptiQ-4bit` function-calling тримає.

**Thinking — старий `thinkingBudget` мапиться на нативний pi `thinkingLevel`** (`off|minimal|low|medium|high|xhigh`). Per-tier thinking задається через `createAgentSession({ scopedModels: [{ model, thinkingLevel }] })` — кожен тир дістає власний рівень (напр. local-min `low`, cloud-avg `high`), замість ручного `thinkingBudget`-плюмбінгу в [`omlx.mjs`](../../npm/lib/omlx.mjs). Числовий budget → дискретний рівень: маппінг фіксуємо в коді тирів (one-liner-таблиця), не в кожному виклику.

### 3а. Міграція shared LLM consumers без legacy

План Ф1 — один ширший PR, без legacy backend і без API-shim під старі імена:

1. **Нові явні pi-native модулі.**
   - `npm/lib/pi-agent-fix.mjs` — agentic worker для `createAgentSession`, tools, write-guard, telemetry.
   - `npm/lib/pi-one-shot.mjs` — bounded one-shot API поверх pi-ai для не-agent задач (`messages`, `modelTier`, `thinkingLevel`, `timeoutMs`, `caller`, structured usage/error metadata).
   - `npm/lib/pi-model-tiers.mjs` — tier config → `ModelRegistry.find(provider,id)`, без ручного dispatch і без direct omlx.
2. **Fix-engine cutover.** `llm-worker` переходить на `pi-agent-fix`; `orchestrator` більше не імпортує `callLlm`, `resolveModel`, `classifyOmlxError`, `applyChanges`, `parseChangesResponse`, `readFilesForFix`.
3. **Shared consumers cutover у тому ж PR.**
   - `doc-files` generation/judge: `callLlm` → `pi-one-shot`, збереження preflight/circuit-breaker semantics.
   - `text/cspell`: bounded JSON-classification → `pi-one-shot`, без агентного write-tool.
   - ADR normalize pipeline: local retry + optional cloud escalation → `pi-one-shot` cascade.
   - `llm-lint-fix`: видалити як legacy, якщо agentic fix-engine покриває сценарій; інакше тимчасово переписати на `pi-one-shot` **без** старого `{changes}` parser/apply API.
4. **Legacy removal у тому ж PR.** Видаляємо `npm/lib/llm.mjs`, `models.mjs`, `omlx.mjs`, `omlx-trace.mjs`, `npm/scripts/lib/fix/llm-fix-apply.mjs` і всі тести, що мокають `curl`/`pi` CLI як transport. Забороняємо нові імпорти старих API через test/grep guard.

Критерій завершення: `rg "callLlm|callOmlx|resolveModel|classifyOmlxError|llm-fix-apply|omlx-trace"` по `npm/` не знаходить runtime-imports; `lint --read-only` не резолвить pi-модулі; fix/generation шляхи резолвлять pi лише через lazy import; усі тести старих consumers переведені з `spawnSync(curl/pi)` на scripted pi-ai/one-shot provider.

### 3б. Per-rule AST-контекст (`_ast-context.mjs`)

`ast_facts(path)` — власний tool fix-engine'а, реєструється поряд із built-ins у `createAgentSession`:

```js
tools: [
  ...builtins,
  {
    name: 'ast_facts',
    description: 'Extract structured AST facts (imports, exports, top-level functions) from a source file.',
    parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
    execute: ({ path }) => loadAstContext(ruleId, path, cwd)
  }
]
```

**Discovery per-rule:** fix-engine шукає `npm/rules/{ruleId}/js/_ast-context.mjs` (underscore-prefix = виключено з check-discovery glob'ом `*.mjs !_*`). Якщо є — викликає `export async function extractContext(filePath): Promise<object>`. Якщо відсутній — **generic fallback**: `npm/scripts/utils/ast-extract.mjs` на базі `ast-scan-utils.mjs` → `{ imports, exports, topLevelFunctions }`.

**Формат результату** — JSON-рядок. gemma-4-e4b стабільно читає JSON у tool results (175+ docgen-файлів без парсинг-помилок). Три-tier fallback parser `llm-fix-apply.mjs` вже є — при потребі перевикористати.

**Fallback при помилці AST-парсу** — логуємо `{ rung, rule, file, error }` і деградуємо до голого вмісту файлу (поточна поведінка `llm-worker`). Агент продовжує з тим що має.

### 4+5. Контур керування — self-check + зовнішній re-check

- **Self-check tool** веде агента всередині сесії, але є advisory-only. Контракт tool-а: `self_check({ ruleId, files })` → `{ ok, output, scope, supported }`. Він викликає той самий read-only verdict helper, що й зовнішній re-check, але результат лише підказує агенту, чи варто ще правити.
- **Зовнішній канонічний re-check = джерело правди** для рішення про escalation (агент міг збрехати собі). Контракт helper-а: `runRuleVerdict({ ruleId, cwd, initialFiles, touchedFiles, readOnly: true })`, де `files = unique(initialFiles ∪ touchedFiles)`. Якщо правило має `lint(changed, cwd, { readOnly: true, llmFix: false })`, verdict викликає саме per-file/per-rule lint-сurface на `files`; якщо правило не має file-scoped lint-surface, fallback — повний `runConformanceCheck([ruleId], cwd)`. Pass зовнішнього verdict-а потрібен для keep; fail/unsupported у self-check не зупиняє сесію, fail зовнішнього verdict-а запускає rollback + escalation.
- **Fresh `inMemory()` сесія на rung**; feedback попереднього провалу (діагноз + лог turns) **інʼєктується в промпт** наступного rung — без накопичення «брудного» контексту слабкої моделі у сесії сильної.
- **Runaway-backstop (два рівні):**
  - **Первинний — turn-ceiling (~50 turns)** на сесію: основна точка контролю довжини агентного циклу. Перевищення = runaway, логується й сесія обривається.
  - **Вторинний — per-tier таймаут сесії** (`N_LOCAL_FIX_TIMEOUT_MS=300s` / `N_CLOUD_FIX_TIMEOUT_MS=120s`): захист від технічних зависань (мережа, OOM). Для локальних — 5 хвилин, бо 4b модель повільна і кожен turn може займати ~30–60s; для хмарних — 2 хвилини, бо API-виклики мають бути швидкими.
  - Таймаут і turn-ceiling незалежні: рання умова обриває. Таймаут без turn-ceiling — ненадійний (залежить від швидкості моделі); turn-ceiling без таймауту — не ловить зависання на рівні транспорту.
- **Cost-cap (avg-кеп) — ЗБЕРІГАЄТЬСЯ** (наявний `maxAvg` з [`orchestrator.mjs`](../../npm/scripts/lib/fix/orchestrator.mjs)). Це **бюджет кількості cloud-avg-ескалацій на весь lint-прогін** (cross-rule: `avgBudget -= avgUsed` після кожного правила; вичерпано → cloud-avg-rung пропускається з `cloud-avg cap reached`). **Ортогональний** до runaway-backstop: turn-ceiling/таймаут лімітують _один_ agentic-цикл, avg-кеп лімітує _скільки разів_ за прогін дозволено найдорожчий тир. Orchestrator-рівень — від pi-embed не залежить, переноситься як є. Не плутати з §1: hard turn-ceiling = аварійна стеля runaway, avg-кеп = стеля _вартості_ по тирах.

### 7. Телеметрія — always-on, distillation-ready

Джерело — `session.subscribe` pi-події (`tool_execution_start/end` + `message_update`; **не** літерал `toolCall`). [`npm/lib/omlx-trace.mjs`](../../npm/lib/omlx-trace.mjs) видаляється; pi-agent і pi-one-shot пишуть trace через новий глобальний writer.

**Global-only trace invariant.** Старий project-local `<cwd>/.n-cursor/llm-trace.jsonl` більше **не створюється і не поповнюється**. Єдиний append-only LLM wire trace живе глобально: `~/.n-cursor/llm-trace.jsonl`; записи мають поля `cwd`, `projectId`, `caller`, `rule`, `rung`, `model`, `backend: "pi-ai"`, `kind: "agent"|"one-shot"`. Це прибирає службовий шум із consumer-репозиторіїв і лишає cross-project telemetry mineable в одному місці. Наявні старі project-local trace-файли вважаються stale; міграція їх не читає й не переносить.

Запис **на fix-attempt (rung)**, із вкладеністю turn/tool-breakdown:

```jsonc
{
  "rule": "n-ci4",
  "rung": "local-min",
  "model": "omlx/gemma-4-e4b-it-OptiQ-4bit",
  "violationSignature": "...", // вихід check-{id}, що спричинив фікс
  "turns": [
    {
      "i": 1,
      "toolCalls": [{ "name": "read", "file": "x.mjs", "ms": 120, "status": "ok" }],
      "usage": { "in": 1840, "out": 95 },
      "finish": "tool_calls"
    },
    {
      "i": 2,
      "toolCalls": [{ "name": "edit", "file": "x.mjs", "oldText": "...", "newText": "...", "ms": 80, "status": "ok" }],
      "usage": { "in": 2010, "out": 140 },
      "finish": "stop"
    }
  ],
  "turnCount": 2,
  "toolCallCount": 2,
  "recheck": { "self": "pass", "external": "fail" },
  "escalated": true,
  "backstopHit": false,
  "wallMs": 5400
}
```

- **Повний `oldText/newText`** (повний forensics + корпус для дистиляції).
- **`violationSignature`** робить запис самодостатньою mineable-парою `(violation → transform)`.
- **TruffleHog scrub перед persist**: serialized telemetry record проганяється через TruffleHog-compatible cleanup. Якщо `trufflehog` доступний, record пишеться у tmp і перевіряється `trufflehog filesystem <tmp> --no-update --results=verified,unknown --json`; при знахідках повні `oldText/newText` не зберігаються, а замінюються на redacted summary (`redacted: true`, affected tool/file/rule, без секретного payload). Якщо `trufflehog` недоступний — пишемо warning у telemetry manifest і застосовуємо мінімальний regex-redaction для типових token/key/password полів. Distillation не бере `redacted:true` records як fixture source.

**Стор — глобальний крос-проєктний** (бо `npx @nitra/cursor lint --full` ганяється у різних проєктах). Структуроване дерево, не один моноліт:

```
~/.n-cursor/telemetry/
  <rule-id>/
    open/<record-id>.json        # не-дистильований приклад (схема вище)
    <rule-id>.manifest.json      # per-signature лічильники + стан distilled|open|rejected
  _archive/<rule-id>/<sig>/...   # дистильоване: top-K як фікстури, решта під GC
  index.json                     # глобально: тоталі, last-distill timestamps
```

- **by-rule + signature-як-ПОЛЕ** (кластеризацію по патернах робить avg-cloud на дистиляції, не крихкий write-time хеш).
- Ідентичні `(rule + old→new + glob)` **схлопуються з лічильником occurrences + provenance-список**.
- **Тільки авто-ретеншн** (size/age-cap + авто-archive на дистиляції), без явної housekeep-команди.

### Тверда межа CI

`lint --read-only` (CI/detection) робить **нуль pi-викликів — ні SDK, ні CLI, навіть не вантажить pi-модулі**. pi живе **виключно у fix-шляху** через lazy dynamic `import()` усередині orchestrator fix-гілки, ніколи на top-level.

### 8. T0-фіксери

Детерміновані `fix-*.mjs` ([`discover-t0-patterns.mjs`](../../npm/scripts/lib/fix/discover-t0-patterns.mjs)) лишаються **до** LLM: порядок `T0 → agentic rungs`. Агентний rung бачить уже-T0-застосований стан.

### 9. Тестованість

Філософія наявних vitest-тестів зберігається — **мок на межі транспорту**, але межа зсувається:

- `spawnSync(curl/pi)` → **scripted pi-ai provider** (фейк-провайдер повертає наперед задані assistant-turns із tool-calls). Детерміновані тести orchestrator / telemetry / recheck / backstop — на кожен коміт.
- **Спроможність** («чи модель справді фіксить правило X») → **live-smoke nightly CI** проти справжньої omlx на fixture-репо, **outcome-assert**, не golden-file (варіативність прийнятна). Асерт під scope (c): _правило зникло на `(вихідні ∪ зачеплені)` файлах_ ∧ _жоден зачеплений файл ∉ denylist_ — **без** обмеження diff'у на target-файли (під (c) diff legітимно ширший, див. §12; уточнення addendum-а: **зміна наявних** файлів поза target-set тепер під semantic-collateral veto — легітимно ширший diff означає **нові** файли).
- Record/replay — **пропускаємо** (scripted-provider + smoke достатньо).

### 10. Пакування / залежності

`@earendil-works/pi-coding-agent` + `@earendil-works/pi-ai` як **`optionalDependencies`** ядра + **lazy dynamic import лише у fix-гілці** + presence-check із ясною помилкою. Так `--read-only` навіть не резолвить модуль. Bin лишається plain-node ESM; pi **не інлайниться** в моноліт. **Version-pin** pi-пакетів (нестабільність API — open question prior-art). Write-safety-хук (§12) перевикористовує готові патерни розширень pi (`protected-paths`, `git-checkpoint`), а не пишеться з нуля.

### 11. Auth / config

n-cursor **перевикористовує конфіг pi**. Embed-wiring:

```js
const reg = ModelRegistry.create(AuthStorage.create()) // вантажить ~/.pi/agent/models.json + auth.json
const model = reg.find('omlx', 'gemma-4-e4b-it-OptiQ-4bit') // тир → Model-обʼєкт (НЕ рядок!)

// ⚠️ Inline write-guard вантажиться ВИКЛЮЧНО через DefaultResourceLoader.
// createAgentSession({ extensionFactories }) — МОВЧКИ ІГНОРУЄТЬСЯ (опція лише в CLI-entry-типі,
// НЕ в CreateAgentSessionOptions). Спайк 3 спіймав це як fail-open: guard не вантажиться,
// агент пише без захисту й без помилки. Звідси canary нижче.
const loader = new DefaultResourceLoader({
  cwd,
  agentDir: `${process.env.HOME}/.pi/agent`,
  settingsManager: SettingsManager.create(cwd),
  extensionFactories: [writeGuard] // §12: scope + pre-image + canary-flag
})
await loader.reload()

const { session } = await createAgentSession({
  modelRegistry: reg,
  model,
  tools: ['read', 'grep', 'find', 'edit', 'write', 'ls', 'ast_facts'],
  cwd,
  sessionManager: SessionManager.inMemory(),
  resourceLoader: loader
})
if (!writeGuard.attached) throw new Error('write-guard не приєднався — fix скасовано (§12 fail-closed)')
```

Для fix-engine і shared consumers власні omlx-HTTP-клієнт, omlx-key-плюмбінг і auth більше не використовуються: їх замінює pi `ModelRegistry`/`AuthStorage`. Ф1 завершується лише тоді, коли старі transport/auth модулі фізично видалені.

### 12. Безпека запису (наслідок «агент сам застосовує патч»)

Рішення §1 «патч застосовує агент» віддає контроль над записом — зник dry-run. Контур із **трьох незалежних** під-механізмів (плутати не можна): **Scope** (куди можна писати, превентивно) · **Snapshot** (як відкотити) · **Verdict** (keep vs rollback). Когерентність: усе спирається на одну git-precondition.

**Precondition.** Fix-шлях вимагає git-репо. Нема git → **fix пропускається** з ясним повідомленням; detection / `--read-only` працюють як завжди (git-гейт — лише на fix-гілку, не на весь lint). Закриває колишній open-gap «а якщо не git».

**Scope = (c), корінь = git-root.** Агенту дозволено редагувати й **створювати** файли будь-де під git-root (де `.git`), окрім denylist. Per-rule write-glob **не** вводимо.

**Denylist = `.git/` + усе, що матчить `git check-ignore`.** Тобто агент пише лише в **tracked-or-trackable** (джерело), ніколи — в ігноровані (build-артефакти, `node_modules`, `.worktrees`, `.env`, локальний стан). Lockfiles і `npm/rules/**` — tracked, отже редаговані (свідомо; verdict-re-check ловить поломку). Git обов'язковий → `git check-ignore` завжди доступний, denylist «free». `.git/` блокується явно (поза моделлю ignore). Додатковий secret-denylist у write-guard не вводимо: секрети мають бути або ignored (`git check-ignore`), або спіймані security/TruffleHog-gate; telemetry окремо чиститься перед persist (§7).

**Enforcement — inline-extension із `pi.on('tool_call')`** (механізм доведено **Спайком 3**: veto `edit`/`write` під `createAgentSession` headless реально лишає файл незмінним). Патерн `protected-paths` / [pi-landstrip](https://github.com/landstrip/pi-landstrip). Хук для шляху `P`:

1. resolve absolute; `P` мусить бути під git-root (guard від `..`-escape — наявний патерн policy-targets);
2. блок (`return { block: true, reason }`), якщо `P` під `.git/`;
3. блок, якщо `git check-ignore P` матчить;
4. інакше allow + зняти **pre-image** (наявний вміст, або позначка `NEW` для нового файла).

Блок повертається агенту як tool-error → він самокоригується в скоупі; runaway ловить turn-ceiling (§4+5).

**Розводка — ВИКЛЮЧНО через `DefaultResourceLoader` → `resourceLoader` (§11), НЕ top-level `extensionFactories`** (та опція в `createAgentSession` мовчки ігнорується). **Fail-closed canary (обовʼязковий):** фабрика guard виставляє прапор `attached`; на старті fix-сесії перевіряємо його й **відмовляємо у fix**, якщо guard не приєднався. Без canary неправильна (чи майбутня-API-breaking) розводка → guard тихо не вантажиться → агент дістає **необмежений запис без помилки** (Спайк 3 відтворив цей fail-open). Pre-image (Snapshot нижче) — це чистий `fs` у тому ж хуці, окремого спайку не потребує.

**Snapshot — per-file pre-image** з того ж хука (патерн `git-checkpoint`, але **без git як механізму** — git лише precondition + людський backstop). Rollback = відновити вміст / видалити `NEW`. Знімок per-first-touch покриває **abort посеред запису** (timeout уб'є `session.prompt` — маємо pre-image кожного вже-зачепленого файла). Чому не `git stash`: дерево брудне **за дизайном** (фіксимо власний незакомічений delta vs origin) — stash сплутав би роботу користувача з нашим знімком.

**Verdict — зовнішній canonical re-check поточного правила** по `(вихідні ∪ зачеплені)` файлах (touched-set із pre-image-хука): pass → **keep**; fail / abort / backstop → **rollback** до pre-image + escalation (fresh `inMemory`, feedback у промпт). Re-check саме по зачеплених (не лише вихідних) закриває діру (c): під найвільнішим scope інакше колатеральні записи агента лишились би **взагалі** неперевіреними. Свідомо НЕ ганяємо _усі_ правила (вартість) — колатераль по **інших** правилах приймається як ризик (звужено semantic-collateral veto — addendum нижче).

**Semantic-collateral veto (addendum 2026-07-05).** Прийнятий вище ризик виявився ширшим за «порушення інших правил»: слабка локальна модель робить **семантичні** правки, що не порушують жодного правила й тому проходять будь-який re-check. Живий кейс (consumer-репо `task`, `app/src/App.vue`): gemma-4b, фіксуючи інше правило, захардкодила версію `'0.3.0'` з коментарем «we simulate it being available» замість наявного `await getVersion()` — semantic regression, невидимий для verdict-а. Тест-фікстура кейсу: `npm/scripts/lib/lint-surface/tests/run-fix.test.mjs` (describe «semantic-collateral veto»). Guard із трьох розглянутих шарів (перші два реалізовані):

1. **Промпт-обмеження** (`buildFixPrompt`, llm-lib): явний блок «лише механічні зміни, що прямо усувають порушення; заборонено міняти бізнес-логіку, хардкодити значення, симулювати поведінку» + перелік target-файлів порушення (`targetFiles`, плюмбиться з default-worker-а).
2. **Verdict-veto поза target-set** (`run-fix.mjs` + `collateral-veto.mjs`): clean-вердикт rung-а **не приймається**, якщо rung **змінив наявний** файл поза target-set (`violations[].file ∪ item.files`); наслідок — rollback S1, feedback наступному rung-у, телеметрія `kind:"collateral-veto"` (rejectedFiles/targetFiles) у глобальний llm-trace. **Нові** файли дозволені — легітимний клас (scaffold, доки поряд із кодом), їх однаково покриває re-check зачеплених + rollback; тому write-scope (c) НЕ звужується і write-guard не чіпаємо (превентивний per-rule write-glob лишається відхиленим). Порожній target-set (whole-repo концерни без `file` у violations) → veto незастосовний (свідомий fail-open, щоб не ламати концерни без file-атрибуції).
3. **AST-структурний diff зачеплених функцій** (порівняння imports/exports/сигнатур pre/post-image) — розглянуто й **відкладено**: oxc-екстрактор не покриває Vue SFC (сам кейс App.vue!), а винятки rule-залежні (unused-import фікси легітимно видаляють imports) — потрібна per-rule конфігурація. Додаємо, лише якщо телеметрія veto покаже частий **in-target** semantic collateral.

Залишковий accepted-risk після addendum-а: семантичні правки **в межах target-файлів**, що проходять re-check поточного правила (їх ловить ескалація на сильніший rung + людське рев'ю diff-а).

### 13. Маховик самопокращення (FIRST-CLASS)

Мета телеметрії — дистилювати детерміновані `fix-*.mjs`, щоб менше навантажувати локальну модель:

```
agentic-фікс (дорого) → лог (violationSignature + oldText→newText)
   → У ХВОСТІ `lint --full` (fix-режим, НЕ --read-only), якщо база зріла:
       avg-CLOUD модель готує n-llm-patch ОКРЕМО на кожен фікс
       (наявний скіл /n-llm-patch: read-only аналіз CWD consumer-репо)
   → промпт каже агенту додати узагальнений fix-*.mjs у @nitra/cursor (НЕ в consumer-репо)
   → людина ревʼюить кожен патч і САМА застосовує на @nitra/cursor
   → майбутні порушення гаснуть на T0
```

- Consumer-прогін лише **емітить патч-артефакти на виніс**, нічого не змінює в @nitra/cursor напряму.
- **Залоговані приклади їдуть разом із патчем** як майбутні тест-фікстури `fix-*.mjs` (прогоняться у vitest/stryker @nitra/cursor при застосуванні).
- **KPI = T0-hit-rate per rule** угору. T0 = зростаюча кристалізація навченого, не статичний шар.

## Спайк-докази

**Спайк 1 — function-calling локальної моделі (PASS).** `omlx/gemma-4-e4b-it-OptiQ-4bit` через pi видав нативний `toolCall name:edit` зі структурованими `{oldText,newText}`, агентний цикл `read → edit` (3 turns), файл змінено точно. Ризик «4B не вміє tool-calling» спростовано. Насторога: балакучість (багато read/edit на тривіальний edit) → латентність на повільній локальній.

**Спайк 2 — bun×SDK end-to-end (PASS).** `@earendil-works/pi-coding-agent@0.80.2` під bun 1.3.14 імпортується (ESM), `createAgentSession` з `ModelRegistry.create(AuthStorage.create())` + `reg.find(...)` крутить повний агентний цикл і **реально патчить файл** через omlx. Закрило: Пункт 10 (bun-сумісність), Пункт 11 (auth-wiring), та 2 open-questions prior-art — tool-назви lowercase `read/edit/write`, omlx compat-флаги SDK ковтає.

**Спайк 3 — write-guard veto headless (PASS, з критичним застереженням).** Inline-extension `pi.on('tool_call')`, що повертає `{block:true}` на `edit`/`write`, **реально ветує** запис під `createAgentSession`+omlx: агент спробував `edit locked.txt`, хук заблокував, файл лишився `VALUE=OLD` незмінним (`blockFired:true, fileUnchanged:true`). Доводить здійсненність §12-enforcement. **Застереження (footgun):** veto працює **лише** коли фабрика передана через `new DefaultResourceLoader({ extensionFactories })` → `resourceLoader`; top-level `createAgentSession({ extensionFactories })` **мовчки ігнорується** — у першому прогоні guard не завантажився й агент відредагував файл **без помилки** (fail-open). Звідси обовʼязковий **fail-closed canary** у §12. Статика підтвердила: `ToolCallEventResult { block?: boolean; reason? }`, `EditToolCallEvent.input: { path, edits:[{oldText,newText}] }`, «Fired before a tool executes. Can block.»

## Звірка з prior-art (committed ADR — узгоджено, треба зберегти)

- **[`docs/adr/260606-1313`](../adr/260606-1313-інверсія-керування-у-docgen-конвеєрі-js-оркеструє-llm.md)** (інверсія керування, committed): «JS оркеструє, LLM=сервіс» — **прототип** нашого fix-engine. Спека продовжує вже-прийнятий принцип.
- **`docs/adr/260620-0556`** (fail-fast escalation, committed): per-tier таймаути + cloud-transport abort + error-class `/ETIMEDOUT|timed out|pi error/i` + `fix-escalation.jsonl`. **Зберегти**; при embed транспортні помилки прийдуть як винятки з `session.prompt` → переклас error-classification.
- **`docs/adr/260609-1007`** (telemetry→insights, draft, disabled): прото-маховик; наша дистиляція — його завершення.

## Фазовий план (пряма заміна, НЕ дуал-бекенд)

Рішення: **єдиний бекенд pi**, без legacy й без feature-флага. Per-rule rollout — через **наявний `llmFix: true/false`** у `main.json` (вмикаєш правилу, коли pi довів його на smoke). Свідомий трейд-оф: hard cutover, rollback лише через git-історію — прийнятно, бо ядро де-ризиковане спайками, smoke ловить регрес, fix-engine не safety-critical.

- **Ф0 — спайки: ✅ DONE** (function-calling + bun×SDK + write-guard veto headless).
- **Ф1 — широка заміна рушія й shared LLM surface (один PR, без legacy):** pi-worker на `createAgentSession`; `pi-one-shot` для bounded не-agent задач; orchestrator стає **application-agnostic** (worker повертає `{applied, touchedFiles, telemetry, error}`, сам володіє застосуванням); **clean-slate per rung** (per-file pre-image rollback, §12, щоб слабка локальна не отруювала cloud-rung); **write-safety-хук** (§12: inline-extension через `DefaultResourceLoader` + scope (c) + denylist `git check-ignore` + pre-image + **fail-closed canary**); телеметрія (distillation-ready схема + TruffleHog scrub + global-only `~/.n-cursor/llm-trace.jsonl`); міграція `doc-files`, `text/cspell`, ADR normalize, `llm-lint-fix`; **видалення** `llm.mjs`, `models.mjs`, `omlx.mjs`, `omlx-trace.mjs`, `llm-fix-apply.mjs`, `applyChanges`, парсерів `{changes}`, `readFilesForFix`, direct `callLlm`/`resolveModel` routing. **Зберегти** скелет [`orchestrator.mjs`](../../npm/scripts/lib/fix/orchestrator.mjs), per-tier таймаути, escalation-log (розширений), error-classification.
- **Ф2 — валідація:** nightly live-smoke per-rule → вмикаєш `llmFix` правилу, що пройшло прагматичну планку (pi re-check pass-rate ≥ прийнятно + без runaway).
- **Ф3 — маховик дистиляції:** хвіст `lint --full` → avg-cloud → n-llm-patch на фікс → людина застосовує на @nitra/cursor. Окрема пізніша фіча; гейтиться зрілістю даних. Схема телеметрії Ф1 уже distillation-ready, щоб не переінструментовувати.

## Відкриті дрібні гепи

1. **Version-pin** `pi-coding-agent`/`pi-ai` у `npm/package.json` + політика апгрейду (breaking changes → міграційна нотатка).
2. **Error-classification reclassification** — наявний regex транспортних помилок переробити під винятки з `session.prompt`.
3. **RAM-cap гайд** (prior-art: gemma 9.6GB своп на 8GB → «модель ≤ ~50% RAM»). OptiQ-4bit менший — low-priority, але задокументувати.
4. ~~**Clean-slate механізм**~~ — **ВИРІШЕНО (§12):** per-file pre-image у `tool_call`-хуці (не git-stash); fix-шлях вимагає git-репо, no-git → skip fix.
5. **`ast-extract.mjs` generic fallback** — реалізувати shared utility на базі `ast-scan-utils.mjs` (`{ imports, exports, topLevelFunctions }`); `_ast-context.mjs` per-rule — лише для правил з нестандартними потребами (напр. `n-js`: utils-import cross-file граф).

## Посилання

- pi: [github.com/earendil-works/pi](https://github.com/earendil-works/pi) · [pi-coding-agent SDK docs](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/sdk.md)
- Референс оркестрації: [pi-dynamic-workflows](https://github.com/QuintinShaw/pi-dynamic-workflows)
- Write-safety reuse (§12): [pi examples/extensions](https://github.com/earendil-works/pi/tree/main/packages/coding-agent/examples/extensions) (`protected-paths`, `git-checkpoint`, `dirty-repo-guard`) · [pi-landstrip](https://github.com/landstrip/pi-landstrip)
- Prior-art: ADR 260606-1313, 260620-0556, 260609-1007; spec [2026-05-25-pi-extensions-adr-hooks-design](../../npm/.worktrees/main-lint/docs/specs/2026-05-25-pi-extensions-adr-hooks-design.md)
