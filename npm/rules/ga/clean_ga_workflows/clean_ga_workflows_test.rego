package ga.clean_ga_workflows_test

import data.ga.clean_ga_workflows
import rego.v1

# Mirrors template/clean-ga-workflows.yml.snippet.yml (literals only — full canon).
template_data := {"snippet": {
	"name": "Clean action for removing completed workflow runs",
	"on": {
		"schedule": [{"cron": "0 1 16 * *"}],
		"workflow_dispatch": {},
	},
	"jobs": {"cleanup_old_workflows": {
		"runs-on": "ubuntu-latest",
		"permissions": {"actions": "write", "contents": "read"},
		"steps": [{
			"name": "Delete workflow runs",
			"uses": "dmvict/clean-workflow-runs@v1",
			"with": {
				"token": "${{ github.token }}",
				"save_period": 31,
				"save_min_runs_number": 0,
			},
		}],
	}},
}}

# Канонічний input — той самий що template, але `on` → `true` через YAML 1.1
# quirk у Go-yaml парсері conftest. Структурно ідентичний template.
canonical_input := {
	"name": "Clean action for removing completed workflow runs",
	"true": {
		"schedule": [{"cron": "0 1 16 * *"}],
		"workflow_dispatch": {},
	},
	"jobs": {"cleanup_old_workflows": {
		"runs-on": "ubuntu-latest",
		"permissions": {"actions": "write", "contents": "read"},
		"steps": [{
			"name": "Delete workflow runs",
			"uses": "dmvict/clean-workflow-runs@v1",
			"with": {
				"token": "${{ github.token }}",
				"save_period": 31,
				"save_min_runs_number": 0,
			},
		}],
	}},
}

test_allow_canonical if {
	count(clean_ga_workflows.deny) == 0 with input as canonical_input
		with data.template as template_data
}

test_deny_wrong_name if {
	bad := json.patch(canonical_input, [{"op": "replace", "path": "/name", "value": "Other"}])
	some msg in clean_ga_workflows.deny with input as bad with data.template as template_data
	contains(msg, "name")
}

test_deny_wrong_cron if {
	bad := json.patch(canonical_input, [{"op": "replace", "path": "/true/schedule/0/cron", "value": "0 0 1 * *"}])
	some msg in clean_ga_workflows.deny with input as bad with data.template as template_data
	contains(msg, "cron")
}

test_deny_wrong_runs_on if {
	bad := json.patch(
		canonical_input,
		[{"op": "replace", "path": "/jobs/cleanup_old_workflows/runs-on", "value": "ubuntu-22.04"}],
	)
	some msg in clean_ga_workflows.deny with input as bad with data.template as template_data
	contains(msg, "ubuntu-latest")
}

test_deny_missing_workflow_dispatch if {
	bad := json.patch(canonical_input, [{"op": "remove", "path": "/true/workflow_dispatch"}])
	some msg in clean_ga_workflows.deny with input as bad with data.template as template_data
	contains(msg, "workflow_dispatch")
}

test_deny_wrong_save_period if {
	bad := json.patch(
		canonical_input,
		[{"op": "replace", "path": "/jobs/cleanup_old_workflows/steps/0/with/save_period", "value": 7}],
	)
	some msg in clean_ga_workflows.deny with input as bad with data.template as template_data
	contains(msg, "save_period")
}

# SHA-пін (zizmor ref-pin) задовольняє канонічний тег — фіксер не даунгрейдить.
test_allow_sha_pinned_uses if {
	pinned := json.patch(canonical_input, [{
		"op": "replace",
		"path": "/jobs/cleanup_old_workflows/steps/0/uses",
		"value": "dmvict/clean-workflow-runs@bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
	}])
	count(clean_ga_workflows.deny) == 0 with input as pinned with data.template as template_data
}

test_deny_sha_pin_of_other_action if {
	bad := json.patch(canonical_input, [{
		"op": "replace",
		"path": "/jobs/cleanup_old_workflows/steps/0/uses",
		"value": "someone/else@bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
	}])
	some msg in clean_ga_workflows.deny with input as bad with data.template as template_data
	contains(msg, "uses")
}

# Drift test: ensures rego reads expected values from data.template.
test_data_template_drives_name if {
	drifted := {"snippet": object.union(
		template_data.snippet,
		{"name": "Custom workflow name"},
	)}
	some msg in clean_ga_workflows.deny with input as canonical_input
		with data.template as drifted
	contains(msg, "Custom workflow name")
}
