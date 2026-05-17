package image_compress.package_json_test

import data.image_compress.package_json
import rego.v1

template_data := {
	"contains": {"scripts": {"lint-image": ["npx @nitra/minify-image", "--src=.", "--write"]}},
	"deny": {
		"dependencies": {"@nitra/minify-image": "не повинен бути в dependencies — використовуй npx (image-compress.mdc)"},
		"devDependencies": {"@nitra/minify-image": "не повинен бути в devDependencies — використовуй npx (image-compress.mdc)"},
	},
}

valid_pkg := {"scripts": {"lint-image": "npx @nitra/minify-image --src=. --write"}}

test_allow_canonical if {
	count(package_json.deny) == 0 with input as valid_pkg with data.template as template_data
}

test_deny_missing_lint_image if {
	some msg in package_json.deny with input as {"scripts": {}} with data.template as template_data
	contains(msg, "lint-image")
}

test_deny_lint_image_missing_npx if {
	pkg := {"scripts": {"lint-image": "@nitra/minify-image --src=. --write"}}
	some msg in package_json.deny with input as pkg with data.template as template_data
	contains(msg, "npx")
}

test_deny_lint_image_missing_src_flag if {
	pkg := {"scripts": {"lint-image": "npx @nitra/minify-image --write"}}
	some msg in package_json.deny with input as pkg with data.template as template_data
	contains(msg, "--src=.")
}

test_deny_lint_image_missing_write_flag if {
	pkg := {"scripts": {"lint-image": "npx @nitra/minify-image --src=."}}
	some msg in package_json.deny with input as pkg with data.template as template_data
	contains(msg, "--write")
}

test_deny_avif_flag_in_lint_image if {
	pkg := {"scripts": {"lint-image": "npx @nitra/minify-image --src=. --write --avif"}}
	some msg in package_json.deny with input as pkg with data.template as template_data
	contains(msg, "avif")
}

test_deny_aggregator_lint_missing_lint_image_call if {
	pkg := {"scripts": {
		"lint-image": "npx @nitra/minify-image --src=. --write",
		"lint": "bun run lint-js && oxfmt .",
	}}
	some msg in package_json.deny with input as pkg with data.template as template_data
	contains(msg, "bun run lint-image")
}

test_deny_minify_image_in_dependencies if {
	pkg := {
		"scripts": {"lint-image": "npx @nitra/minify-image --src=. --write"},
		"dependencies": {"@nitra/minify-image": "^3.0.0"},
	}
	some msg in package_json.deny with input as pkg with data.template as template_data
	contains(msg, "dependencies")
}

test_deny_minify_image_in_dev_dependencies if {
	pkg := {
		"scripts": {"lint-image": "npx @nitra/minify-image --src=. --write"},
		"devDependencies": {"@nitra/minify-image": "^3.0.0"},
	}
	some msg in package_json.deny with input as pkg with data.template as template_data
	contains(msg, "devDependencies")
}

# Drift test.
test_data_template_drives_contains if {
	pkg := {"scripts": {"lint-image": "npx @nitra/minify-image --src=. --write"}}
	drifted := {"contains": {"scripts": {"lint-image": ["--custom-flag"]}}, "deny": template_data.deny}
	some msg in package_json.deny with input as pkg with data.template as drifted
	contains(msg, "--custom-flag")
}
