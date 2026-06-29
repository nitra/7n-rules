# Перевірка `.oxfmtrc.json` (text.mdc).
#
# Канон надходить через --data: { "template": { "snippet": ... } }
# Структура --data сформована з template/.oxfmtrc.json.snippet.json.
# Generic walker: top-level scalar leaf-check + array subset-of (для ignorePatterns).
#
# Логіка, що ЛИШАЄТЬСЯ у rego (inverse — не виноситься у template):
#  - required_keys: ключі, що мають бути присутні (presence-only, без точного значення).
package text.oxfmtrc

import rego.v1

required_keys := [
	"arrowParens",
	"printWidth",
	"bracketSpacing",
	"bracketSameLine",
	"semi",
	"singleQuote",
	"tabWidth",
	"trailingComma",
	"useTabs",
]

deny contains msg if {
	some key in required_keys
	not key in object.keys(input)
	msg := sprintf(".oxfmtrc.json: відсутній обовʼязковий ключ %q (text.mdc)", [key])
}

deny contains msg if {
	some key, expected_value in data.template.snippet
	not is_array(expected_value)
	not is_object(expected_value)
	actual := object.get(input, key, null)
	actual != expected_value
	msg := sprintf(".oxfmtrc.json: %s має бути %v (text.mdc)", [key, expected_value])
}

deny contains msg if {
	some field, expected_values in data.template.snippet
	is_array(expected_values)
	not is_array(object.get(input, field, null))
	msg := sprintf(".oxfmtrc.json: додай масив %s з канонічними glob-ами (text.mdc)", [field])
}

deny contains msg if {
	some field, expected_values in data.template.snippet
	is_array(expected_values)
	is_array(object.get(input, field, null))
	actual_set := {v | some v in input[field]}
	some required in expected_values
	not required in actual_set
	msg := sprintf(".oxfmtrc.json %s: додай %q (text.mdc)", [field, required])
}
