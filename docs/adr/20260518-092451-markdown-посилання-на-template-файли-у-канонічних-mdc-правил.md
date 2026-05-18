---
session: 9dfc7994-b7a9-48df-8524-8c221d82d608
captured: 2026-05-18T09:24:51+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-cursor/9dfc7994-b7a9-48df-8524-8c221d82d608.jsonl
---

## ADR Markdown-посилання на template-файли у канонічних .mdc правил

## Context and Problem Statement
Перевірка `findMissingMdcRefs` (у `npm/scripts/utils/check-mdc-template-refs.mjs`) читає канонічний `<id>.mdc` кожного правила і перевіряє, що кожен файл у `policy/*/template/` згаданий як markdown-посилання. Канонічні `.mdc` для `text`, `js-lint` та `js-run` цих посилань не містили, тому перевірка провалювалась.

## Considered Options
* Додати markdown-посилання на `policy/*/template/*` безпосередньо у текст канонічного `<id>.mdc`
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Додати markdown-посилання на `policy/*/template/*` безпосередньо у текст канонічного `<id>.mdc`", because перевірка `findMissingMdcRefs` вимагає саме наявності посилань у `.mdc`, а не зміни логіки перевірки; `security.mdc` і `bun.mdc` вже використовують цю ж конвенцію як робочий зразок.

### Consequences
* Good, because transcript фіксує очікувану користь: `findMissingMdcRefs` повернула `OK` для всіх трьох правил після правки (підтверджено запуском `node -e "... findMissingMdcRefs(ruleDir, id)"`).
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Змінені файли:
- `npm/rules/text/text.mdc` — версія `1.27` → `1.28`; додано посилання на `policy/vscode_extensions/template/extensions.json.snippet.json`, `policy/vscode_settings/template/settings.json.snippet.json`, `policy/oxfmt/template/.oxfmtrc.json.snippet.json`, `policy/markdownlint/template/.markdownlint-cli2.jsonc.snippet.jsonc`, `policy/cspell/template/.cspell.json.snippet.json`
- `npm/rules/js-lint/js-lint.mdc` — версія `1.22` → `1.23`; додано посилання на `policy/package_json/template/package.json.snippet.json`, `policy/vscode_extensions/template/extensions.json.snippet.json`, `policy/jscpd/template/.jscpd.json.snippet.json`, `policy/lint_js_yml/template/lint-js.yml.snippet.yml`
- `npm/rules/js-run/js-run.mdc` — версія `1.8` → `1.9`; додано посилання на `policy/jsconfig/template/jsconfig.json.snippet.json`, `policy/configmap/template/configmap.yaml.contains.yml`, `policy/package_json/template/package.json.snippet.json`
- `npm/package.json` — `version` `1.13.26` → `1.13.27`
- `npm/CHANGELOG.md` — запис `## [1.13.27] - 2026-05-18` з категорією `Fixed`

Утиліта перевірки: `npm/scripts/utils/check-mdc-template-refs.mjs` → `findMissingMdcRefs(ruleDir, ruleId)`.
Виклик у `npm/scripts/utils/run-rule.mjs`.
