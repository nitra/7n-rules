# Винесення LLM-шару в окремий пакет `@7n/llm-lib`

- Дата: 2026-07-05
- Статус: специфікація (код не змінювався)
- Контекст: у `@nitra/cursor` і `@7n/test` паралельно живуть два різні LLM-шари поверх pi
  (earendil-works) з дубльованою й місцями суперечливою логікою
- Prior-art: `docs/specs/2026-06-26-pi-fix-engine-migration.md` (SDK-embed, CI-межа,
  телеметрія §7/§13), ADR `260620-0556` (fail-fast escalation), ADR `260606-1313`
  (інверсія керування: JS оркеструє, LLM = сервіс)

## 1. Мета й не-мета

**Мета.** Централізувати механіку роботи з LLM (локальні omlx-моделі + хмарні провайдери)
в одному пакеті, щоб:

- покращення (tiers, трасування, бюджети, guard-и) робились в одному місці й діставались
  усім consumers через звичайний npm-бамп;
- нові проєкти підключали готовий шар замість чергового власного `pi-client.mjs`;
- заміна substrate (pi → щось інше) торкалась лише нутрощів пакета, а не consumers.

**Не-мета:**

- НЕ переносимо rule/task-специфіку: fix-промпти правил, verdict-схеми мутантів,
  docgen-judge критерії, кеш по blob-hash, seed-fallback у gen-tests — усе це лишається
  у своїх проєктах;
- НЕ будуємо важкий adapter boundary (`LlmBackend`-інтерфейси, plugin-система) —
  substrate-незалежність досягається дисципліною API-поверхні, не indirection-шаром;
- НЕ чіпаємо detection-шлях `@nitra/cursor` (`lint --read-only` = нуль LLM-модулів,
  тверда CI-межа зі спеки 2026-06-26 зберігається як є).

## 2. Ландшафт 2026: чому свій тонкий пакет поверх pi-ai

Веб-ревізія (2026-07) популярних підходів до уніфікованого LLM-шару в JS/TS:

