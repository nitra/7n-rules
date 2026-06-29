# Перевірка `npm/tsconfig.emit-types.json` (npm-module.mdc).
#
# Канон надходить через --data: { "template": { "snippet": ... } }
# Структура --data сформована з template/tsconfig.emit-types.json.snippet.json.
# Snippet — 2-рівнева мапа (section → key → expected). Walker такий самий,
# як для ga.vscode_settings / bun.bunfig.
package npm_module.emit_types_config

import rego.v1

# Leaf-by-leaf: коли section присутня й обʼєкт.
deny contains msg if {
	some section, expected_inner in data.template.snippet
	inner := object.get(input, section, {})
	is_object(inner)
	some leaf_key, expected_value in expected_inner
	actual := object.get(inner, leaf_key, null)
	actual != expected_value
	msg := sprintf("npm/tsconfig.emit-types.json: %s.%s має бути %v (npm-module.mdc)", [section, leaf_key, expected_value])
}

# Section відсутня (null) або не обʼєкт.
deny contains msg if {
	some section in object.keys(data.template.snippet)
	raw := object.get(input, section, null)
	not is_object(raw)
	msg := sprintf("npm/tsconfig.emit-types.json: відсутній %s (npm-module.mdc)", [section])
}
