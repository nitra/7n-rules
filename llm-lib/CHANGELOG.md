# Changelog

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