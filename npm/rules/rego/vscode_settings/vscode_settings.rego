# Перевірка `.vscode/settings.json` для rego (rego.mdc).
#
# Канон надходить через --data: { "template": { "snippet": ... } }
# Структура --data сформована з template/settings.json.snippet.json.
# Snippet — 2-рівнева мапа: <language-block-key>.<setting-key> = <expected>
# (VS Code-конвенція: ключі `[rego]` і `editor.defaultFormatter`/`editor.formatOnSave`
# — це літеральні string-keys із дужками/крапкою, не вкладені обʼєкти).
package rego.vscode_settings

import rego.v1

# Leaf-by-leaf: працює коли block присутній і є обʼєктом.
deny contains msg if {
	some block_key, expected_inner in data.template.snippet
	inner := object.get(input, block_key, {})
	is_object(inner)
	some leaf_key, expected_value in expected_inner
	actual := object.get(inner, leaf_key, null)
	actual != expected_value
	msg := sprintf(".vscode/settings.json: %s.%s має бути %v (rego.mdc)", [block_key, leaf_key, expected_value])
}

# Block існує, але не обʼєкт (напр. рядок) — окрема помилка типу.
deny contains msg if {
	some block_key in object.keys(data.template.snippet)
	raw := object.get(input, block_key, null)
	raw != null
	not is_object(raw)
	msg := sprintf(".vscode/settings.json: %s має бути обʼєктом (rego.mdc)", [block_key])
}
