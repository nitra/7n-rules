# Перевірка `.vscode/settings.json` для GitHub Actions workflow (ga.mdc).
#
# Канон надходить через --data: { "template": { "snippet": ... } }
# Структура --data сформована з template/settings.json.snippet.json.
# Snippet — 2-рівнева мапа: <language-block-key>.<setting-key> = <expected>
# (VS Code-конвенція: ключі типу `[github-actions-workflow]` і `editor.defaultFormatter`
# — це літеральні string-keys із дужками/крапкою, не вкладені обʼєкти).
#
# Конвенція проєкту — `import rego.v1` + multi-value `deny contains msg if { … }`
# (.cursor/rules/conftest.mdc). Лінт — `bun run lint-rego` (regal).
package ga.vscode_settings

import rego.v1

deny contains msg if {
	some block_key, expected_inner in data.template.snippet
	inner := object.get(input, block_key, {})
	some leaf_key, expected_value in expected_inner
	actual := object.get(inner, leaf_key, null)
	actual != expected_value
	msg := sprintf(".vscode/settings.json: %s.%s має бути %q (ga.mdc)", [block_key, leaf_key, expected_value])
}
