# Тести для `image_avif.package_json`. Запуск:
#   conftest verify -p npm/policy/image_avif/package_json
package image_avif.package_json_test

import rego.v1

import data.image_avif.package_json

# ── happy path ────────────────────────────────────────────────────────────

test_allow_no_field if {
	count(package_json.deny) == 0 with input as {"name": "x"}
}

test_allow_canonical_opt_out if {
	pkg := {"name": "x", "@nitra/minify-image": {"disable-avif": true}}
	count(package_json.deny) == 0 with input as pkg
}

test_allow_disable_avif_false if {
	pkg := {"name": "x", "@nitra/minify-image": {"disable-avif": false}}
	count(package_json.deny) == 0 with input as pkg
}

test_allow_empty_config if {
	pkg := {"name": "x", "@nitra/minify-image": {}}
	count(package_json.deny) == 0 with input as pkg
}

test_allow_other_keys_inside if {
	pkg := {"name": "x", "@nitra/minify-image": {"disable-avif": true, "future-flag": "y"}}
	count(package_json.deny) == 0 with input as pkg
}

# ── deny: тип поля ───────────────────────────────────────────────────────

test_deny_field_is_string if {
	pkg := {"name": "x", "@nitra/minify-image": "disable-avif"}
	count(package_json.deny) > 0 with input as pkg
}

test_deny_field_is_array if {
	pkg := {"name": "x", "@nitra/minify-image": ["disable-avif"]}
	count(package_json.deny) > 0 with input as pkg
}

test_deny_field_is_boolean if {
	pkg := {"name": "x", "@nitra/minify-image": true}
	count(package_json.deny) > 0 with input as pkg
}

# ── deny: тип disable-avif ──────────────────────────────────────────────

test_deny_disable_avif_string if {
	pkg := {"name": "x", "@nitra/minify-image": {"disable-avif": "yes"}}
	count(package_json.deny) > 0 with input as pkg
}

test_deny_disable_avif_number if {
	pkg := {"name": "x", "@nitra/minify-image": {"disable-avif": 1}}
	count(package_json.deny) > 0 with input as pkg
}

# ── deny: typo disabled-avif ────────────────────────────────────────────

test_deny_typo_disabled_avif if {
	pkg := {"name": "x", "@nitra/minify-image": {"disabled-avif": true}}
	count(package_json.deny) > 0 with input as pkg
}
