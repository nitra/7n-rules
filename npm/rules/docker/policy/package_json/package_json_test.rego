# Тести для `docker.package_json`. Запуск:
#   conftest verify -p npm/policy/docker/package_json
package docker.package_json_test

import rego.v1

import data.docker.package_json

canonical_lint_docker := "bun ./npm/scripts/run-docker.mjs"

# ── happy path ────────────────────────────────────────────────────────────

test_allow_canonical if {
	pkg := {"scripts": {"lint-docker": canonical_lint_docker}}
	count(package_json.deny) == 0 with input as pkg
}

test_allow_lint_docker_absent if {
	# rego не вимагає наявність — cross-file умовно вимагає `check-bun.mjs`.
	count(package_json.deny) == 0 with input as {"scripts": {}}
}

test_allow_no_scripts_at_all if {
	count(package_json.deny) == 0 with input as {"name": "x"}
}

test_allow_with_extra_whitespace if {
	pkg := {"scripts": {"lint-docker": concat("", [" ", canonical_lint_docker, "  "])}}
	count(package_json.deny) == 0 with input as pkg
}

# ── deny ──────────────────────────────────────────────────────────────────

test_deny_lint_docker_wrong_value if {
	pkg := {"scripts": {"lint-docker": "hadolint Dockerfile"}}
	count(package_json.deny) > 0 with input as pkg
}

test_deny_lint_docker_old_npx_form if {
	pkg := {"scripts": {"lint-docker": "npx hadolint ."}}
	count(package_json.deny) > 0 with input as pkg
}
