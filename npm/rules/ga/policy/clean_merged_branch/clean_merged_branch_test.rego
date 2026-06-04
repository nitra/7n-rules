package ga.clean_merged_branch_test

import data.ga.clean_merged_branch
import rego.v1

# Mirrors template/clean-merged-branch.yml.snippet.yml.
# `yaml` npm package parses `dry_run: no` as the string "no" (YAML 1.2); rego
# below reads it as-is so the template literal flows through unchanged.
template_data := {"snippet": {
	"name": "Clean abandoned branches",
	"on": {
		"schedule": [{"cron": "0 1 15 * *"}],
		"workflow_dispatch": {},
	},
	"jobs": {"cleanup_old_branches": {
		"runs-on": "ubuntu-latest",
		"permissions": {
			"contents": "write",
			"pull-requests": "read",
		},
		"steps": [
			{
				"id": "delete_stuff",
				"name": "Delete those pesky dead branches",
				"uses": "phpdocker-io/github-actions-delete-abandoned-branches@v2.0.3",
				"with": {
					"github_token": "${{ github.token }}",
					"last_commit_age_days": 90,
					"ignore_branches": "main,dev",
					"dry_run": "no",
				},
			},
			{
				"name": "Get output",
				"env": {"DELETED_BRANCHES": "${{ steps.delete_stuff.outputs.deleted_branches }}"},
				"run": "echo \"Deleted branches: ${DELETED_BRANCHES}\"\n",
			},
		],
	}},
}}

canonical_input := {
	"name": "Clean abandoned branches",
	"true": {
		"schedule": [{"cron": "0 1 15 * *"}],
		"workflow_dispatch": {},
	},
	"jobs": {"cleanup_old_branches": {
		"permissions": {
			"contents": "write",
			"pull-requests": "read",
		},
		"steps": [
			{
				"id": "delete_stuff",
				"uses": "phpdocker-io/github-actions-delete-abandoned-branches@v2.0.3",
				"with": {
					"github_token": "${{ github.token }}",
					"last_commit_age_days": 90,
					"ignore_branches": "main,dev",
					"dry_run": false,
				},
			},
			{
				"name": "Get output",
				"env": {"DELETED_BRANCHES": "${{ steps.delete_stuff.outputs.deleted_branches }}"},
				"run": "echo \"Deleted branches: ${DELETED_BRANCHES}\"\n",
			},
		],
	}},
}

test_allow_canonical if {
	count(clean_merged_branch.deny) == 0 with input as canonical_input
		with data.template as template_data
}

test_deny_wrong_name if {
	bad := json.patch(canonical_input, [{"op": "replace", "path": "/name", "value": "Other"}])
	some msg in clean_merged_branch.deny with input as bad with data.template as template_data
	contains(msg, "name")
}

test_deny_wrong_cron if {
	bad := json.patch(canonical_input, [{"op": "replace", "path": "/true/schedule/0/cron", "value": "0 0 1 * *"}])
	some msg in clean_merged_branch.deny with input as bad with data.template as template_data
	contains(msg, "cron")
}

test_deny_wrong_age if {
	bad := json.patch(
		canonical_input,
		[{"op": "replace", "path": "/jobs/cleanup_old_branches/steps/0/with/last_commit_age_days", "value": 30}],
	)
	some msg in clean_merged_branch.deny with input as bad with data.template as template_data
	contains(msg, "last_commit_age_days")
}

test_deny_missing_pull_requests_permission if {
	bad := json.patch(
		canonical_input,
		[{"op": "remove", "path": "/jobs/cleanup_old_branches/permissions/pull-requests"}],
	)
	some msg in clean_merged_branch.deny with input as bad with data.template as template_data
	contains(msg, "permissions.pull-requests")
}

test_deny_ignore_branches_missing_dev if {
	bad := json.patch(
		canonical_input,
		[{"op": "replace", "path": "/jobs/cleanup_old_branches/steps/0/with/ignore_branches", "value": "main"}],
	)
	some msg in clean_merged_branch.deny with input as bad with data.template as template_data
	contains(msg, "ignore_branches")
}

# Drift test.
test_data_template_drives_name if {
	drifted := {"snippet": object.union(template_data.snippet, {"name": "Custom"})}
	some msg in clean_merged_branch.deny with input as canonical_input
		with data.template as drifted
	contains(msg, "Custom")
}
