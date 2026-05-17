# Тести для `docker.package_json`. Запуск:
#   conftest verify -p npm/rules/docker/policy/package_json
package docker.package_json_test

import data.docker.package_json
import rego.v1

template_data := {"snippet": {"scripts": {"lint-docker": "n-cursor lint-docker"}}}

test_allow_canonical if {
	pkg := {"scripts": {"lint-docker": "n-cursor lint-docker"}}
	count(package_json.deny) == 0 with input as pkg with data.template as template_data
}

test_allow_lint_docker_absent if {
	# rego не вимагає наявність — cross-file умовно вимагає `check-bun.mjs`.
	count(package_json.deny) == 0 with input as {"scripts": {}} with data.template as template_data
}

test_allow_no_scripts_at_all if {
	count(package_json.deny) == 0 with input as {"name": "x"} with data.template as template_data
}

test_allow_with_extra_whitespace if {
	pkg := {"scripts": {"lint-docker": " n-cursor lint-docker  "}}
	count(package_json.deny) == 0 with input as pkg with data.template as template_data
}

test_deny_lint_docker_wrong_value if {
	pkg := {"scripts": {"lint-docker": "hadolint Dockerfile"}}
	count(package_json.deny) > 0 with input as pkg with data.template as template_data
}

# Drift test.
test_data_template_drives_expected if {
	pkg := {"scripts": {"lint-docker": "n-cursor lint-docker"}}
	some msg in package_json.deny with input as pkg
		with data.template as {"snippet": {"scripts": {"lint-docker": "custom-cli"}}}
	contains(msg, "custom-cli")
}
