package ga.git_ai_test

import data.ga.git_ai
import rego.v1

# Mirrors template/git-ai.yml.snippet.yml.
template_data := {"snippet": {
	"name": "Git AI",
	"on": {"pull_request": {"types": ["closed"]}},
	"jobs": {"git-ai": {
		"if": "github.event.pull_request.merged == true",
		"runs-on": "ubuntu-latest",
		"permissions": {"contents": "write"},
		"steps": [
			{
				"name": "Install git-ai",
				"run": "curl -fsSL https://usegitai.com/install.sh | bash\necho \"$HOME/.git-ai/bin\" >> $GITHUB_PATH\n",
			},
			{
				"name": "Run git-ai",
				"id": "run-git-ai",
				"env": {"GITHUB_TOKEN": "${{ secrets.GITHUB_TOKEN }}"},
				"run": "git config --global user.name \"github-actions[bot]\"\ngit-ai ci github run\n",
			},
		],
	}},
}}

canonical_input := {
	"name": "Git AI",
	"true": {"pull_request": {"types": ["closed"]}},
	"jobs": {"git-ai": {
		"if": "github.event.pull_request.merged == true",
		"runs-on": "ubuntu-latest",
		"permissions": {"contents": "write"},
		"steps": [
			{
				"name": "Install git-ai",
				"run": "curl -fsSL https://usegitai.com/install.sh | bash\necho \"$HOME/.git-ai/bin\" >> $GITHUB_PATH\n",
			},
			{
				"name": "Run git-ai",
				"id": "run-git-ai",
				"env": {"GITHUB_TOKEN": "${{ secrets.GITHUB_TOKEN }}"},
				"run": "git-ai ci github run\n",
			},
		],
	}},
}

test_allow_canonical if {
	count(git_ai.deny) == 0 with input as canonical_input with data.template as template_data
}

test_deny_wrong_name if {
	bad := json.patch(canonical_input, [{"op": "replace", "path": "/name", "value": "Other"}])
	some msg in git_ai.deny with input as bad with data.template as template_data
	contains(msg, "name")
}

test_deny_missing_closed_in_types if {
	bad := json.patch(canonical_input, [{"op": "replace", "path": "/true/pull_request/types", "value": ["opened"]}])
	some msg in git_ai.deny with input as bad with data.template as template_data
	contains(msg, "closed")
}

test_deny_wrong_if if {
	bad := json.patch(canonical_input, [{"op": "replace", "path": "/jobs/git-ai/if", "value": "true"}])
	some msg in git_ai.deny with input as bad with data.template as template_data
	contains(msg, "github.event.pull_request.merged")
}

test_deny_wrong_permissions if {
	bad := json.patch(canonical_input, [{"op": "replace", "path": "/jobs/git-ai/permissions", "value": {"contents": "read"}}])
	some msg in git_ai.deny with input as bad with data.template as template_data
	contains(msg, "contents")
}

test_deny_missing_install_substring if {
	bad := json.patch(canonical_input, [{"op": "replace", "path": "/jobs/git-ai/steps/0/run", "value": "echo nothing"}])
	some msg in git_ai.deny with input as bad with data.template as template_data
	contains(msg, "git-ai")
}

test_deny_missing_run_substring if {
	bad := json.patch(canonical_input, [{"op": "replace", "path": "/jobs/git-ai/steps/1/run", "value": "echo nothing"}])
	some msg in git_ai.deny with input as bad with data.template as template_data
	contains(msg, "git-ai ci github run")
}

# Drift test.
test_data_template_drives_name if {
	drifted := {"snippet": object.union(template_data.snippet, {"name": "Custom"})}
	some msg in git_ai.deny with input as canonical_input with data.template as drifted
	contains(msg, "Custom")
}
