# Перевірка `.markdownlint-cli2.jsonc` (text.mdc).
#
# Канон надходить через --data: { "template": { "snippet": ... } }
# Структура --data сформована з template/.markdownlint-cli2.jsonc.snippet.jsonc.
# Walker: top-level leaf, потім вкладені обʼєкти (config.<rule>); також рекурсивний
# leaf-check для MD024.siblings_only.
package text.markdownlint

import rego.v1

# ── deny: top-level leafs ───────────────────────────────────────────────

deny contains msg if {
	some key, expected_value in data.template.snippet
	not is_object(expected_value)
	actual := object.get(input, key, null)
	actual != expected_value
	msg := sprintf(".markdownlint-cli2.jsonc: %s має бути %v (text.mdc)", [key, expected_value])
}

# ── deny: 2-level leafs (config.<rule> = scalar) ────────────────────────

deny contains msg if {
	some section, expected_inner in data.template.snippet
	is_object(expected_inner)
	inner := object.get(input, section, {})
	is_object(inner)
	some leaf_key, expected_value in expected_inner
	not is_object(expected_value)
	actual := object.get(inner, leaf_key, null)
	actual != expected_value
	msg := sprintf(".markdownlint-cli2.jsonc: %s.%s має бути %v (text.mdc)", [section, leaf_key, expected_value])
}

# ── deny: 3-level leafs (config.MD024.siblings_only) ────────────────────

deny contains msg if {
	some section, expected_inner in data.template.snippet
	is_object(expected_inner)
	some inner_key, expected_subinner in expected_inner
	is_object(expected_subinner)
	subinner := object.get(object.get(input, section, {}), inner_key, {})
	is_object(subinner)
	some leaf, expected in expected_subinner
	actual := object.get(subinner, leaf, null)
	actual != expected
	msg := sprintf(".markdownlint-cli2.jsonc: %s.%s.%s має бути %v (text.mdc)", [section, inner_key, leaf, expected])
}

# ── deny: vкладеного обʼєкта взагалі немає ──────────────────────────────

deny contains msg if {
	some section, expected_inner in data.template.snippet
	is_object(expected_inner)
	not is_object(object.get(input, section, null))
	msg := sprintf(".markdownlint-cli2.jsonc: відсутній обʼєкт %s (text.mdc)", [section])
}
