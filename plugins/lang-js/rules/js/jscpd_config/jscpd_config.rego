# Перевірка `.jscpd.json` (js.mdc).
#
# Канон надходить через --data: { "template": { "snippet": ... } }
# Структура --data сформована з template/.jscpd.json.snippet.json.
# Особливості:
#  - `reporters` — subset-of (масив string)
#  - `minLines` — >= expected (semantic: дозволяється більше, не менше)
#  - `gitignore`/`exitCode` — exact match
package js.jscpd_config

import rego.v1

# Top-level scalar leafs (exact match) для gitignore + exitCode.
deny contains msg if {
	some key, expected_value in data.template.snippet
	key != "minLines"
	not is_array(expected_value)
	actual := object.get(input, key, null)
	actual != expected_value
	msg := sprintf(".jscpd.json має містити \"%s\": %v (js.mdc)", [key, expected_value])
}

# Array subset-of для reporters.
deny contains msg if {
	some field, expected_values in data.template.snippet
	is_array(expected_values)
	actual_set := {v | some v in object.get(input, field, [])}
	some required in expected_values
	not required in actual_set
	msg := sprintf(".jscpd.json має містити \"%s\": [\"%s\"] (js.mdc)", [field, required])
}

# minLines: must be number and >= expected.
deny contains msg if {
	expected := data.template.snippet.minLines
	actual := object.get(input, "minLines", null)
	not is_valid_min_lines(actual, expected)
	msg := sprintf(".jscpd.json має містити \"minLines\" як число >= %d (js.mdc)", [expected])
}

is_valid_min_lines(actual, expected) if {
	is_number(actual)
	actual >= expected
}
