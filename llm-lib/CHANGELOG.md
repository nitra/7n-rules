# Changelog

## [3.0.0] - 2026-08-05

### Fixed

- onProgress-колбек submitBatch тепер отримує (completed, total) як два числа, не (null, [completed, total]) — napi ThreadsafeFunction конвертувала tuple у JS-масив замість розгортання в окремі аргументи
- README/tiers.rs: застарілий дефолт N_LLM_LOCAL_PROVIDERS (omlx) виправлено на актуальний local-openai; README тепер документує generic-слот local-openai (N_LOCAL_OPENAI_BASE_URL/API_KEY)

### Removed

- submitBatch: вилучено клієнтську емуляцію batch (chunkSize/concurrency/backend-опції). Batch завжди йде через реальний /v1/batches резолвленого провайдера; провайдер без зареєстрованого base_url/api_key тепер повертає явну помилку замість тихого фолбеку на емуляцію

## [2.14.17] - 2026-08-04

### Changed

- release: @7n/llm-lib@2.14.16, @7n/rules@1.80.0

## [2.14.16] - 2026-08-04

### Fixed

- Loader napi-аддона (`lib/internal/native.mjs`) у вихідному дереві репо (маркер `llm-lib/crates/llm-lib-napi/Cargo.toml`) резолвить локальну збірку `target/release|debug` ПЕРЕД опублікованим підпакетом `@7n/llm-lib-<platform>-<arch>` — раніше свіжий `cargo build -p llm-lib-napi` мовчки перекривався registry-бінарем із `node_modules`, і правки Rust-ядра не проявлялися. У встановленому пакеті порядок незмінний: підпакет лишається авторитетним джерелом

## [2.14.15] - 2026-08-04

### Fixed

- `cargo fmt` для `crates/llm-lib/src/batch.rs` — два `providers.insert(...)` у тестах local-cloud каскаду лишились неформатованими після додавання нового локального провайдера і валили `cargo fmt --all -- --check` (гейти `Lint Rust` і `rust/check` у `Lint repo-wide`)

## [2.14.14] - 2026-08-03

### Changed

