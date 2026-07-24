# Одне джерело тір-логіки і викликів LLM — Rust-крейт `llm-lib` (нині `llm-cascade`); JS/webview — проєкції через napi/tauri-команди

**Дата:** 2026-07-23
**Статус:** погоджено — готово до реалізації
**Зв'язані документи:** `llm-lib/crates/llm-cascade/src/{acp.rs,tiers.rs}`, `llm-lib/lib/{acp.mjs,model-tiers.mjs}`, `npm/skills/taze/js/orchestrate.mjs` (перший споживач model-контролю ACP), `tauri-components:tauri-plugin-agent/src/acp/mod.rs` (друга Rust ACP-реалізація — поглинається), `tauri-components:npm/src/core/acp-agent-presets.js` (JS-пресети — скасовуються), `task:owner/owner-llm/Cargo.toml` (доказ crate-шляху споживання), `docs/specs/2026-07-16-llm-lib-napi-thin-client-design.md`

## 1. Проблема / Мета

**Тір-логіка і робота з ACP сьогодні існують у трьох копіях:**

1. **JS у `@7n/llm-lib`** — `model-tiers.mjs` (тіри) + `acp.mjs` (тонкий клієнт napi).
2. **Rust у `llm-cascade`** — `tiers.rs` (самоописаний «Rust-порт model-tiers.mjs») + `acp.rs` (one-shot ACP зі спавн-командами-літералами в `AcpAgentKind::command()`).
3. **`tauri-components`** — власна, паралельна Rust ACP-реалізація (`tauri-plugin-agent/src/acp/mod.rs`, session-based з interactive-permissions) + JS-пресети (`CODEX_ACP_AGENT_PRESET` з тірами `MIN/AVG/MAX`).

Копії вже дрейфують (codex-команда: `@latest` у llm-cascade vs без у tauri-components; Cursor-пресету в tauri-components нема взагалі), а `n-taze` не може передати модель ACP-раннерам (`one_shot_acp(kind, prompt, cwd)` — без параметра моделі; фактична модель = персональний конфіг CLI на машині).

**Мета: одна спільна реалізація — Rust-крейт `llm-cascade` — яку використовують і Rust-проєкти, і Node.js-проєкти:**

```
Rust-проєкти (Tauri: task/owner-llm, …) ──crate──> llm-cascade (єдине джерело: tiers, ACP, пресети)
Node-проєкти (@7n/rules, …) ──npm @7n/llm-lib──> napi ──> llm-cascade
webview (tauri-components UI) ──tauri-команди──> плагін-адаптер ──> llm-cascade
```

Crate-шлях споживання вже доведений: `task/owner/owner-llm` бере `llm-cascade = { git = "nitra/7n-rules" }` і використовує `one_shot_acp`, `AcpAgentKind`, `Tier` напряму.

### Історія рішення (три відхилені редакції)

