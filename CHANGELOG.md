# Changelog

Усі помітні зміни кореневого workspace `n-cursor` документуються тут.

Формат — [Keep a Changelog](https://keepachangelog.com/uk/1.1.0/), нумерація — [SemVer](https://semver.org/lang/uk/).

## [1.0.1] - 2026-05-09

### Added

- Demo-workspace `demo/` (Vue 3 + Vite) як пісочниця для перевірки правил.
- Скрипти лінту OPA-полісі, стилів і зображень у кореневому
  `package.json`; `lint-text` доповнено `run-shellcheck-text.mjs`.
- Конфігурації проєкту: `.cspell.json`, `.jscpd.json`, `.markdownlint-cli2.jsonc`,
  `.oxfmtrc.json`, `.oxlintrc.json`, `.stylelintignore`, `.regal/config.yaml`,
  `.n-cursor.json`, `.n-minify-image.tsv`, `bunfig.toml`, `hk.pkl`.
- ADR-процес: `docs/adr/_inbox/`, `.claude/hooks/capture-decisions.sh`,
  `.claude/settings.json`.
- Слеш-команди для агента (`.claude/commands/`): `n-fix`, `n-check`, `n-lint`,
  `mdc-check`, `n-publish-telegram`.
- Cursor-правила в `.cursor/rules/`: `dev-dep`, `n-adr`, `n-bun`,
  `n-changelog`, `n-ga`, `n-image-avif`, `n-image-compress`, `n-js-bun-db`,
  `n-js-lint`, `n-js-run`, `n-nginx-default-tpl`, `n-npm-module`,
  `n-style-lint`, `n-text`, `n-vue`, `scripts`, плюс правила OPA-полісі.
- Cursor-скіли: `mdc-check`, `n-lint`.
- GitHub Actions: `clean-ga-workflows.yml`, `clean-merged-branch.yml`,
  `git-ai.yml`, `lint-ga.yml`, `lint-style.yml`, `lint-text.yml`,
  `npm-publish.yml`, `security.yml`; reusable composite
  `.github/actions/setup-bun-deps/`.
- VSCode-конфіг (`.vscode/settings.json`, `extensions.json`) під oxc/oxlint,
  stylelint, vscode-github-actions, Vue.volar, markdownlint, shellcheck.

### Changed

- `lint-ga` тепер виконується через `n-cursor lint-ga` замість прямих викликів
  `node-actionlint` і `zizmor`.
- `lint-js` запускає `oxlint` через `bunx`, додає `eslint --fix .` і
  `jscpd .`.
- `@nitra/cspell-dict` оновлено до `^2.1.0`, `@nitra/eslint-config` — до
  `^3.9.2`; додано `@nitra/stylelint-config` `^1.4.0` з `extends` у
  `package.json#stylelint`.
- `engines` доповнено `bun >=1.3`.
- `workspaces` розширено до `["demo", "npm"]`.

### Removed

- Прямі залежності `@cspell/dict-uk-ua` (включена в `@nitra/cspell-dict@2`).
