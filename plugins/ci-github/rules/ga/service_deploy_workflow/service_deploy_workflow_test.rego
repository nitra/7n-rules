package ga.service_deploy_workflow_test

import data.ga.service_deploy_workflow
import rego.v1

checkout_full := {"uses": "actions/checkout@v6", "with": {"persist-credentials": false, "fetch-depth": 0}}

prep := {"uses": "./.github/actions/setup-bun-deps"}

canonical_input := {
	"on": {"push": {"branches": ["dev", "main"], "paths": ["run/nexus/**"]}},
	"jobs": {
		"plan": {"steps": [
			checkout_full,
			prep,
			{"id": "plan", "run": "bunx n-rules ci plan --path run/nexus --github"},
		]},
		"lint-js": {
			"needs": "plan",
			"if": "needs.plan.outputs.js == 'true'",
			"steps": [
				checkout_full,
				prep,
				{"run": "bunx n-rules lint js --path run/nexus --no-fix"},
			],
		},
		"test": {"needs": "plan", "steps": [checkout_full, prep, {"run": "bun test run/nexus"}]},
		"deploy": {
			"needs": ["plan", "lint-js", "test"],
			"if": "${{ !cancelled() && needs.plan.result == 'success' && !contains(needs.*.result, 'failure') && !contains(needs.*.result, 'cancelled') }}",
			"steps": [{"run": "echo deploy"}],
		},
	},
}

test_allow_canonical if {
	count(service_deploy_workflow.deny) == 0 with input as canonical_input
}

# Ланцюг deploy → build → перевірки: транзитивна досяжність задовольняє канон.
chained_input := object.union(canonical_input, {"jobs": object.union(canonical_input.jobs, {
	"build": {
		"needs": ["plan", "lint-js", "test"],
		"if": "${{ !cancelled() && !contains(needs.*.result, 'failure') }}",
		"steps": [{"run": "echo build"}],
	},
	"deploy": {
		"needs": ["build"],
		"if": "${{ !cancelled() && !contains(needs.*.result, 'failure') }}",
		"steps": [{"run": "echo deploy"}],
	},
})})

test_allow_chained_deploy if {
	count(service_deploy_workflow.deny) == 0 with input as chained_input
}

test_deny_missing_plan_job if {
	wf := {"jobs": {"deploy": {"steps": [{"run": "echo x"}]}}}
	some msg in service_deploy_workflow.deny with input as wf
	contains(msg, "немає job `plan`")
}

test_deny_plan_without_github_flag if {
	wf := json.patch(canonical_input, [{
		"op": "replace",
		"path": "/jobs/plan/steps/2/run",
		"value": "bunx n-rules ci plan --path run/nexus",
	}])
	some msg in service_deploy_workflow.deny with input as wf
	contains(msg, "--github")
}

test_deny_trigger_paths_mismatch if {
	wf := json.patch(canonical_input, [{
		"op": "replace",
		"path": "/on/push/paths",
		"value": ["run/other/**"],
	}])
	some msg in service_deploy_workflow.deny with input as wf
	contains(msg, "on.push.paths")
}

test_deny_lint_without_needs_plan if {
	wf := json.patch(canonical_input, [{"op": "remove", "path": "/jobs/lint-js/needs"}])
	some msg in service_deploy_workflow.deny with input as wf
	contains(msg, "needs: plan")
}

test_deny_lint_without_output_gate if {
	wf := json.patch(canonical_input, [{"op": "remove", "path": "/jobs/lint-js/if"}])
	some msg in service_deploy_workflow.deny with input as wf
	contains(msg, "needs.plan.outputs.js")
}

test_deny_lint_path_mismatch if {
	wf := json.patch(canonical_input, [{
		"op": "replace",
		"path": "/jobs/lint-js/steps/2/run",
		"value": "bunx n-rules lint js --path run/other --no-fix",
	}])
	some msg in service_deploy_workflow.deny with input as wf
	contains(msg, "інший каталог")
}

test_deny_lint_without_no_fix if {
	wf := json.patch(canonical_input, [{
		"op": "replace",
		"path": "/jobs/lint-js/steps/2/run",
		"value": "bunx n-rules lint js --path run/nexus",
	}])
	some msg in service_deploy_workflow.deny with input as wf
	contains(msg, "--no-fix")
}

test_deny_lint_without_prep if {
	wf := json.patch(canonical_input, [{
		"op": "replace",
		"path": "/jobs/lint-js/steps",
		"value": [checkout_full, {"run": "bunx n-rules lint js --path run/nexus --no-fix"}],
	}])
	some msg in service_deploy_workflow.deny with input as wf
	contains(msg, "setup-bun-deps")
}

test_deny_plan_shallow_checkout if {
	wf := json.patch(canonical_input, [{
		"op": "replace",
		"path": "/jobs/plan/steps/0",
		"value": {"uses": "actions/checkout@v6", "with": {"persist-credentials": false}},
	}])
	some msg in service_deploy_workflow.deny with input as wf
	contains(msg, "fetch-depth")
}

test_deny_deploy_not_reaching_check if {
	wf := json.patch(canonical_input, [{"op": "replace", "path": "/jobs/deploy/needs", "value": ["plan", "test"]}])
	some msg in service_deploy_workflow.deny with input as wf
	contains(msg, "lint-js")
}

test_deny_deploy_without_skip_tolerant_if if {
	wf := json.patch(canonical_input, [{"op": "remove", "path": "/jobs/deploy/if"}])
	some msg in service_deploy_workflow.deny with input as wf
	contains(msg, "!cancelled()")
}

# YAML 1.1-парсер: ключ `on` стає bool true — тригер-перевірка все одно бачить paths.
test_yaml11_on_key_supported if {
	wf := object.union(object.remove(canonical_input, ["on"]), {true: {"push": {"paths": ["run/nexus/**"]}}})
	count(service_deploy_workflow.deny) == 0 with input as wf
}

# conftest-конвеєр YAML→JSON: bool-ключ `on` серіалізується в РЯДОК "true".
test_conftest_stringified_on_key_supported if {
	wf := object.union(object.remove(canonical_input, ["on"]), {"true": {"push": {"paths": ["run/nexus/**"]}}})
	count(service_deploy_workflow.deny) == 0 with input as wf
}
