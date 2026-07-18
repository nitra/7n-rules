# Changelog

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