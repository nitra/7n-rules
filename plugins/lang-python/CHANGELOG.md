# Changelog

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