| Кандидат | Вердикт | Чому |
| --- | --- | --- |
| **pi / pi-ai** (earendil-works, MIT, v0.80.x) | **Substrate (лишаємось)** | Уніфіковані провайдери + будь-який OpenAI-compatible endpoint (omlx). Retry/fallback/tiers **свідомо не вбудовані** («primitives, retry is the caller's responsibility») — наш шар додає рівно це, без конфліктів. Уже наш стек, спайки пройдені |
| **Vercel AI SDK** (`ai@7`, Apache-2.0) | Запасний хребет | Найбільша екосистема провайдерів (~11.5M downloads/тиждень), але вага (UI/stream-частини) і major-churn v5→v6→v7 за ~1.5 року — реальний міграційний податок |
| Gateway: LiteLLM / OpenRouter / Portkey | Ні | Зовнішній процес/сервіс без TS DX-виграшу; OpenRouter не покриває local; Portkey — governance-надлишок |
| LangChain JS / LlamaIndex.TS | Ні | Важкі; LlamaIndex TS-гілка фактично депріоритизована |
| Token.js та подібні | Ні | Стагнація активності |
| MCP sampling як LLM-доступ | Ні | `sampling/createMessage` deprecated у спеці MCP 2026-07-28 |

Local-екосистема зійшлась на спільному знаменнику «OpenAI-compatible baseURL»
(Ollama, LM Studio, mlx-omni-server, oMLX) — pi-ai покриває це однією конфігурацією
custom provider, окремий local-шлях не потрібен.

**Ризик pi:** bus-factor малої org + перейменування npm-scope. Мітигація — не абстракція,
а малий substrate-незалежний API-surface пакета (§4): при потребі переписуємо нутрощі
llm-lib на AI SDK core за один захід, consumers не змінюються.

## 3. Поточний стан (що дублюється)

### 3.1 `@nitra/cursor` — донор ядра

Зрілий шар `npm/lib/pi-*.mjs` (Ф1 pi-міграції завершена, live-валідована):

| Модуль | Роль |
| --- | --- |
| `pi-model-tiers.mjs` | env-тири `N_LOCAL_*`/`N_CLOUD_*` → pi ModelRegistry, каскад min→avg→max→cloud, thinkingLevel per tier |
| `pi-one-shot.mjs` | bounded не-агентний виклик: messages → `{content, usage, error, model, caller}` |
| `pi-agent-fix.mjs` | агентна спроба фіксу (rung): write-guard, custom tools, turn-ceiling 50, телеметрія |
| `pi-agent-skill.mjs` | агентний runner скілів: повний tool-set, turn-ceiling 80, timeout 10 хв |
| `pi-write-guard.mjs` | превентивний veto (git check-ignore) + snapshot/rollback (§12 pi-спеки) |
| `pi-trace.mjs` | глобальний append-only `~/.n-cursor/llm-trace.jsonl` |
| `pi-telemetry-store.mjs` | глобальний distillation-корпус `~/.n-cursor/telemetry/<rule>/` |
| `pi-with-timeout.mjs` | promise-race з AbortController |
| `pi-memory-guard.mjs` | omlx RAM-rejection → миттєвий fail-fast crash з request-body |
| `pi-max-tokens.mjs` | per-call стеля відповіді через streamFn-мікс |

Плюс 8 vitest-файлів (`npm/lib/tests/pi-*.test.mjs`) і doc-files (`npm/lib/docs/pi-*.md`).
Залежність: `@earendil-works/pi-{ai,coding-agent}` 0.80.2 як **optionalDependencies**
з lazy dynamic import лише на fix/gen-шляхах.

Coupling низький: усі consumers (docgen-gen/judge, cspell-fix, adr/normalize-pipeline,
lint-surface/default-worker + run-fix) ходять через чисті виклики з DI-параметром `deps`.

### 3.2 `@7n/test` — дубль з розбіжностями

| Що | Де | Розбіжність із cursor |
| --- | --- | --- |
| `pi-client.mjs` (`callText`/`callAgent`) | `npm/src/lib/` | Exponential backoff: connection 4×(1.5s→12s), omlx memory 3×(15/30/60s) — **суперечить принципу fail-fast** (ADR 260620-0556) |
| Прямий HTTP до omlx | `pi-client.mjs`, префікс `omlx/` | Обхід pi SDK — у cursor цей шлях уже видалено на користь SDK-embed |
| Резолюція моделей | розсіяна по 4 файлах (gen-tests, coverage-classify, fix-tests, coverage-fix) | У cursor централізовано в `pi-model-tiers` |
| `prompt-budget.mjs` | `npm/src/lib/` | **Унікальна цінність** — бюджети promptChars/maxTokens per task-kind (`header`/`block`/`single-file`/`fix`), `fitToBudget()`, `packBatch()`; у cursor аналога нема |
| Хмарний виклик | через pi CLI | У cursor — SDK-embed (`createAgentSession`) |

Env-канон `N_LOCAL_MIN_MODEL`/`N_CLOUD_{MIN,MAX}_MODEL` уже спільний між проєктами —
контракт де-факто існує, бракує спільного коду.

## 4. Пакет `@7n/llm-lib`

### 4.1 Розташування і пакування

- Новий workspace-пакет **`llm-lib/`** у корені монорепо cursor
  (root `package.json` → `"workspaces": ["npm", "demo", "llm-lib"]`).
- Публікується окремо в npm як `@7n/llm-lib`, semver незалежний від `@nitra/cursor`.
- `@earendil-works/pi-ai` + `@earendil-works/pi-coding-agent` — **peerDependencies
  (peerDependenciesMeta: optional)**: consumer сам вирішує, ставити їх завжди
  (@7n/test — dependencies) чи як optionalDependencies з lazy import
  (@nitra/cursor — зберігає CI-межу «read-only = нуль pi»). llm-lib всередині імпортує pi
  лише через dynamic import у функціях, не на top-level.
- Пін pi: `0.80.x` (tilde-діапазон), бамп — свідомий PR у llm-lib, не транзитивний сюрприз.

### 4.2 Вміст (перенос + перейменування на нейтральні імена)

З `npm/lib/` (git mv + rename, pi-префікс зникає з публічної поверхні):

```text
llm-lib/
├── lib/
│   ├── model-tiers.mjs      ← pi-model-tiers.mjs
│   ├── one-shot.mjs         ← pi-one-shot.mjs
│   ├── agent-fix.mjs        ← pi-agent-fix.mjs
│   ├── agent-skill.mjs      ← pi-agent-skill.mjs
│   ├── write-guard.mjs      ← pi-write-guard.mjs
│   ├── trace.mjs            ← pi-trace.mjs
│   ├── telemetry-store.mjs  ← pi-telemetry-store.mjs
│   ├── with-timeout.mjs     ← pi-with-timeout.mjs
│   ├── prompt-budget.mjs    ← 7n-test npm/src/lib/prompt-budget.mjs
│   └── internal/
│       ├── memory-guard.mjs ← pi-memory-guard.mjs (не експортується)
│       └── max-tokens.mjs   ← pi-max-tokens.mjs (не експортується)
├── lib/docs/                ← doc-files їдуть разом з модулями
├── tests/                   ← pi-*.test.mjs (rename відповідно)
├── package.json
└── README.md
```

`ast-extract.mjs` НЕ переноситься — лишається у cursor (`npm/scripts/utils/`);
`runAgentFix` уже приймає його через DI/опціонально, generic-fallback без нього працює.

### 4.3 Публічний API — substrate-незалежний (ключова вимога)

Consumers імпортують **лише** нейтральні функції з нейтральними контрактами; жоден
експорт не повертає і не приймає pi-типів. Заміна pi = зміни тільки всередині llm-lib.

| Експорт | Контракт |
| --- | --- |
| `runOneShot({messages, modelTier?, modelSpec?, thinkingLevel?, timeoutMs?, caller?, cwd?})` | → `{content, usage, error, model, caller}` |
| `runAgentFix(ruleId, violation, cwd, opts)` (← runPiAgentFix) | → `{applied, touchedFiles, telemetry, error, rollback}` |
| `runAgentSkill(prompt, opts)` (← runPiAgentSkill) | → `{ok, telemetry, error}` |
| `resolveModel(tier)`, `thinkingLevelForTier(tier)`, `parseModelId(spec)` | рядки/plain objects |
| `createWriteGuard({cwd, root, ...})`, `NEW_FILE`, `gitRoot(cwd)` | plain factory/state |
| `writeTrace(record, path?)`, `tracePath()` | JSONL append |
| `recordFixTelemetry(record, opts?)`, `signatureOf(record)`, `telemetryDir()` | plain objects |
| `withTimeout(promise, ms, opts?)` | promise |
| `budgetFor(kind)`, `fitToBudget(chunks, kind)`, `packBatch(files, kind)` | plain objects |

**Internal (не експортується з пакета):** `getRegistry()`, `resolveModelSpec()`
(повертає pi Model), `applyMaxTokens(session)` (приймає pi session),
`failOnMemoryGuard()`, увесь `createAgentSession`-wiring. Це і є «швартові канати» до pi —
вони не мають виходити назовні.

Definition of done для substrate-незалежності: `grep` по consumers не знаходить жодного
імпорту `@earendil-works/*` і жодного pi-типу в сигнатурах, крім власне llm-lib.

### 4.4 Env-контракт

Канон лишається робочим (нічого в `~/.zshenv` не ламається):

- Тири: `N_LOCAL_{MIN,AVG,MAX}_MODEL`, `N_CLOUD_{MIN,AVG,MAX}_MODEL` — без змін, це вже
  спільний контракт обох проєктів.
- Нейтральні alias-и для pi/cursor-специфічних імен, старі читаються далі
  (нове ім'я має пріоритет, старе — deprecated у README):
  - `N_LLM_MAX_TOKENS` ← `N_PI_MAX_TOKENS` (дефолт 8192)
  - `N_LLM_TRACE_PATH` ← `N_CURSOR_TRACE_PATH` (дефолт `~/.n-cursor/llm-trace.jsonl`)
  - `N_LLM_TELEMETRY_DIR` ← `N_CURSOR_TELEMETRY_DIR` (дефолт `~/.n-cursor/telemetry`)
  - `N_LLM_FIX_TURN_CEILING` ← `N_CURSOR_FIX_TURN_CEILING` (50)
  - `N_LLM_SKILL_TURN_CEILING` ← `N_CURSOR_SKILL_TURN_CEILING` (80)
  - `N_LLM_SKILL_TIMEOUT_MS` ← `N_CURSOR_SKILL_TIMEOUT_MS` (600000)

## 5. Уніфікація політик (нормативна частина)

1. **Fail-fast скрізь** (рішення зафіксоване; продовження ADR 260620-0556):
   - omlx memory-rejection → миттєвий crash з request-body у stdout (поведінка cursor);
   - connection-помилки → без exponential backoff;
   - knobs 7n-test `N_PI_RETRY_ATTEMPTS`, `N_PI_RETRY_DELAY_MS`,
     `N_PI_MEMORY_RETRY_ATTEMPTS`, `N_PI_MEMORY_RETRY_DELAY_MS` **видаляються** разом
     з `withRetry`-логікою. Наслідок прийнято свідомо: довгі batch-прогони 7n-test на
     перевантаженому omlx падатимуть швидко — оркестратор 7n-test сам вирішує, чи
     перезапускати фазу (retry — відповідальність caller-а, симетрично філософії pi-ai).
2. **Транспорт — тільки pi SDK**: ModelRegistry + `~/.pi/agent/models.json`
   (omlx там уже описаний як custom provider). Прямий omlx-HTTP у `pi-client.mjs`
   7n-test — на викид (повтор рішення cursor «Пункт 3» зі спеки 2026-06-26).
3. **Єдине трасування**: обидва проєкти пишуть у той самий `~/.n-cursor/llm-trace.jsonl`
   у тому самому форматі `{caller, backend, kind, model, usage, error}` — поле `caller`
   розрізняє джерело. Телеметрія фіксів так само глобальна (distillation-маховик §13
   pi-спеки отримує корпус і від 7n-test).

## 6. Міграція consumers (фази)

**Ф1 — пакет + publish.** Створити `llm-lib/` (git mv з `npm/lib/`, rename, internal/),
перенести тести й доки, README з API-таблицею §4.3, налаштувати release/CI (§7),
опублікувати `@7n/llm-lib@1.0.0`. Vitest зелений у новому розташуванні.

**Ф2 — cursor на пакет (механічна).** `@nitra/cursor` додає `@7n/llm-lib` у
dependencies (workspace-протокол локально, semver у publish); import-rewrite у consumers:
`npm/rules/doc-files/docgen-gen/main.mjs`, `npm/rules/doc-files/docgen-judge/main.mjs`,
`npm/rules/text/cspell-fix/fix-worker.mjs`, `npm/scripts/lib/adr/normalize-pipeline.mjs`,
`npm/scripts/lib/lint-surface/default-worker.mjs`, `.../run-fix.mjs`, тести.
`optionalDependencies` на `@earendil-works/*` лишаються у `npm/package.json` (consumer
володіє рішенням про optional — §4.1). Смок: `lint --full` fix-шлях + read-only без pi.

**Ф3 — 7n-test на пакет (найбільший diff).**

- `pi-client.mjs` видаляється: `callText` → `runOneShot` (мапінг: prompt →
  `messages:[{role:'user',...}]`, повернення `.content` замість рядка);
  `callAgent` → `runAgentSkill`;
- `prompt-budget.mjs` видаляється → імпорт з `@7n/llm-lib`;
- розсіяна резолюція моделей (gen-tests, coverage-classify, fix-tests, coverage-fix)
  → `resolveModel(tier)` / явний `modelSpec` з env;
- backoff/retry-код і його env-knobs — на викид (§5.1);
- task-специфіка лишається: verdict-schema (zod), кеш по blob-hash, seed-fallback
  local→cloud у gen-tests, `N_CURSOR_FIX_TESTS_MODEL`/`N_CURSOR_COVERAGE_FIX_MODEL`
  overrides (читаються в 7n-test, передаються як `modelSpec`).

Порядок жорсткий: Ф1 → Ф2 → Ф3; кожна фаза — окремий PR зі своїм зеленим тест-прогоном.
Rollback = git-історія (як у pi-міграції: hard cutover без дуал-бекенда).

## 7. Release/CI

- `npm-publish.yml` тригериться лише на `npm/**` → потрібен другий тригер/workflow для
  `llm-lib/**` (окремий job або матриця; publish `llm-lib/package.json`).
- Відомі граблі відтворити 1-в-1: `persist-credentials: false` + явний
  `git remote set-url` з job-scoped токеном для commit-back; НЕ бампати version вручну
  (брудне дерево фейлить integration-repo-checks — bump робить release-крок у CI).
- Відкрито: чи вміє `bunx n-cursor release` бампати пакет поза `npm/` — перевірити на Ф1;
  якщо ні — мінімальне розширення release-скрипта (шлях пакета параметром).
- Конкурентні авто-релізи на main під час роботи — відома поведінка, врахувати при merge Ф2.

## 8. Ризики й відкриті питання

| Ризик/питання | Позиція |
| --- | --- |
| Version-skew `@nitra/cursor` ↔ `@7n/llm-lib` | cursor пінить `^major`; breaking-зміни API llm-lib = major-бамп + одночасний PR у consumers |
| Bus-factor pi / зміна npm-scope | Мітигується §4.3 (малий нейтральний API-surface); контроль — DoD-grep у Ф2/Ф3 |
| 7n-test без memory-retry падає на зайнятому omlx | Свідомий трейд-оф (§5.1); за потреби retry живе в оркестраторі 7n-test, не в llm-lib |
| Виносити llm-lib у власний репо | Відкладено, не блокує: publish-контракт уже окремий, переїзд репо — механіка |
| Повнота substrate-незалежності | Аудит на Ф2/Ф3: жоден consumer-імпорт не тягне `@earendil-works/*` |
| doc-files доки для перейменованих модулів | Їдуть разом (git mv), CRC перештампувати після rename |
