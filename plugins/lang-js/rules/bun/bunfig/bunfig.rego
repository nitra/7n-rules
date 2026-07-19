# Перевірка `bunfig.toml` для bun (bun.mdc).
#
# Канон надходить через --data: { "template": { "snippet": ... } }
# Структура --data сформована з template/bunfig.toml.snippet.toml.
# Snippet — 2-рівнева мапа (section → key → expected). Walker такий самий,
# як для ga.vscode_settings: leaf-by-leaf коли section-обʼєкт існує + окремий
# deny коли section відсутній / не обʼєкт.
package bun.bunfig

import rego.v1

# Leaf-by-leaf: section присутня й обʼєкт.
deny contains msg if {
	some section, expected_inner in data.template.snippet
	inner := object.get(input, section, {})
	is_object(inner)
	some leaf_key, expected_value in expected_inner
	actual := object.get(inner, leaf_key, null)
	actual != expected_value
	msg := sprintf("bunfig.toml: у секції [%s] має бути %s = %q (bun.mdc)", [section, leaf_key, expected_value])
}

# Section відсутня (null) або не обʼєкт.
deny contains msg if {
	some section in object.keys(data.template.snippet)
	raw := object.get(input, section, null)
	not is_object(raw)
	msg := sprintf("bunfig.toml: відсутня секція [%s] (bun.mdc)", [section])
}
