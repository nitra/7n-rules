package ga.lint_ga_test

import data.ga.lint_ga
import rego.v1

# Mirrors template/lint-ga.yml.snippet.yml.
template_data := {"snippet": {
	"name": "Lint GA",
	"on": {
		"push": {"branches": ["dev", "main"], "paths": [".github/actions/**", ".github/workflows/**"]},
		"pull_request": {"branches": ["dev", "main"], "paths": [".github/actions/**", ".github/workflows/**"]},
	},
	"jobs": {"lint-ga": {
		"runs-on": "ubuntu-latest",
		"permissions": {"contents": "read"},
		"steps": [
			{"uses": "actions/checkout@v6", "with": {"persist-credentials": false}},
			{"uses": "./.github/actions/setup-bun-deps"},
			{"uses": "astral-sh/setup-uv@v8.0.0"},
			{
				"name": "Install conftest",
				"run": "curl -fsSL https://github.com/open-policy-agent/conftest/releases/download/v0.62.0/conftest_0.62.0_Linux_x86_64.tar.gz | sudo tar -xz -C /usr/local/bin conftest",
			},
			{"name": "Lint GA", "run": "n-rules lint ga --no-fix"},
		],
	}},
}}

canonical_input := {
	"name": "Lint GA",
	"true": {
		"push": {"branches": ["dev", "main"], "paths": [".github/actions/**", ".github/workflows/**"]},
		"pull_request": {"branches": ["dev", "main"], "paths": [".github/actions/**", ".github/workflows/**"]},
	},
	"jobs": {"lint-ga": {
		"runs-on": "ubuntu-latest",
		"permissions": {"contents": "read"},
		"steps": [
			{"uses": "actions/checkout@v6", "with": {"persist-credentials": false}},
			{"uses": "./.github/actions/setup-bun-deps"},
			{"uses": "astral-sh/setup-uv@v8.0.0"},
			{
				"name": "Install conftest",
				"run": "curl -fsSL https://github.com/open-policy-agent/conftest/releases/download/v0.62.0/conftest_0.62.0_Linux_x86_64.tar.gz | sudo tar -xz -C /usr/local/bin conftest",
			},
			{"name": "Lint GA", "run": "n-rules lint ga --no-fix"},
		],
	}},
}

test_allow_canonical if {
	count(lint_ga.deny) == 0 with input as canonical_input with data.template as template_data
}

# Forgejo `ubuntu-latest` може бути mapped на попередньо підготовлений
# контейнер ci-tools. У ньому uv і conftest уже наявні, тому повторне
# Ubuntu provisioning не потрібне.
preinstalled_ci_tools_input := json.patch(canonical_input, [
	{
		"op": "add",
		"path": "/jobs/lint-ga/env",
		"value": {"NITRA_CI_TOOLS": "true"},
	},
	{
		"op": "replace",
		"path": "/jobs/lint-ga/steps",
		"value": [
			{"uses": "actions/checkout@v6", "with": {"persist-credentials": false}},
			{"uses": "./.github/actions/setup-bun-deps"},
			{"name": "Lint GA", "run": "n-rules lint ga --no-fix"},
		],
	},
])

test_allow_preinstalled_ci_tools if {
	count(lint_ga.deny) == 0 with input as preinstalled_ci_tools_input with data.template as template_data
}

test_deny_wrong_name if {
	bad := json.patch(canonical_input, [{"op": "replace", "path": "/name", "value": "Other"}])
	some msg in lint_ga.deny with input as bad with data.template as template_data
	contains(msg, "name")
}

test_deny_missing_dev_branch_in_push if {
	bad := json.patch(canonical_input, [{"op": "replace", "path": "/true/push/branches", "value": ["main"]}])
	some msg in lint_ga.deny with input as bad with data.template as template_data
	contains(msg, "push.branches")
}

test_deny_missing_required_path if {
	bad := json.patch(canonical_input, [{"op": "replace", "path": "/true/push/paths", "value": [".github/workflows/**"]}])
	some msg in lint_ga.deny with input as bad with data.template as template_data
	contains(msg, "push.paths")
}

