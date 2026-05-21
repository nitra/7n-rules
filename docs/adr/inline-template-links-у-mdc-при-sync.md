# Вбудовування вмісту `template/`-файлів у `.mdc` під час sync

**Status:** Accepted
**Date:** 2026-05-17

## Context and Problem Statement

Після впровадження `template/` інфраструктури `security.mdc` містив markdown-посилання вигляду `[package.json.snippet.json](./policy/package_json/template/package.json.snippet.json)`. CLI `n-cursor sync` копіює лише `<id>.mdc` без `template/` директорій — у споживача посилання вказують у неіснуюче місце.

## Considered Options

- Inline-підстановка вмісту `template/<file>` у fenced-блок під час sync
- Абсолютні GitHub URL замість відносних посилань
- Копіювати `template/` у `.cursor/rules-data/<id>/` і переписувати посилання

## Decision Outcome

Chosen option: "Inline-підстановка під час sync", because `.mdc` у споживача повинен бути self-contained; GitHub URL потребують мережі та можуть розійтись із версією; третій варіант створює дві локації одного канону.

Три додаткові рішення в межах реалізації:
- **Fail hard**: sync кидає `Error` `inlineTemplateLinks: <rel> не знайдено` — щоб помилка була помітна.
- **Function-replacer**: `.gitleaks.toml.snippet.toml` містить `'''.*\.lock$'''`; `$'` у string-replacer → реінжекція хвоста документа. Рішення: `result.replace(fullMatch, () => replacement)`.
- **Нормалізація label**: `normalizeTargetName` відкидає `.<slot>.<ext>` суфікс, щоб синкнутий файл показував `package.json` замість `package.json.snippet.json`.

### Consequences

- Good, because `.cursor/rules/n-security.mdc` після sync містить повний TOML і JSON-канон у fenced-блоках; 10/10 unit-тестів GREEN.
- Good, because fail hard забезпечує видимість помилки конфігурації одразу на CI.
- Bad, because потрібен markdown-парсер у sync-пайплайні, що ускладнює логіку копіювання.

## More Information

Нова утиліта: `npm/scripts/utils/inline-template-links.mjs`, export `inlineTemplateLinks(text, ruleDir)`. Regex: `/\[([^\]]+)\]((\.\/[^)]*\/template\/[^)]+))/g`. Вбудовано у `readBundledRuleContent` в `npm/bin/n-cursor.js`. Регресійна фікстура: `__fixtures__/inline-template/fix/foo/template/with-dollar.toml`. Версії: `1.13.6 → 1.13.7` (function-replacer), `→ 1.13.8` (label normalization). Коміти: `2f36015`, `ede7754`, `6df1de2`.

## Update 2026-05-18

**Перевірка `findMissingMdcRefs`:** утиліта `npm/scripts/utils/check-mdc-template-refs.mjs` читає канонічний `<id>.mdc` і перевіряє, що кожен файл у `policy/*/template/` згаданий як markdown-посилання. Запускається через `npm/scripts/utils/run-rule.mjs`. Референсні зразки: `security.mdc` і `bun.mdc`.

Виправлено відсутні посилання у трьох правилах:
- `npm/rules/text/text.mdc` (1.27 → 1.28): `policy/vscode_extensions/template/extensions.json.snippet.json`, `policy/vscode_settings/template/settings.json.snippet.json`, `policy/oxfmt/template/.oxfmtrc.json.snippet.json`, `policy/markdownlint/template/.markdownlint-cli2.jsonc.snippet.jsonc`, `policy/cspell/template/.cspell.json.snippet.json`
- `npm/rules/js-lint/js-lint.mdc` (1.22 → 1.23): `policy/package_json/template/package.json.snippet.json`, `policy/vscode_extensions/template/extensions.json.snippet.json`, `policy/jscpd/template/.jscpd.json.snippet.json`, `policy/lint_js_yml/template/lint-js.yml.snippet.yml`
- `npm/rules/js-run/js-run.mdc` (1.8 → 1.9): `policy/jsconfig/template/jsconfig.json.snippet.json`, `policy/configmap/template/configmap.yaml.contains.yml`, `policy/package_json/template/package.json.snippet.json`

`npm/package.json` — bump `1.13.26` → `1.13.27`.
