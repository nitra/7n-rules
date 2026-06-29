# Тести для `image_avif.package_json`. Запуск:
#   conftest verify -p npm/rules/image-avif/policy/package_json
package image_avif.package_json_test

import data.image_avif.package_json
import rego.v1

template_data := {"deny": {"@nitra/minify-image": {"disabled-avif": "виглядає як typo — канонічна назва \"disable-avif\" (image-avif.mdc)"}}}

test_allow_no_field if {
	count(package_json.deny) == 0 with input as {"name": "x"} with data.template as template_data
}

test_allow_canonical_opt_out if {
	pkg := {"name": "x", "@nitra/minify-image": {"disable-avif": true}}
	count(package_json.deny) == 0 with input as pkg with data.template as template_data
}

test_allow_disable_avif_false if {
	pkg := {"name": "x", "@nitra/minify-image": {"disable-avif": false}}
	count(package_json.deny) == 0 with input as pkg with data.template as template_data
}

test_allow_empty_config if {
	pkg := {"name": "x", "@nitra/minify-image": {}}
	count(package_json.deny) == 0 with input as pkg with data.template as template_data
}

test_allow_other_keys_inside if {
	pkg := {"name": "x", "@nitra/minify-image": {"disable-avif": true, "future-flag": "y"}}
	count(package_json.deny) == 0 with input as pkg with data.template as template_data
}

test_deny_field_is_string if {
	pkg := {"name": "x", "@nitra/minify-image": "disable-avif"}
	count(package_json.deny) > 0 with input as pkg with data.template as template_data
}

test_deny_field_is_array if {
	pkg := {"name": "x", "@nitra/minify-image": ["disable-avif"]}
	count(package_json.deny) > 0 with input as pkg with data.template as template_data
}

test_deny_field_is_boolean if {
	pkg := {"name": "x", "@nitra/minify-image": true}
	count(package_json.deny) > 0 with input as pkg with data.template as template_data
}

test_deny_disable_avif_string if {
	pkg := {"name": "x", "@nitra/minify-image": {"disable-avif": "yes"}}
	count(package_json.deny) > 0 with input as pkg with data.template as template_data
}

test_deny_disable_avif_number if {
	pkg := {"name": "x", "@nitra/minify-image": {"disable-avif": 1}}
	count(package_json.deny) > 0 with input as pkg with data.template as template_data
}

test_deny_typo_disabled_avif if {
	pkg := {"name": "x", "@nitra/minify-image": {"disabled-avif": true}}
	some msg in package_json.deny with input as pkg with data.template as template_data
	contains(msg, "disabled-avif")
}

# Drift test.
test_data_template_drives_typo_key if {
	pkg := {"name": "x", "@nitra/minify-image": {"custom-typo": true}}
	some msg in package_json.deny with input as pkg
		with data.template as {"deny": {"@nitra/minify-image": {"custom-typo": "test typo"}}}
	contains(msg, "custom-typo")
}
