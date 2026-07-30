# Changelog

## [0.12.3] - 2026-07-30

### Changed

- release: @7n/rules@1.59.0, @7n/rules-ci-github@2.2.0, @7n/rules-lang-js@0.25.2, @7n/rules-lang-php@0.2.8, @7n/rules-lang-python@0.12.2, @7n/rules-lang-rust@0.15.2; fix(plugins): audit follow-ups — php vscode extensions, llm-lib peers, lint-style vue patch (#307)

## [0.12.2] - 2026-07-30

### Changed

- Peer `@7n/llm-lib` звужено з `*` до `>=1.2.0` — фактично потрібний API (`agent-fix` + `model-tiers`, `opts.chain`/`opts.targetFiles`), єдине production-використання — `coverage-provider/fix-hooks.mjs` (динамічний import, dependency ядра `@7n/rules`, не плагіна).

## [0.12.1] - 2026-07-30

### Fixed

- Уніфіковано LLM model resolution у execution consumers та оновлено native addon для env-selector policy.

## [0.12.0] - 2026-07-30

### Added

- Додано Tree-sitter WASM knowledge extractor для Python

### Fixed

- knowledge tests: використовують canonical `doc-files/package_knowledge` core path після злиття CI4.

## [0.11.4] - 2026-07-29

### Added

- lang-python: patch-existing contribution для .py-globs у lint-text.yml (ci.artifact@1)
- Власні Python CI-артефакти (lint-python.yml GitHub required-file, azure-pipelines lint-крок patch-existing) через ci.artifact@1 contributions — точне повторення PHP-патерну

## [0.11.3] - 2026-07-29

### Changed

- Виправлено правопис у документації Python-провайдера taze.

## [0.11.2] - 2026-07-28

### Changed

- release: @7n/llm-lib@2.10.1, @7n/rules@1.52.1, @7n/rules-lang-js@0.23.1
- Механічно додано change-файл для поточних змін у workspace.

## [0.11.1] - 2026-07-27

### Fixed

- peerDependency @7n/rules піднято до >=1.52.0 — перша core-версія з universal slot bus (plugin API v2)

## [0.11.0] - 2026-07-27

### Changed

- Рефакторинг реєстрації плагіна через slots у package.json

## [0.10.1] - 2026-07-27

### Changed

- fix(llm-lib): align native addon packages (#228)

## [0.10.0] - 2026-07-24

### Added

- coverage-провайдер Python: pytest-cov (lcov) + mutmut за портом CoverageProvider
- fix-hooks generateTests/fixSurvived (runAgentFix, pytest-канон) — LLM fix-шлях концерну coverage для Python

### Changed

- doc_comments rollout: header-JSDoc у vitest.config (T0 promote)
- doc_comments rollout: header/export JSDoc у конфігах demo
- doc_comments rollout: header-JSDoc у vitest.config

### Fixed

- Додано unit-тести для граничних випадків парсерів mutmut coverage provider.

## [0.9.0] - 2026-07-23

### Added

- coverage-провайдер Python: pytest-cov (lcov) + mutmut за портом CoverageProvider
- fix-hooks generateTests/fixSurvived (runAgentFix, pytest-канон) — LLM fix-шлях концерну coverage для Python

### Changed

- doc_comments rollout: header-JSDoc у vitest.config (T0 promote)
- doc_comments rollout: header/export JSDoc у конфігах demo
- doc_comments rollout: header-JSDoc у vitest.config

## [0.8.0] - 2026-07-23

### Added

- coverage-провайдер Python: pytest-cov (lcov) + mutmut за портом CoverageProvider

### Changed

- doc_comments rollout: header-JSDoc у vitest.config (T0 promote)
- doc_comments rollout: header/export JSDoc у конфігах demo
- doc_comments rollout: header-JSDoc у vitest.config

## [0.7.2] - 2026-07-23

### Changed

- doc_comments rollout: header-JSDoc у vitest.config (T0 promote)
- doc_comments rollout: header/export JSDoc у конфігах demo
- doc_comments rollout: header-JSDoc у vitest.config

## [0.7.1] - 2026-07-22

### Changed

- doc_comments rollout: header-JSDoc у vitest.config (T0 promote)
- doc_comments rollout: header/export JSDoc у конфігах demo
- doc_comments rollout: header-JSDoc у vitest.config

## [0.7.0] - 2026-07-22

### Added

- python/doc_comments: рекомендовані вимоги до docstring-ів (module-docstring для файлів із публічними def/class, docstring над кожним top-level публічним def/class) з T0-перетворенням суміжного #-коментаря на docstring

## [0.6.0] - 2026-07-21

### Added

- workspace_root: канон одного кореневого uv workspace на репозиторій (дзеркало rust/workspace_root), main.json auto-glob розширено на вкладені pyproject.toml

## [0.5.1] - 2026-07-19

### Fixed

- knip unresolved: JSDoc-типи lint-surface тепер через пакетний шлях `@7n/rules/scripts/lib/lint-surface/types.mjs` замість неіснуючого відносного `../../../scripts/...`

## [0.5.0] - 2026-07-19

### Added

- SKILL-фрагмент taze (фаза 4b spec lang-plugins-extraction): Python-гілка SKILL.md (детекція pyproject.toml, uv remove + uv add --bounds lower цикл, collectUvDiff, ruff/mypy/pytest, примітка про no-op `uv add`) тепер живе у плагіні (`skills/taze/SKILL.fragment.md`) і доклеюється sync-ом до скіла в репо з активним плагіном

## [0.4.0] - 2026-07-18

### Added

- Маніфест декларує doc-files-розширення `.py` → 'Python Module' (`contributes.docFiles.extensions`, фаза 4a spec lang-plugins-extraction) — генерація док для python-файлів тепер вмикається цим плагіном (whole-file шлях, без спеціалізованих екстракторів)

## [0.3.0] - 2026-07-18

### Added

- Правило `python` переїхало з ядра (фаза 3 spec lang-plugins-extraction): main.mdc, концерни applies/ruff/mypy/project/tooling/pyproject_toml з rego-політиками — плагін тепер contributes.rules; дзеркало `.cursor/rules/n-python.mdc` і auto-rules детект працюють через плагінне джерело

## [0.2.2] - 2026-07-18

### Fixed

- taze/provider: прибрано дублювальний named-експорт `pythonProvider` (лишився default) — фікс knip duplicates/exports

## [0.2.1] - 2026-07-18

### Fixed

- docs: виправлено помилку локальної doc-генерації у stryker.config.md (слово «раннер» писалось з однією «н»)

## [0.2.0] - 2026-07-18

### Added

- Перший реліз: EcosystemProvider Python/uv для taze-оркестратора `@7n/rules` (extension-point `taze`, контракт `@7n/rules/plugin-api`). Детермінований `collectUvDiff` (PEP 508/PEP 440 через `smol-toml`), bump по кожній прямій залежності `uv remove` + `uv add --bounds lower` з best-effort відновленням при провалі, graceful skip без установленого `uv`. Автодетект плагіна — за кореневим `pyproject.toml`

All notable changes to this project will be documented in this file.