- feat(llm-lib): add turbofieldfare local provider (#374); chore(release): синк пінів платформних napi-пакетів @7n/llm-lib

## [2.14.13] - 2026-08-03

### Changed

- chore(release): синк пінів платформних napi-пакетів @7n/llm-lib

## [2.14.12] - 2026-08-01

### Changed

- chore(release): синк пінів платформних napi-пакетів @7n/llm-lib

## [2.14.11] - 2026-08-01

### Changed

- chore(release): синк пінів платформних napi-пакетів @7n/llm-lib

## [2.14.10] - 2026-08-01

### Changed

- chore(release): синк пінів платформних napi-пакетів @7n/llm-lib

## [2.14.9] - 2026-08-01

### Changed

- chore(release): синк пінів платформних napi-пакетів @7n/llm-lib

## [2.14.8] - 2026-08-01

### Changed

- chore(release): синк пінів платформних napi-пакетів @7n/llm-lib

## [2.14.7] - 2026-08-01

### Changed

- chore(release): синк пінів платформних napi-пакетів @7n/llm-lib

## [2.14.6] - 2026-08-01

### Changed

- chore(release): синк пінів платформних napi-пакетів @7n/llm-lib

## [2.14.5] - 2026-08-01

### Changed

- chore(release): синк пінів платформних napi-пакетів @7n/llm-lib

## [2.14.4] - 2026-07-31

### Changed

- chore(release): синк пінів платформних napi-пакетів @7n/llm-lib

## [2.14.3] - 2026-07-31

### Changed

- chore(release): синк пінів платформних napi-пакетів @7n/llm-lib

## [2.14.2] - 2026-07-31

### Changed

- chore(release): синк пінів платформних napi-пакетів @7n/llm-lib

## [2.14.1] - 2026-07-31

### Changed

- chore(release): синк пінів платформних napi-пакетів @7n/llm-lib

## [2.14.0] - 2026-07-31

### Changed

- Rust-крейт `llm-lib`: feature-split (Р9 спеки rules-v2) — `agents` (у default) гейтить важкі залежності (`genai`/`tokio`/`reqwest`/`agent-client-protocol`) для `acp`/`local_cloud`/`batch`/`remote_batch`; `tiers` лишається завжди доступним (лише serde/thiserror), плюс новий `tiers::is_local_model` (порт `isLocalModel` з `model-tiers.mjs`). `llm-lib-napi` не чіпає `default-features` — збирається без змін

## [2.13.12] - 2026-07-31

### Changed

- chore(release): синк пінів платформних napi-пакетів @7n/llm-lib

## [2.13.11] - 2026-07-31

### Changed

- chore(release): синк пінів платформних napi-пакетів @7n/llm-lib

## [2.13.10] - 2026-07-31

### Fixed

- Виправлено busy-loop ACP bridge на повторюваних terminal activity events
- Обмежено тривалість ACP ходу незалежно від progress events, щоб resolver не зависав на нескінченному потоці оновлень.

## [2.13.9] - 2026-07-30

### Fixed

- apiKey local-провайдерів приймає й серверну конвенцію без префікса (OMLX_API_KEY/LITELLM_API_KEY, N_-префікс має пріоритет) — оточення з auth-увімкненим omlx-server знову працює без ручного аліасингу

## [2.13.8] - 2026-07-30

### Fixed

- acp: one-shot завершується за terminal turn (StopReason), гарантований teardown дочірнього ACP-процесу і робочий idle-timeout під flood подій — фікс зависання git-reconcile×Codex

## [2.13.7] - 2026-07-30

### Fixed

- Уніфіковано LLM model resolution у execution consumers та оновлено native addon для env-selector policy.

## [2.13.6] - 2026-07-30

### Changed

- chore(release): синк пінів платформних napi-пакетів @7n/llm-lib

## [2.13.5] - 2026-07-30

### Fixed

- обмежено git-reconcile remediation точним failing scope та заборонено LLM full gates

## [2.13.4] - 2026-07-29

### Changed

- release: @7n/llm-lib@2.13.3, @7n/rules-lang-js@0.24.2, @7n/rules@1.57.4; fix(llm-lib): підтягнути піни платформних napi-пакетів до опублікованої 2.13.2 (#294); fix(js/eslint): guard identity tagged-template tags from LLM autofix (#293)

## [2.13.3] - 2026-07-29

### Fixed

- Піни платформних napi-пакетів (`optionalDependencies` + версії `llm-lib/packages/*`) підтягнуто до опублікованої 2.13.2: git застряг на 2.9.7 (збірки до уніфікації model resolution), через що install монорепо тягнув несумісний prebuilt addon — 42 фейли повного `bun run test` і червоний Lint repo-wide

## [2.13.2] - 2026-07-29

### Changed

- Уніфіковано вибір моделей через `resolveModel`: явні local/cloud selectors
використовують спільну Rust-драбину, а one-shot і agent runners вимагають
tier або explicit model policy.

## [2.13.1] - 2026-07-29

### Fixed

- local-providers.test: герметизація від ambient N_OMLX_*/N_LITELLM_* env (тест «без env» падав на машинах зі справжнім N_LITELLM_API_KEY)

## [2.13.0] - 2026-07-29

### Changed

- llm-lib v0.2.3: pi-тіри переглянуто (рішення З.1) — min/avg тепер локальні моделі (omlx/gemma-4-e4b-it-OptiQ-4bit, litellm/gemma-4-26b-awq через llm.7n.ai), max лишається openai-codex/gpt-5.6-sol; передумова — провайдери omlx/litellm у pi models.json

## [2.12.3] - 2026-07-29

### Fixed

- acp: неблокуюче stderr-логування (окремий потік) — конкурентні ACP-сесії більше не стопорять tokio-задачі через переповнений stdio-pipe

## [2.12.2] - 2026-07-29

### Fixed

- acp: create_session тепер завжди повертає реальну помилку handshake (напр. auth cursor-agent), а taze не повторює той самий провалений ACP-виклик по кожному major-пакету

## [2.12.1] - 2026-07-29

### Changed

- Виправлено правопис у документації для NAPI.

## [2.12.0] - 2026-07-28

### Changed

- llm-lib v0.2.3: pi-тіри переглянуто (рішення З.1) — min/avg тепер локальні моделі (omlx/gemma-4-e4b-it-OptiQ-4bit, litellm/gemma-4-26b-awq через llm.7n.ai), max лишається openai-codex/gpt-5.6-sol; передумова — провайдери omlx/litellm у pi models.json
- release: @7n/llm-lib@2.10.1, @7n/rules@1.52.1, @7n/rules-lang-js@0.23.1
- Механічно додано change-файл для поточних змін у workspace.

## [2.11.0] - 2026-07-27

### Added

- `submitBatch` тепер обирає між клієнтською емуляцією і справжнім `/v1/batches` litellm batch-adapter-а (`backend: 'auto'|'emulated'|'openai-batches'`) — автоматично вмикається, коли резолвлений провайдер `litellm` і адаптер відповідає на capability-пробу.

## [2.10.1] - 2026-07-27

### Fixed

- Smoke-тест `resolveModel` через живий napi-аддон стабільний під `bun run --bun vitest`: каскад ганяється в дочірньому процесі з env при spawn, бо Bun не передає записи `process.env` у нативний environ (Rust `env::var` бачив ambient-значення замість `vi.stubEnv`)

## [2.10.0] - 2026-07-27

### Added

- llm-lib: додано litellm як другий local-provider (перемикач omlx/litellm через `N_LOCAL_*_MODEL`, `defaultLocalProviders()` з `N_OMLX_*`/`N_LITELLM_*` env)

## [2.9.9] - 2026-07-27

### Fixed

- install matching native addon packages

## [2.9.8] - 2026-07-27

### Changed

- md

## [2.9.7] - 2026-07-26

### Fixed

- ACP semantic idle timeout більше не подовжується шумними progress events.

## [2.9.6] - 2026-07-26

### Fixed

- Додано кероване приглушення дубльованих ACP progress events для оркестраторів із власним progress UI.

## [2.9.5] - 2026-07-26

### Fixed

- Додано безпечну telemetry batch verdict для coverage timeout-ів.

## [2.9.4] - 2026-07-26

### Fixed

- Додано безпечну telemetry batch verdict для coverage timeout-ів.

## [2.9.3] - 2026-07-26

### Fixed

- ACP transport очищає успадкований `npm_config_package` для вкладеного `npx`, щоб Codex і Pi агенти запускалися з `npm exec --package`.

## [2.9.2] - 2026-07-26

### Fixed

- Pi transport errors із `message_end` більше не маскуються як порожнє успішне завершення.

## [2.9.1] - 2026-07-25

### Fixed

- Виправлено profile генерації тестів для survived Stryker-мутантів

## [2.9.0] - 2026-07-25

### Added

- acp: публічний session-API (create_session/prompt/cancel, стрім SessionEvent, зовнішній permission-responder, опційний post-session config-крок для Pi); one_shot_acp — фасад над session
- acp: пресети агентів — AcpAgentKind::Pi (npx -y pi-acp), тір-мапи Codex (CODEX_CONFIG luna/terra/sol), Cursor (--model з ефорт-суфіксами), Pi (post-session provider/modelId), UI-лейбли; one_shot_acp_with_tier
- napi/JS: oneShotAcp(kind, prompt, cwd, {tier}) з kind 'pi', getAcpPresets(), oneShotLocalCloud (Тип 2a, модуль ./local-cloud); model-tiers.mjs: resolveModel — napi-делегація в tiers.rs
- llm_lib::batch — емуляція Типу 2b (submit → progress → results, чанк 35/конкурентність 2, помилка item не валить batch); napi submitBatch з ThreadsafeFunction-прогресом; JS-модуль ./batch

### Changed

- acp: транспортний шар spawn/init/session виділено в acp/transport.rs (build_acp_args: env-префікси + extra-args), one_shot_acp — тонкий фасад без зміни поведінки
- Rust-крейти перейменовано: llm-cascade → llm-lib, llm-cascade-napi → llm-lib-napi, CascadeError → LlmError; napi-артефакти llm-lib-napi.`triple`.node; git-споживачам — dependency-alias llm-cascade = { package = "llm-lib" }

### Fixed

- Виправлено profile генерації тестів для survived Stryker-мутантів

## [2.8.8] - 2026-07-24

### Changed

- doc_comments rollout: header-JSDoc у vitest.config

## [2.8.7] - 2026-07-23

### Changed

- doc_comments rollout: header-JSDoc у vitest.config

## [2.8.6] - 2026-07-23

### Changed

- doc_comments rollout: header-JSDoc у vitest.config

## [2.8.5] - 2026-07-23

### Changed

- doc_comments rollout: header-JSDoc у vitest.config

## [2.8.4] - 2026-07-22

### Changed

- doc_comments rollout: header-JSDoc у vitest.config

## [2.8.3] - 2026-07-19

### Changed

- fix(acp): тихий прогрес ACP-подій за замовчуванням (без raw_input/raw_output тулзів і потокенний thought-стрім не логується); повний Debug — через N_LLM_ACP_VERBOSE=1

## [2.8.2] - 2026-07-19

### Changed

- fix(llm-lib): `getRegistry()` — перехід на `ModelRuntime.create()` + `new ModelRegistry(runtime)` замість застарілого `ModelRegistry.create(AuthStorage.create())`, сумісного з `@earendil-works/pi-coding-agent@0.80.10`

## [2.8.1] - 2026-07-18

### Changed

- Оновлено peer-версію @earendil-works/pi-coding-agent/pi-ai до ~0.80.10 — підтримка gpt-5.6-sol через openai-codex backend

## [2.8.0] - 2026-07-18

### Added

- Дистрибуція napi-аддона `llm-cascade`: нові платформені пакети `@7n/llm-lib-darwin-arm64` і `@7n/llm-lib-linux-x64` (prebuilt `llm-cascade-napi.<triple>.node`, matrix-збірка в npm-publish) підключені як optionalDependencies — `runAcpAgent`/tiers/local_cloud працюють із реєстрового @7n/llm-lib без локальної cargo-збірки.

## [2.7.6] - 2026-07-18

### Fixed

- `runOneShot`/`runAgentSkill` з нерозв'язаним `modelSpec` (`''`/`null` — consumer лишає вибір pi) більше не потрапляють у `chain.note()` як `model: ''`, через що `chain.mjs` мовчки класифікував їх cloud (`isLocalModel('') === false`) навіть коли pi фактично резолвив локальну модель. Тепер обидва раннери підставляють фактично резолвлену pi-модель (`session.model`, нове `formatModelSpec`), а `chain.note()` для випадків, коли резолвлена модель усе ж недоступна, веде окремий бакет `unknownCalls` замість неявного cloud.

## [2.7.5] - 2026-07-17

### Fixed

- `llm_cascade::acp` — дока (`src/docs/acp.md`) синхронізована з поточним кодом (CRC-дрейф без функціональних змін).

## [2.7.4] - 2026-07-17

### Fixed

- `llm_cascade::acp::one_shot_acp` — idle-timeout на кожну `session/update`-подію (за замовчуванням 180с, override `N_LLM_ACP_IDLE_TIMEOUT_MS`) замість необмеженого очікування: без нього будь-яке нове зависання (не лише вже виправлений дозвіл) знову лишалось би невидимим і нескінченним. Не-текстові події (`tool_call`/`plan`/`usage_update`/…) тепер логуються в stderr — раніше `read_to_string()` мовчки їх відкидав

## [2.7.3] - 2026-07-16

### Fixed

- `llm_cascade::acp::one_shot_acp` — додано хендлер `session/request_permission` (auto-approve, паритет із `yolo_one_shot_client`-прикладом крейта): без нього агент, дійшовши до першого tool-call (bash/edit), зависав назавжди — запит на дозвіл лишався без відповіді

## [2.7.2] - 2026-07-16

### Changed

- llm-lib(llm-cascade): міграція на agent-client-protocol 1.2 (крейт agent-client-protocol-tokio знято апстрімом, AcpAgent перенесено в головний крейт)

## [2.7.1] - 2026-07-16

### Fixed

- `llm_cascade::acp::one_shot_acp` — додано обов'язковий `InitializeRequest`-хендшейк перед створенням сесії (без нього реальний ACP-агент відповідав `Internal error: Not initialized`; попередні тести не ловили це, бо перевіряли лише fail-fast на неіснуючу команду, не реальний round-trip)

## [2.7.0] - 2026-07-16

### Added

- `runAcpAgent`/`resolveModel`/`oneShotLocalCloud` (`@7n/llm-lib/acp`) — napi-міст до Rust-крейта `llm_cascade` (`llm-lib/crates/llm-cascade-napi`): ACP-виклик `cursor`/`codex`, каскад тирів і local/cloud chat-виклик в одному процесі, без повторної реалізації протоколу в JS

## [2.6.2] - 2026-07-14

### Added

- llm-cascade: файлові доки (docs/*.md) для src і examples — 7 нових док за стилем doc-files

## [2.6.1] - 2026-07-13

### Changed

- 🔧 fix(main): прибрано @nitra/cursor, повернутий у devDeps паралельним запуском старого CLI

## [2.6.0] - 2026-07-13

### Added

- Новий Rust-крейт `crates/llm-cascade` — той самий env-контракт (`N_LOCAL_*`/`N_CLOUD_*` тири) для проєктів без Bun/Node (Tauri webview, agent-server). Три fail-fast примітиви без вбудованого retry: `tiers::resolve_model` (порт `model-tiers.mjs`), `local_cloud::LocalCloud` (один HTTP-виклик через `genai`, кастомний ендпоінт для omlx), `acp::one_shot_acp` (доступ до потужних моделей через особисту підписку — Cursor CLI нативно, Codex через офіційний міст `@agentclientprotocol/codex-acp` — без API-ключа). Обидва бекенди перевірено живими викликами.

## [2.5.1] - 2026-07-12

### Fixed

- live-e2e фікси петлі MT→pi-harness (2026-07-12): telemetry-store pruneNoopEdits — no-op пари (oldText===newText, слабка 4B переклеює рядок сам на себе) не пишуться у distillation-стор

## [2.5.0] - 2026-07-11

### Changed

- body-capture (N_LLM_TRACE_BODIES) увімкнено за замовчуванням; N_LLM_TRACE_BODIES=0 вимикає

## [2.4.1] - 2026-07-11

### Fixed

- test/lint: SSRF-фікстури web-tools.test будуються динамічно (http/IP-літерали фейлили full-lint no-insecure-url/no-hardcoded-ip); словникові слова A1-A4 у .cspell.json

## [2.4.0] - 2026-07-11

### Added

- harness (Фаза A4): createHarness — декларативний фасад над runOneShot/runAgentFix/runAgentSkill (профіль-обʼєкт {schema_version, kind, ...} → делегація в раннер, per-виклик поля перекривають); + subpath-експорти anchored-edit, web-tools

## [2.3.0] - 2026-07-11

### Added

- web-tools (Фаза A3): web_search/web_fetch для cloud-профілів — SSRF-guard (кожен redirect-hop), мінімальна html→text екстракція без нових залежностей, один search-провайдер за ключем (Brave/Tavily/Exa, N_LLM_SEARCH_PROVIDER); opts.webTools у runAgentFix (дефолт off)

## [2.2.1] - 2026-07-11

### Changed

- release: @7n/llm-lib@2.2.0, @nitra/cursor@14.24.0; feat(llm-lib,lint): Фаза A2 — hash-anchored edits (read_anchored/edit_anchored) як opt-in fix-профіль (#38)

## [2.2.0] - 2026-07-11

### Added

- anchored-edit (Фаза A2): строгі hash-anchored read_anchored/edit_anchored tools, opts.anchoredEdits у runAgentFix (toolset-профіль без built-in read/edit), edit_anchored під write-guard veto/snapshot

## [2.1.1] - 2026-07-11

### Changed

- test(llm-lib): дедиковані тести prompt-budget і with-timeout

## [2.1.0] - 2026-07-11

### Added

- agent-fix: evidence-гейт verify-loop (Фаза A1) — opts.verify/verifyMax, фідбек провалу у ту саму сесію, телеметрія verifyAttempts

## [2.0.4] - 2026-07-10

### Changed

- fix(test): ізоляція LLM wire-trace у vitest — N_LLM_TRACE_PATH у tmp

## [2.0.3] - 2026-07-10

### Changed

- chain.mjs: задокументовано конвенцію extra-полів фінального chain-запису (problem/resolvedBy/t0Applied/touchedFiles/touchedTotal) для шапки ланцюжка в UI/звітах

## [2.0.2] - 2026-07-09

### Fixed

- виправити невалідний JS-синтаксис у прикладі README (парсинг падав у CI eslint)
- усунути дублікат коду (jscpd) фабрик pi-сесії між one-shot/agent-fix/agent-skill — спільний streamFn-mixin хвіст винесено в internal/apply-session-mixins.mjs

## [2.0.1] - 2026-07-08

### Fixed

- npm publish: прибрано зайвий bin[n-llm-chains-report] шлях без нормалізації — npm вважав його невалідним і видаляв при публікації.

## [2.0.0] - 2026-07-06

### Changed

- Пакет перейменовано з `@nitra/llm-lib` на `@7n/llm-lib` (об'єднання з екосистемою `@7n/*` — `@7n/test`, `@7n/tauri-components`). Ламаюча зміна: усі консюмери мають оновити ім'я залежності та імпорт-специфікатори (`@nitra/llm-lib/*` → `@7n/llm-lib/*`). Стара назва `@nitra/llm-lib` на npm більше не отримує нових версій.

## [1.3.0] - 2026-07-06

### Added

- Уніфікація local/cloud транспорту (спека docs/specs/2026-07-06-proxy-retirement-unify-local-cloud.md): клієнтська компресія контексту (internal/apply-compression.mjs + internal/compress-context.mjs, streamFn-mixin, safety-net проти prefill_memory_exceeded/context-window overflow, N_LLM_COMPRESS=0 вимикає) — портовано з myllm compress.rs з адаптацією під форму pi Context (messages завжди array-parts, systemPrompt окремо); opt-in body-capture (lib/body-capture.mjs, N_LLM_TRACE_BODIES=1 → ~/.n-cursor/llm-bodies/, ретеншн за N_LLM_BODIES_MAX_MB) — повні тіла prompt/response і для local, і для cloud. Обидва mixin wired у runOneShot/runAgentFix/runAgentSkill. Live-валідовано: multi-turn сесія без компресії впала на prefill memory guard, та сама сесія з компресією пройшла напряму до omlx :8000 (без myllm-проксі).

## [1.2.1] - 2026-07-05

### Fixed

- agent-fix: дефолтний таймаут fix-спроби `DEFAULT_TIMEOUT_MS` (300s), коли consumer не передав `opts.timeoutMs` — раніше `withTimeout` без значення не влаштовував гонки і зависла SSE-сесія блокувала виклик назавжди

## [1.2.0] - 2026-07-05

### Added

- Ланцюжки (chains): startChain()/chain.end() групують LLM-виклики в задачу з фінальним записом kind:'chain' у trace (outcome, steps, local/cloud лічильники, escalated, usageCloud); opts.chain у runOneShot/runAgentFix/runAgentSkill; X-Chain-Id/Step/Kind/Cwd заголовки локальним моделям (streamFn-mixin) для кореляції з myllm-проксі; promptHash у кожному trace-записі (fallback-джойн, контракт sha256 hex16 last-user-message); isLocalModel у model-tiers (N_LLM_LOCAL_PROVIDERS); аналітика @nitra/llm-lib/chains-report + CLI n-llm-chains-report (escalation-rate, T0-кандидати, unclosed).

## [1.1.1] - 2026-07-05

### Changed

- style: oxfmt — формат changelog/presence tests

## [1.1.0] - 2026-07-05

### Added

- Додано підтримку targetFiles та посилено обмеження у buildFixPrompt

## [1.0.1] - 2026-07-05

### Added

- Перший реліз @nitra/llm-lib: LLM-шар (model tiers, one-shot, agent-fix/skill раннери, write-guard, trace, telemetry-store, with-timeout, prompt-budget) винесено з @nitra/cursor у окремий пакет — Ф1 спеки docs/specs/2026-07-05-llm-lib-extraction-spec.md. Публічний API substrate-незалежний (pi — internal), env-knobs отримали нейтральні імена N_LLM_* з робочими legacy-alias.
- one-shot: per-call maxTokens (0 = без стелі), stopReason у результаті ('length' = обрізано — політика повтору за колером) і публічний MEMORY_ERROR_RE як частина fail-fast error-контракту; agent-skill: per-call maxTokens. Потрібно для Ф3-міграції @7n/test (бюджети prompt-budget → maxTokens, length-retry, класифікація memory-guard помилок).

All notable changes to this project will be documented in this file.

## [Unreleased]

### Added
- Add new features.

### Changed
- Make small updates.

### Fixed
- Fix bugs.

### Removed
- Remove deprecated features.

## [1.0.0] - YYYY-MM-DD

### Added
- Initial release features.

### Changed
- Initial setup changes.