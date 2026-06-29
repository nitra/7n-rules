package image_compress.package_json_test

import data.image_compress.package_json
import rego.v1

template_data := {
	"deny": {
		"dependencies": {"@nitra/minify-image": "не повинен бути в dependencies — використовуй npx (image-compress.mdc)"},
		"devDependencies": {"@nitra/minify-image": "не повинен бути в devDependencies — використовуй npx (image-compress.mdc)"},
	},
}

valid_pkg := {"scripts": {}}

test_allow_canonical if {
	count(package_json.deny) == 0 with input as valid_pkg with data.template as template_data
}

test_deny_minify_image_in_dependencies if {
	pkg := {
		"dependencies": {"@nitra/minify-image": "^3.0.0"},
	}
	some msg in package_json.deny with input as pkg with data.template as template_data
	contains(msg, "dependencies")
}

test_deny_minify_image_in_dev_dependencies if {
	pkg := {
		"devDependencies": {"@nitra/minify-image": "^3.0.0"},
	}
	some msg in package_json.deny with input as pkg with data.template as template_data
	contains(msg, "devDependencies")
}
