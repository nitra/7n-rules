# Тести для `docker.lint_docker_yml`. Запуск:
#   conftest verify -p npm/policy/docker/lint_docker_yml
package docker.lint_docker_yml_test

import rego.v1

import data.docker.lint_docker_yml

hadolint_install_run := concat("", [
	"curl -sSL -o /tmp/hadolint",
	" https://github.com/hadolint/hadolint/releases/download/v2.12.0/hadolint-Linux-x86_64",
])

valid_wf := {
	"name": "Lint Docker",
	"on": {"push": {
		"branches": ["dev", "main"],
		"paths": ["**/Dockerfile", "**/*.Dockerfile", "**/*.dockerfile"],
	}},
	"jobs": {"lint-docker": {"steps": [
		{"uses": "actions/checkout@v6"},
		{"name": "Install hadolint", "run": hadolint_install_run},
		{"uses": "./.github/actions/setup-bun-deps"},
		{"name": "Lint Docker", "run": "bun run lint-docker"},
	]}},
}

# ── happy path ────────────────────────────────────────────────────────────

test_allow_canonical if {
	count(lint_docker_yml.deny) == 0 with input as valid_wf
}

# ── deny: on.push.paths ──────────────────────────────────────────────────

test_deny_missing_path_dockerfile if {
	wf := json.patch(
		valid_wf,
		[{"op": "replace", "path": "/on/push/paths", "value": ["**/*.Dockerfile", "**/*.dockerfile"]}],
	)
	count(lint_docker_yml.deny) > 0 with input as wf
}

test_deny_missing_paths_field if {
	wf := json.patch(valid_wf, [{"op": "remove", "path": "/on/push/paths"}])
	count(lint_docker_yml.deny) > 0 with input as wf
}

# ── deny: hadolint version ──────────────────────────────────────────────

test_deny_wrong_hadolint_version if {
	wrong_version_run := concat("", [
		"curl -sSL",
		" https://github.com/hadolint/hadolint/releases/download/v2.11.0/hadolint-Linux-x86_64",
	])
	wf := json.patch(valid_wf, [{
		"op": "replace",
		"path": "/jobs/lint-docker/steps/1/run",
		"value": wrong_version_run,
	}])
	count(lint_docker_yml.deny) > 0 with input as wf
}

test_deny_no_hadolint_install if {
	wf := json.patch(valid_wf, [{
		"op": "replace",
		"path": "/jobs/lint-docker/steps/1",
		"value": {"name": "Noop", "run": "echo ok"},
	}])
	count(lint_docker_yml.deny) > 0 with input as wf
}

# ── deny: composite setup-bun-deps ──────────────────────────────────────

test_deny_inline_setup_bun_instead_of_composite if {
	# Старий канон (НЕПРАВИЛЬНО per ga.mdc): пряме `oven-sh/setup-bun` замість composite.
	wf := json.patch(valid_wf, [{
		"op": "replace",
		"path": "/jobs/lint-docker/steps/2",
		"value": {"uses": "oven-sh/setup-bun@v2"},
	}])
	count(lint_docker_yml.deny) > 0 with input as wf
}

test_deny_no_setup_step if {
	wf := json.patch(valid_wf, [{"op": "remove", "path": "/jobs/lint-docker/steps/2"}])
	count(lint_docker_yml.deny) > 0 with input as wf
}

# ── deny: bun run lint-docker ──────────────────────────────────────────

test_deny_missing_lint_docker_run if {
	wf := json.patch(valid_wf, [{
		"op": "replace",
		"path": "/jobs/lint-docker/steps/3/run",
		"value": "echo noop",
	}])
	count(lint_docker_yml.deny) > 0 with input as wf
}

test_deny_no_run_steps_at_all if {
	wf := json.patch(valid_wf, [{"op": "replace", "path": "/jobs/lint-docker/steps", "value": []}])
	count(lint_docker_yml.deny) > 0 with input as wf
}