test_deny_missing_required_pr_path if {
	bad := json.patch(canonical_input, [{"op": "replace", "path": "/true/pull_request/paths", "value": [".github/workflows/**"]}])
	some msg in lint_ga.deny with input as bad with data.template as template_data
	contains(msg, "pull_request.paths")
}

test_deny_missing_required_uses if {
	bad := json.patch(
		canonical_input,
		[{"op": "replace", "path": "/jobs/lint-ga/steps", "value": [{"name": "Lint GA", "run": "n-rules lint ga --no-fix"}]}],
	)
	count(lint_ga.deny) > 0 with input as bad with data.template as template_data
}

test_deny_missing_run_command if {
	bad := json.patch(
		canonical_input,
		[{"op": "replace", "path": "/jobs/lint-ga/steps/4/run", "value": "echo nothing"}],
	)
	some msg in lint_ga.deny with input as bad with data.template as template_data
	contains(msg, "n-rules lint ga --no-fix")
}

# SHA-пін (zizmor ref-pin) задовольняє канонічний тег — фіксер не даунгрейдить.
sha_pinned_input := json.patch(canonical_input, [
	{
		"op": "replace",
		"path": "/jobs/lint-ga/steps/0/uses",
		"value": "actions/checkout@df4cb1c069e1874edd31b4311f1884172cec0e10",
	},
	{
		"op": "replace",
		"path": "/jobs/lint-ga/steps/2/uses",
		"value": "astral-sh/setup-uv@aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
	},
])

test_allow_sha_pinned_uses if {
	count(lint_ga.deny) == 0 with input as sha_pinned_input with data.template as template_data
}

test_deny_short_sha_is_not_pin if {
	bad := json.patch(
		canonical_input,
		[{"op": "replace", "path": "/jobs/lint-ga/steps/0/uses", "value": "actions/checkout@df4cb1c"}],
	)
	some msg in lint_ga.deny with input as bad with data.template as template_data
	contains(msg, "actions/checkout@v6")
}

# Drift test.
test_data_template_drives_name if {
	drifted := {"snippet": object.union(template_data.snippet, {"name": "Custom"})}
	some msg in lint_ga.deny with input as canonical_input with data.template as drifted
	contains(msg, "Custom")
}

# Джоба названа НЕ `lint-ga` → `job` undefined. Пінить ПОВНИЙ канонічний
# набір deny для цього входу: рівно ті правила, що не залежать від `job`,
# плюс «jobs.lint-ga відсутній». Гейт проти двох регресій: shorthand-форми
# `job_uses_set`/`job_run_blob` (у regorus вона валила ВЕСЬ eval саме тут)
# і випадкового «оживлення» job-залежних deny (runs-on/permissions/steps).
missing_job_input := json.patch(canonical_input, [{
	"op": "add",
	"path": "/jobs",
	"value": {"other": {"steps": [{"run": "echo x"}]}},
}])

test_deny_missing_job if {
	deny := lint_ga.deny with input as missing_job_input with data.template as template_data
	deny == {
		"lint-ga.yml: jobs.lint-ga відсутній (ga.mdc)",
		"lint-ga.yml: має бути uses: actions/checkout@v6 (ga.mdc)",
		"lint-ga.yml: має бути uses: ./.github/actions/setup-bun-deps (ga.mdc)",
		"lint-ga.yml: має бути uses: astral-sh/setup-uv@v8.0.0 (ga.mdc)",
		"lint-ga.yml: має бути крок Install conftest (ga.mdc)",
		"lint-ga.yml: має бути крок run: n-rules lint ga --no-fix (ga.mdc)",
	}
}

# Гілки `on:` немає зовсім → `gha_on.push.*`/`gha_on.pull_request.branches`
# undefined, і канон про них МОВЧИТЬ (сигналить лише `on.pull_request.paths`,
# бо той читається через `object.get(…, [])`). Пінить саме цю асиметрію —
# без неї порт під regorus давав три зайві deny.
no_on_input := {"jobs": {"lint-ga": canonical_input.jobs["lint-ga"]}}

test_missing_on_hook_denies_only_pr_paths if {
	deny := lint_ga.deny with input as no_on_input with data.template as template_data
	deny == {"lint-ga.yml: on.pull_request.paths має містити .github/actions/** і .github/workflows/** (ga.mdc)"}
}
