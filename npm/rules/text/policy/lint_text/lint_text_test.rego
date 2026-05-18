package text.lint_text_test

import data.text.lint_text
import rego.v1

shellcheck_install_run := "sudo apt-get update && sudo apt-get install -y shellcheck"

dotenv_install_run := "curl -sSfL https://git.io/JLbXn | sh -s -- -b /usr/local/bin"

push_paths := [
	"**/*.js", "**/*.ts", "**/*.vue", "**/*.html", "**/*.css", "**/*.scss", "**/*.less",
	"**/*.json", "**/*.jsonc", "**/*.yaml", "**/*.yml", "**/*.toml", "**/*.xml",
	"**/*.md", "**/*.mdc", "**/*.mdс", "**/*.txt", "**/*.go", "**/*.py", "**/*.php", "**/*.sh",
]

template_data := {"snippet": {
	"name": "Lint Text",
	"on": {
		"push": {"branches": ["dev", "main"], "paths": push_paths},
		"pull_request": {"branches": ["dev", "main"]},
	},
	"jobs": {"text": {
		"runs-on": "ubuntu-latest",
		"permissions": {"contents": "read"},
		"steps": [
			{"uses": "actions/checkout@v6", "with": {"persist-credentials": false}},
			{"uses": "./.github/actions/setup-bun-deps"},
			{"name": "Install shellcheck", "run": shellcheck_install_run},
			{"name": "Install dotenv-linter", "run": dotenv_install_run},
			{"name": "Lint text", "run": "bun run lint-text"},
		],
	}},
}}

canonical_input := {
	"name": "Lint Text",
	"on": {
		"push": {"branches": ["dev", "main"], "paths": push_paths},
		"pull_request": {"branches": ["dev", "main"]},
	},
	"jobs": {"text": {
		"runs-on": "ubuntu-latest",
		"permissions": {"contents": "read"},
		"steps": [
			{"uses": "actions/checkout@v6", "with": {"persist-credentials": false}},
			{"uses": "./.github/actions/setup-bun-deps"},
			{"name": "Install shellcheck", "run": shellcheck_install_run},
			{"name": "Install dotenv-linter", "run": dotenv_install_run},
			{"name": "Lint text", "run": "bun run lint-text"},
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
	contains(msg, "bun run lint-text")
}

test_data_template_drives_name if {
	drifted := {"snippet": object.union(template_data.snippet, {"name": "Other"})}
	some msg in lint_text.deny with input as canonical_input with data.template as drifted
	contains(msg, "Other")
}