- **Ред. 1 — leaf-пакет `@7n/acp-agent-presets`** (лише JS-дані пресетів). Відхилено: третій npm-пакет заради ~20 рядків.
- **Ред. 2 — схуднення `llm-lib`** (pi/native їде в `@7n/rules`). Відхилено: другий потужний Node-споживач (сценарій `@7n/test`) інвалідує передумову «rules — єдиний споживач специфіки».
- **Ред. 3 — leaf-пакет `@7n/llm-core`** (portable-п'ятірка JS-модулів, llm-lib реекспортує). Відхилено цією редакцією: розв'язка симптоматична — деплікує лише JS-проєкції, лишаючи два Rust ACP і «порт» `tiers.rs` недоторканими; проблема не в тому, як поділити JS-пакети, а в тому, що канон живе не в JS.
- **Ред. 4 (ця) — Rust-first**: `@7n/llm-lib` — це насамперед Rust-реалізація (`llm-cascade`) з napi-обгорткою для Node; `tauri-components` — фронтенд-проєкт, що не тримає власного LLM/ACP-бекенду.

## 2. Ухвалені рішення

| # | Питання | Рішення |
|---|---|---|
| А | Джерело правди | **Rust-крейт `llm-cascade`**: тіри, ACP-транспорт, пресети агентів. JS (`model-tiers.mjs`) і webview — проєкції; дрейф ловиться структурно (napi/команди) або тестом на паритет |
| Б | Пресети агентів | Rust-константи в `llm-cascade`: спавн-команди, канонічний перелік kind-ів (`AcpAgentKind`), тір-мапи `MIN/AVG/MAX` → env/args + UI-лейбли. Node бачить через napi (`getAcpPresets()`), webview — через tauri-команду (`acp_list_tiers`). JS-data-пакет (`llm-core`/`acp-agent-presets`) **не створюється** |
| В | Два режими ACP у крейті | `llm_cascade::acp` розширюється: **one-shot** (auto-approve `pick_auto_permission_option` — headless CLI, як зараз) + **session** (довгоживуча сесія, стрім подій, зовнішній permission-responder — те, що зараз уміє лише плагін). Обидва режими — над спільним транспортом (спавн, initialize, session/new) |
| В.1 | База спільної реалізації | **Session-архітектура плагіна** (`tauri-plugin-agent`) — перевірено, вона архітектурно загальніша: one-shot виводиться з session (не навпаки), екстерналізовані permissions покривають auto-approve як стратегію (не навпаки), `env`-пламбінг (`build_acp_args`), handshake-ready-синхронізація, cancel, capabilities/MCP, StopReason вже готові. **Але з обов'язковим щепленням операційної броні cascade**, якої плагін не має зовсім: idle-timeout на кожен update-read (bug-driven — 57-хв зависання `skill codex taze`), акумуляція тексту для one-shot, `summarize_update`/`N_LLM_ACP_VERBOSE` для headless-логів, типізований `CascadeError` замість `String`, тест-абстракція `AcpSessionUpdates`. Tauri-зчеплення (`AppHandle`/`Emitter`/`State`/event-імена) відшаровується: ядро емить події через callback/канал-трейт, Tauri-emit — в адаптері-плагіні |
| Г | Доля `tauri-plugin-agent` | Лишається в `tauri-components` як **тонкий Tauri-адаптер**: власний ACP-транспорт (`src/acp/mod.rs`) замінюється викликами session-режиму `llm-cascade` (git/crates-dep); Tauri-специфіка (emit подій у webview, стейт responder-ів, permissions-скоупи) — його єдиний вміст. Повний переїзд плагіна в репо `7n-rules` — відкладено (відкрите питання) |
| Д | `tauri-components` = фронтенд | npm-пакет втрачає останнє знання про моделі: `acp-agent-presets.js` видаляється, тір-пікер стає generic-компонентом, що рендерить те, що віддав бекенд командою. UI-лейбли («GPT-5.6 Terra») їдуть з Rust-пресетів |
| Е | Тір-логіка JS | Канон — `tiers.rs`; `model-tiers.mjs` **одразу замінюється napi-викликом** (рішення 2026-07-24, зняте з відкритих питань): JS-шар делегує тір-резолвінг у Rust через napi, власна тір-мапа з `model-tiers.mjs` зникає; zero-native імпорт свідомо втрачається |
| Ж | Canonical codex-команда | `npx -y @agentclientprotocol/codex-acp@latest` — фіксується один раз у Rust-пресеті |
| З | Cursor-пресет | Новий (ніде не існував): команда `agent acp`, тір через extra-arg `--model <id>` (працює і як глобальний прапорець, і після підкоманди `acp` — підтверджено R1 смок-тестом). Тіри (точні id з `cursor-agent --list-models`, R1 2026-07-24; каталог завжди несе ефорт-суфікс, bare-імена резолвляться fuzzy-фолбеком — не покладатися): **MIN = `gpt-5.6-luna-low`, AVG = `cursor-grok-4.5-medium` (префікс `cursor-` обовʼязковий), MAX = `gpt-5.6-sol-max`** |
| З.1 | Pi-пресет (за R1) | Спавн: `npx -y pi-acp` (npm-пакет **`pi-acp`**, без scope; він сам спавнить `pi --mode rpc`). Тір-механізм — **не** env/args на спавні, а протокольний виклик `session/set_config_option` (`configId: "model"`, `value: "<provider>/<modelId>"`) між `session/new` і `session/prompt` — session-шар крейта має підтримувати опційний post-session-creation config-крок. Тіри через провайдер `openai-codex` (pi підхоплює `~/.codex/auth.json`): MIN = `openai-codex/gpt-5.6-luna`, AVG = `openai-codex/gpt-5.6-terra`, MAX = `openai-codex/gpt-5.6-sol`. Передумова: codex-логін на машині; без нього — fallback на дефолт pi |
| И | `n-taze` model-контроль | `runAcpAgent(kind, prompt, cwd, {tier})` — napi приймає тір, Rust сам резолвить tier→env/args з пресету. JS-хелпер «пресет→env» не потрібен |
| К | `MIN/AVG/MAX` — спільний підхід для **всіх** типів викликів | Єдиний `Tier`-enum крейта — універсальний інтерфейс вибору потужності: колер завжди каже `tier`, ніколи конкретну модель (модель — лише явний override). **Резолвінг** тіру — свій на тип: Тип 1 → пресет агента (env/args), Типи 2a/2b → `resolve_model` (`N_LOCAL/CLOUD_*_MODEL`), Тип 3 → наявні pi-тіри JS-шару. Каталоги моделей різні (підписка vs API-ключ) і не зливаються — спільною є абстракція, не мапи |
| Л | Permission-семантики співіснують | one-shot auto-approve і interactive-responder — не «різні дизайни в різних репо», а два легітимні режими одного крейта (рішення В); плагін обирає session+interactive, CLI — one-shot+auto |
| М | Неймінг: крейт → `llm-lib` | Крейт `llm-cascade` перейменовується на **`llm-lib`** (`llm_lib::`), napi-крейт — `llm-lib-napi`, `CascadeError` → `LlmError`. Rust-крейт і npm-пакет (`@7n/llm-lib`) носять одне імʼя — «llm-lib це насамперед Rust-реалізація з napi-обгорткою», а не окремий продукт із власною назвою. Platform-пакети (`@7n/llm-lib-*`) вже відповідають. Споживачі git-dep (`task/owner-llm`) мігрують координовано (Cargo dependency-alias `llm-cascade = { package = "llm-lib" }` — місток на перехід) |
| Н | Типологія викликів LLM — вичерпна, формалізована в `llm-lib` | **Усі** виклики LLM в екосистемі — один із типів §3.0 (1 / 2a / 2b / 3); застосунки не пишуть власних клієнтів (анти-приклад: `mlmail` сам читає `~/.omlx/settings.json` і б'є в ендпоінт напряму — саме тому, що спільної точки не було) |
| П | Дистрибуція крейта | **git-dep з tag-конвенцією** (тег `llm-lib-v<semver>` у репо `7n-rules`); crates.io — не зараз. Споживачі пінять tag, не `rev` |
| Р | Обсяг 2b у v1 | **Лише емуляція** (чанкований конкурентний прогін через 2a під інтерфейсом `submit → progress → results`) — перший споживач doc-files ганяє локальний omlx, якому справжній `/v1/batches` недоступний. Справжній `/v1/batches` — v2 |

## 3. Деталі реалізації

### 3.0 Типологія викликів LLM (рішення Н)

| Тип | Що це | Rust | Node.js | Стан сьогодні |
|---|---|---|---|---|
| **1 — ACP** (головний) | Спавн залогіненого агентського CLI (**codex, cursor, pi**) по stdio/JSON-RPC; особиста підписка, повний агентський цикл з тулзами | `llm_lib::acp` (crate) | napi → той самий Rust | Розсипано: `acp.rs` (cursor/codex), плагін (довільні команди, згадує `pi-acp`/`claude-agent-acp`), `mlmail/call_analysis.rs` (ручний спавн `pi --print` сабпроцесом) |
| **2a — OpenAI-сумісний API, sync** | Прямий HTTP до OpenAI-compatible ендпоінта (`chat/completions`): локальні (omlx) і хмарні провайдери; без агентського циклу | `llm_lib::local_cloud` (**вже реалізовано** — genai, кастомні ендпоінти + хмара) | napi → той самий Rust (новий експорт `oneShotLocalCloud`) | Rust-ядро є, але напряму недоступне застосункам поза crate-шляхом: `mlmail` тримає власний ad-hoc клієнт (читає `~/.omlx/settings.json` сам) |
| **2b — OpenAI-сумісний API, batch** | Batch-механізм того ж ендпоінт-сімейства: OpenAI Batch API (`/v1/batches` + JSONL-файли, async submit → poll → results, дешевший тариф) — для масових офлайн-задач без інтерактивності | `llm_lib::batch` (новий модуль поруч із `local_cloud`) | napi → той самий Rust | Перший реальний споживач **вже є**: lint/doc-files у `@7n/rules` — скан бачить N змінених файлів без актуальної доки і сьогодні жене генерацію послідовно по одному, а має віддавати одним batch-ом. Плюс застосунки винаходять **client-side** батчинг вручну — `mlmail/use-summary.js` чанкує переклади проти omlx з вистражданими лімітами (деградація >35 айтемів, зависання на 80) |
| **3 — pi як npm** (суто Node) | JS-шар поверх `@earendil-works/pi-ai`/`pi-coding-agent`: `one-shot.mjs`, `agent-skill`, `agent-fix`, `harness`, write-guard/trace/telemetry | — (принципово недоступний: pi-екосистема — npm) | `@7n/llm-lib` npm, як є | Єдиний тип без дублювання — лишається чисто JS-шаром пакета |

Наслідки таксономії:
- Перелік ACP-kind-ів розширюється: `AcpAgentKind` = `Cursor | Codex | Pi` (підтверджено R1; спавн pi-ACP — окремий npm-пакет `pi-acp`, сам `pi` ACP-режиму не має, лише власний `--mode rpc`; deprecated `claude`-шим у `@7n/rules` — поза таксономією, доживає окремо).
- Типи 1 і 2 (обидва підтипи) мають **однакову доступність** для Rust і Node — через одне Rust-ядро; Тип 3 — свідомо Node-only, і це його визначальна межа, а не недолік.
- 2b: справжній Batch API підтримують хмарні провайдери; для локальних (omlx) без `/v1/batches` модуль дає **емуляцію** — чанкований конкурентний прогін через 2a з лімітами розміру чанка/конкурентності (узагальнення того, що mlmail вивів емпірично) — той самий інтерфейс `submit → progress → results` незалежно від того, батчить сервер чи клієнт.
- Застосунки (mlmail, task, майбутні) обирають тип, а не реалізацію: міграція mlmail з ad-hoc клієнта на Тип 2a, ручного чанкінгу перекладів на 2b і ручного `pi --print` на Тип 1 — окремі задачі поза цією спекою (кандидати вписані в success signals).

### Ф1 — session-режим і пресети в `llm-lib` (крейт)

1. Рефакторинг `acp.rs` **на базі session-архітектури плагіна** (рішення В.1): портується скелет `tauri-plugin-agent/src/acp/mod.rs` — спавн з env (`build_acp_args`), initialize+session/new з handshake-ready-синхронізацією, mpsc-цикл команд (prompt/cancel), екстерналізований permission-responder, StopReason-мапінг — **без** Tauri-специфіки (події через callback/канал-трейт замість `Emitter`, типізований `CascadeError` замість `String`). Зверху — два фасади: `one_shot_acp` (session з одним prompt + auto-approve-стратегія + акумуляція тексту) і публічний session-API. Операційна броня cascade зберігається і поширюється на session-режим: idle-timeout на кожен update-read, `summarize_update`/`N_LLM_ACP_VERBOSE`, тест-абстракція `AcpSessionUpdates` + наявні тести (idle-timeout, fail-fast спавн, permission-picker) + плагінні тести чистих хелперів.
2. Модуль пресетів: `AcpAgentKind` + `command()` + тір-мапи (`Min/Avg/Max` → env для codex `CODEX_CONFIG`, args для cursor `--model`) + UI-лейбли. Юніт-тести.
3. Перейменування (рішення М): `crates/llm-cascade` → `crates/llm-lib`, `llm-cascade-napi` → `llm-lib-napi`, `CascadeError` → `LlmError`; dependency-alias-місток для git-споживачів на перехідний період.
4. Semver-дисципліна крейта: це стає публічним контрактом для ≥3 споживачів (napi, плагін, owner-llm) — фіксувати tag-конвенцію для git-dep.

### Ф2 — napi + JS-шар `@7n/llm-lib`

Тип 1: `oneShotAcp(kind, prompt, cwd, tierOrEnv)` — розширена сигнатура (kind-и включно з `pi`); `getAcpPresets()` — експорт пресетів у JS (для UI/звітів); `runAcpAgent(kind, prompt, cwd, {tier})` у `acp.mjs`. Тип 2: новий napi-експорт `oneShotLocalCloud(modelSpec | {tier}, prompt)` поверх `llm_lib::local_cloud` — Node-шлях до OpenAI-сумісних викликів без pi. `model-tiers.mjs` замінюється napi-делегацією в `tiers.rs` (рішення Е). Minor-бамп npm.

### Ф3 — `n-taze` бере тір

`orchestrate.mjs` (`callRunner`): для `runner !== 'pi'` — `runAcpAgent(runner, prompt, cwd, {tier: 'avg'})` (паритет із `tier: 'avg'` pi-гілки).

### Ф4 — `tauri-plugin-agent` на `llm-cascade` (репо tauri-components, окрема сесія)

`src/acp/mod.rs`: власний транспорт (клієнт-білдер, initialize, session-цикл) замінюється session-API крейта; лишаються Tauri-emit (`acp://session-update`, `acp://permission-request`), стейт responder-ів, permission-скоупи. `Cargo.toml`: `llm-cascade = { git = "nitra/7n-rules", tag = … }`.

### Ф5 — `tauri-components` npm стає чисто фронтендним (те саме репо, слідом за Ф4)

Нова tauri-команда `acp_list_tiers` у плагіні (віддає kind-и/тіри/лейбли з Rust-пресетів); `useAcpAgent()` приймає `{kind, tier}` замість `{command, args, env}`; `npm/src/core/acp-agent-presets.js` видаляється (minor/major за політикою пакета).

Послідовність: Ф1 → Ф2 → Ф3 у цьому репо, окремими PR (bisect-безпека). Ф4 → Ф5 — у `tauri-components`, після тега Ф1. Споживачі типу `task` мігрують на нові версії плагіна/крейта у своєму темпі — старі git-`rev`-піни продовжують працювати.

### Success signals

- `rg "AcpAgentKind|CODEX_CONFIG|agent acp"` знаходить спавн-команди й тір-мапи **лише** в крейті `llm-lib` (+ тести на паритет).
- `skill codex taze` реально ганяє major-запис через модель тіру `avg`, а не через те, що лишилось у `~/.codex/config.toml`.
- `tauri-plugin-agent` не містить власного ACP-протокольного коду — тільки Tauri-адаптацію.
- Прогін застосунку `task` на оновленому плагіні — без функціональних регресій chat/permissions.
- Кожен виклик LLM у екосистемі відноситься рівно до одного з типів §3.0 (1 / 2a / 2b / 3); довгостроково: `mlmail` мігрує ad-hoc omlx-клієнт на 2a, ручний чанкінг перекладів на 2b і ручний `pi --print`-міст на Тип 1 (окремі задачі у своєму репо).

## 4. Задачі для передачі субагентам

Кожна задача — окремий PR з незалежним приймальним критерієм; порядок стрілками. Дослідницькі (R\*) — без коду в main, результат = звіт/фіксація в цій спеці.

### Дослідження (перед або паралельно з Ф1)

| ID | Задача | Приймання |
|---|---|---|
| R1 | pi-ACP: чи має pi ACP-режим/міст, команда спавну, механізм вибору моделі; заодно підтвердити точний CLI-спелінг Cursor-id (`cursor-agent --list-models`): `gpt-5.6-luna`/`grok-4.5`/`gpt-5.6-sol` | Смок-тест реального спавну; оновлені рішення З та перелік kind-ів у спеці |
| R2 | Пошук зовнішніх git-споживачів `llm-cascade` по org (крім `task`) | Список репо → скільки alias-містків потрібно для T4 |

### Основна послідовність (репо `7n-rules`)

| ID | Фаза | Задача | Приймання |
|---|---|---|---|
| T1 | Ф1a | Транспортний рефакторинг `acp.rs`: спільний шар spawn/init/session + env-префікси (`build_acp_args`-патерн); `one_shot_acp` зберігає поведінку (idle-timeout, auto-permission, progress-логування) | Наявні тести зелені; нові тести на env-префікси в argv |
| T2 | Ф1b | Session-API крейта: create/prompt/update-стрім/зовнішній permission-responder/cancel; без tauri-залежностей | API покриває повний перелік потреб плагіна (`tauri-plugin-agent/src/acp/mod.rs`); тести на fake-сесії, включно з idle-timeout |
| T3 | Ф1c | Пресети: `AcpAgentKind = Cursor\|Codex\|Pi` + тір-мапи (codex: `CODEX_CONFIG` luna/terra/sol; cursor: `--model` за рішенням З; pi: за рішенням З.1 — **не** env/args, а post-session виклик `session/set_config_option` з `provider/modelId`, пресет повертає маркер цього кроку) + UI-лейбли; єдиний `Tier`-enum для всіх типів (рішення К) | Юніт-тести мап; паритет-тест з JS-пресетом tauri-components (до Ф5) |
| T4 | Ф1d | Перейменування: `crates/llm-cascade` → `crates/llm-lib`, `llm-cascade-napi` → `llm-lib-napi`, `CascadeError` → `LlmError`; tag `llm-lib-v<semver>`; alias-містки за R2 | `task/owner-llm` збирається через alias без правок коду |
| T5 | Ф2 | napi+JS: `oneShotAcp(kind, prompt, cwd, {tier})`, `getAcpPresets()`, `oneShotLocalCloud` (Тип 2a для Node); `model-tiers.mjs` → napi-делегація в `tiers.rs` (рішення Е) | Тести JS-шару; minor-бамп npm |
| T6 | Ф2b | `llm_lib::batch` — емуляція (рішення Р): `submit(items) → progress → results`, ліміти чанка/конкурентності конфігуровані; napi-експорт; бенч-калібрування дефолтів на omlx (старт: чанк ≤35) | Бенч-звіт; тести на чанкування/помилку одного чанка (не валить batch) |
| T7 | Ф3 | `n-taze`: `callRunner` для `runner !== 'pi'` → `runAcpAgent(runner, prompt, cwd, {tier: 'avg'})` | Живий прогін `skill cursor\|codex taze` використовує модель тіру, не CLI-конфіг |
| T8 | Ф3b | doc-files: перехід генерації з послідовної на 2b-batch (N файлів одним submit) | Прогін `/doc-files` на ≥5 змінених файлах через batch-шлях; час ↓ проти послідовного |

### Репо `tauri-components` (після тега T4)

| ID | Фаза | Задача | Приймання |
|---|---|---|---|
| T9 | Ф4 | Плагін на session-API крейта: викинути власний ACP-транспорт, лишити Tauri-emit/стейт/permissions | Нуль ACP-протокольного коду в плагіні; прогін застосунку `task` без регресій chat/permissions |
| T10 | Ф5 | npm frontend-only: команда `acp_list_tiers`, `useAcpAgent({kind, tier})`, видалення `acp-agent-presets.js` | UI-пікер рендерить тіри з бекенда; нуль model-знання в npm-пакеті |

## Відкриті питання

Рішення Cursor-тіри / дистрибуція / обсяг 2b — закриті, перенесені в рішення З/П/Р; інтеграція doc-files — тепер задача T8.

**Закриваються дослідженням (задачі R1–R2 у §4):**
- ~~pi-ACP пресет (команда спавну, тір-механізм) — R1.~~ **Закрито R1 (2026-07-24):** рішення З.1; смок-тест повного циклу `initialize → session/new → set_config_option(model) → prompt` пройшов на реальному спавні `npx -y pi-acp`.
- ~~Точний CLI-спелінг Cursor model-id — R1.~~ **Закрито R1 (2026-07-24):** рішення З; смок-тест `cursor-agent acp` з `--model` пройшов повний цикл.
- ~~Зовнішні git-споживачі `llm-cascade` поза `task` — R2.~~ **Закрито R2 (2026-07-24):** зовнішніх git-dep-споживачів поза `task` немає (org-wide code search + локальний скан). Єдиний споживач — `task/owner/owner-llm` (`llm-cascade = { git = "nitra/7n-rules" }` без tag/rev; де-факто пін — commit-SHA у `Cargo.lock`). Для T4 потрібен **один** alias-місток (`llm-cascade = { package = "llm-lib", … }`), тимчасовий — до explicit-міграції `task` на нове імʼя + tag-пін `llm-lib-v<semver>`. `tauri-plugin-agent` стане споживачем лише в T9, вже на імені `llm-lib` (alias не потрібен).

**Свідомо відкладені (не блокують реалізацію):**
- Повний переїзд `tauri-plugin-agent` у репо `7n-rules` — переглянути після T9/T10, коли плагін стане тонким.
- Durability довгих батчів (batch-id, survive-restart) — потрібне лише справжньому `/v1/batches`, тобто v2.
- Публікація крейта на crates.io — переглянути, якщо з'являться споживачі поза org.
- Синхронізація версії `agent-client-protocol` між крейтом і споживачами — операційна конвенція, узгодити темп оновлень.
- Темп міграції mlmail на Типи 1/2a/2b — окреме репо, окремий власник; тут лише зафіксовано напрям.
