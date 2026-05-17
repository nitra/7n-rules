# Перевірка `jsconfig.json` (js-run.mdc).
#
# Канон надходить через --data: { "template": { "snippet": ... } }
# Структура --data сформована з template/jsconfig.json.snippet.yml.
# Walker: для кожного leaf у template's snippet порівнюємо input[path].
# Для масивів — equality (не subset-of, бо в jsconfig потрібен точний набір).
package js_run.jsconfig

import rego.v1

# Generic 2-level walker: section → key → expected (для compilerOptions).
deny contains msg if {
	some section, expected_inner in data.template.snippet
	is_object(expected_inner)
	inner := object.get(input, section, {})
	is_object(inner)
	some leaf_key, expected_value in expected_inner
	actual := object.get(inner, leaf_key, null)
	not values_match(actual, expected_value)
	msg := sprintf("jsconfig.json: %s.%s має бути %v (js-run.mdc)", [section, leaf_key, expected_value])
}

# Section відсутня або не обʼєкт.
deny contains msg if {
	some section, expected_inner in data.template.snippet
	is_object(expected_inner)
	raw := object.get(input, section, null)
	not is_object(raw)
	msg := sprintf("jsconfig.json: відсутній обʼєкт %s (js-run.mdc)", [section])
}

# Top-level масив (наприклад include) — порівнюємо як множину.
deny contains msg if {
	some field, expected_array in data.template.snippet
	is_array(expected_array)
	actual := object.get(input, field, null)
	not is_array(actual)
	msg := sprintf("jsconfig.json: %s має бути масив %v (js-run.mdc)", [field, expected_array])
}

deny contains msg if {
	some field, expected_array in data.template.snippet
	is_array(expected_array)
	is_array(object.get(input, field, null))
	{x | some x in input[field]} != {x | some x in expected_array}
	msg := sprintf("jsconfig.json: %s має бути %v (js-run.mdc)", [field, expected_array])
}

# Helper: leaf-level value match, з підтримкою масивів як множин.
values_match(actual, expected) if {
	not is_array(expected)
	actual == expected
}

values_match(actual, expected) if {
	is_array(expected)
	is_array(actual)
	{x | some x in actual} == {x | some x in expected}
}
