# Тести для `docker.lint_docker_yml`. Запуск:
#   conftest verify -p npm/rules/docker/policy/lint_docker_yml
package docker.lint_docker_yml_test

import data.docker.lint_docker_yml
import rego.v1

hadolint_install_run := "curl -sSL -o /tmp/hadolint https://github.com/hadolint/hadolint/releases/download/v2.12.0/hadolint-Linux-x86_64"

template_data := {"snippet": {
	"on": {"push": {"paths": ["**/Dockerfile", "**/*.Dockerfile", "**/*.dockerfile"]}},
	"jobs": {"lint-docker": {"steps": [
		{"uses": "actions/checkout@v6"},
		{"name": "Install hadolint", "run": hadolint_install_run},
		{"uses": "./.github/actions/setup-bun-deps"},
		{"name": "Lint Docker", "run": "n-cursor lint docker --no-fix"},
	]}},
}}

# `"true"` (а не `"on"`), бо conftest парсить YAML 1.1, де `on:` без лапок
# стає булевим ключем — так само як у `ga.lint_ga_test`.
valid_wf := {
	"name": "Lint Docker",
	"true": {"push": {
		"branches": ["dev", "main"],
		"paths": ["**/Dockerfile", "**/*.Dockerfile", "**/*.dockerfile"],
	}},
	"jobs": {"lint-docker": {"steps": [
		{"uses": "actions/checkout@v6"},
		{"name": "Install hadolint", "run": hadolint_install_run},
		{"uses": "./.github/actions/setup-bun-deps"},
		{"name": "Lint Docker", "run": "n-cursor lint docker --no-fix"},
	]}},
}

test_allow_canonical if {
	count(lint_docker_yml.deny) == 0 with input as valid_wf with data.template as template_data
}

test_deny_missing_path_dockerfile if {
	wf := json.patch(
		valid_wf,
		[{"op": "replace", "path": "/true/push/paths", "value": ["**/*.Dockerfile", "**/*.dockerfile"]}],
	)
	count(lint_docker_yml.deny) > 0 with input as wf with data.template as template_data
}

test_deny_wrong_hadolint_version if {
	wrong_run := "curl -sSL https://github.com/hadolint/hadolint/releases/download/v2.11.0/hadolint-Linux-x86_64"
	wf := json.patch(valid_wf, [{
		"op": "replace",
		"path": "/jobs/lint-docker/steps/1/run",
		"value": wrong_run,
	}])
	count(lint_docker_yml.deny) > 0 with input as wf with data.template as template_data
}

test_deny_no_setup_step if {
	wf := json.patch(valid_wf, [{"op": "remove", "path": "/jobs/lint-docker/steps/2"}])
	count(lint_docker_yml.deny) > 0 with input as wf with data.template as template_data
}

test_deny_missing_lint_docker_run if {
	wf := json.patch(valid_wf, [{
		"op": "replace",
		"path": "/jobs/lint-docker/steps/3/run",
		"value": "echo noop",
	}])
	count(lint_docker_yml.deny) > 0 with input as wf with data.template as template_data
}

# Drift test.
test_data_template_drives_required_path if {
	drifted := json.patch(template_data, [{
		"op": "replace",
		"path": "/snippet/on/push/paths",
		"value": ["**/Containerfile"],
	}])
	some msg in lint_docker_yml.deny with input as valid_wf with data.template as drifted
	contains(msg, "Containerfile")
}
