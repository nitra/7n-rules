package text.lint_text_test

import data.text.lint_text
import rego.v1

shellcheck_install_run := "sudo apt-get update && sudo apt-get install -y shellcheck"

dotenv_install_run := "curl -sSfL https://git.io/JLbXn | sh -s -- -b /usr/local/bin"

push_paths := [
	"**/*.html", "**/*.css", "**/*.scss", "**/*.less",
	"**/*.json", "**/*.jsonc", "**/*.yaml", "**/*.yml", "**/*.toml", "**/*.xml",
	"**/*.md", "**/*.mdc", "**/*.mdс", "**/*.txt", "**/*.go", "**/*.sh",
]

template_data := {"snippet": {
	"name": "Lint Text",
	"on": {
		"push": {"branches": ["dev", "main"], "paths": push_paths},
		"pull_request": {"branches": ["dev", "main"], "paths": push_paths},
	},
	"jobs": {"text": {
		"runs-on": "ubuntu-latest",
		"permissions": {"contents": "read"},
		"steps": [
			{"uses": "actions/checkout@v6", "with": {"persist-credentials": false}},
			{"uses": "./.github/actions/setup-bun-deps"},
			{"name": "Install shellcheck", "run": shellcheck_install_run},
			{"name": "Install dotenv-linter", "run": dotenv_install_run},
			{"name": "Lint text", "run": "n-rules lint text --no-fix"},
		],
	}},
}}

# `"true"` (а не `"on"`), бо conftest парсить YAML 1.1, де `on:` без лапок
# стає булевим ключем — так само як у `ga.lint_ga_test`.
canonical_input := {
	"name": "Lint Text",
	"true": {
		"push": {"branches": ["dev", "main"], "paths": push_paths},
		"pull_request": {"branches": ["dev", "main"], "paths": push_paths},
	},
	"jobs": {"text": {
		"runs-on": "ubuntu-latest",
		"permissions": {"contents": "read"},
		"steps": [
			{"uses": "actions/checkout@v6", "with": {"persist-credentials": false}},
			{"uses": "./.github/actions/setup-bun-deps"},
			{"name": "Install shellcheck", "run": shellcheck_install_run},
			{"name": "Install dotenv-linter", "run": dotenv_install_run},
			{"name": "Lint text", "run": "n-rules lint text --no-fix"},
		],
	}},
}

test_allow_canonical if {
	count(lint_text.deny) == 0 with input as canonical_input with data.template as template_data
}

test_deny_missing_dotenv_install if {
	bad := json.patch(
		canonical_input,
		[{"op": "remove", "path": "/jobs/text/steps/3"}],
	)
	some msg in lint_text.deny with input as bad with data.template as template_data
	contains(msg, "git.io/JLbXn")
}

test_deny_missing_shellcheck_install if {
	bad := json.patch(
		canonical_input,
		[{"op": "remove", "path": "/jobs/text/steps/2"}],
	)
	some msg in lint_text.deny with input as bad with data.template as template_data
	contains(msg, "shellcheck")
}

test_deny_missing_lint_text_run if {
	bad := json.patch(
		canonical_input,
		[{"op": "replace", "path": "/jobs/text/steps/4/run", "value": "echo skip"}],
	)
	some msg in lint_text.deny with input as bad with data.template as template_data
	contains(msg, "n-rules lint text --no-fix")
}

test_deny_missing_required_pr_path if {
	bad := json.patch(canonical_input, [{"op": "replace", "path": "/true/pull_request/paths", "value": ["**/*.md"]}])
	some msg in lint_text.deny with input as bad with data.template as template_data
	contains(msg, "pull_request.paths")
}

# Workflow БЕЗ джоби `text` — `job` undefined. Канон: `jobs.text відсутній`
# плюс похідні deny (uses/run/pull_request.paths), і ЖОДНОГО deny про
# `on.push.*` (undefined-аргумент лишає body undefined). Longhand-форма
# `job_uses_set` і звʼязування актуальних значень перед `not` тримають
# regorus на цій самій семантиці.
test_deny_missing_text_job if {
	bad := {"name": "Lint Text", "jobs": {"other": {"steps": [{"run": "echo x"}]}}}
	msgs := lint_text.deny with input as bad with data.template as template_data
	count(msgs) == 7
	some msg in msgs
	contains(msg, "jobs.text відсутній")
}

test_missing_text_job_is_silent_on_push_branches if {
	bad := {"name": "Lint Text", "jobs": {"other": {"steps": [{"run": "echo x"}]}}}
	msgs := lint_text.deny with input as bad with data.template as template_data
	every msg in msgs {
		not contains(msg, "on.push")
	}
}

test_data_template_drives_name if {
	drifted := {"snippet": object.union(template_data.snippet, {"name": "Other"})}
	some msg in lint_text.deny with input as canonical_input with data.template as drifted
	contains(msg, "Other")
}
