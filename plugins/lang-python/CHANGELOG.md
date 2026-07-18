# Changelog

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
