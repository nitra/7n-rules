# Changelog

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