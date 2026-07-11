# Changelog

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