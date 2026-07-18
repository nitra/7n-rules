package azure_pipelines.service_deploy_pipeline_test

import data.azure_pipelines.service_deploy_pipeline
import rego.v1

checkout_full := {"checkout": "self", "fetchDepth": 0}

prep_steps := [
	checkout_full,
	{"script": "curl -fsSL https://bun.sh/install | bash", "displayName": "Install bun"},
	{"script": "bun install --frozen-lockfile", "displayName": "Install deps"},
]

skip_tolerant_cond := "and(not(canceled()), eq(dependencies.plan.result, 'Succeeded'), in(dependencies.lint_js.result, 'Succeeded', 'Skipped'), in(dependencies.run_tests.result, 'Succeeded', 'Skipped'))"

canonical_input := {
	"trigger": {"branches": {"include": ["dev", "main"]}, "paths": {"include": ["run/nexus"]}},
	"pool": {"vmImage": "ubuntu-latest"},
	"jobs": [
		{"job": "plan", "steps": array.concat(prep_steps, [{
			"script": "bunx n-rules ci plan --path run/nexus --azure",
			"name": "plan",
		}])},
		{
			"job": "lint_js",
			"dependsOn": "plan",
			"condition": "eq(dependencies.plan.outputs['plan.js'], 'true')",
			"steps": array.concat(prep_steps, [{"script": "bunx n-rules lint js --path run/nexus --no-fix"}]),
		},
		{
			"job": "run_tests",
			"dependsOn": "plan",
			"condition": "eq(dependencies.plan.outputs['plan.any'], 'true')",
			"steps": array.concat(prep_steps, [{"script": "bun test run/nexus"}]),
		},
		{
			"job": "build_and_push",
			"dependsOn": ["plan", "lint_js", "run_tests"],
			"condition": skip_tolerant_cond,
			"steps": [{"script": "echo build"}],
		},
	],
}

test_allow_canonical if {
	count(service_deploy_pipeline.deny) == 0 with input as canonical_input
}

# Repo-wide pipeline без paths-фільтра — поза каноном, нуль deny.
test_no_paths_no_deny if {
	wf := {"trigger": {"branches": {"include": ["dev", "main"]}}, "jobs": [{"job": "x", "steps": [{"script": "bunx n-rules lint --no-fix --full"}]}]}
	count(service_deploy_pipeline.deny) == 0 with input as wf
}

# Stages-розкладка: джоби збираються walk-ом на будь-якій глибині.
test_allow_stages_layout if {
	wf := {
		"trigger": canonical_input.trigger,
		"stages": [{"stage": "check", "jobs": canonical_input.jobs}],
	}
	count(service_deploy_pipeline.deny) == 0 with input as wf
}

# Template-розкладка efes-стилю: `- template:` з параметром-каталогом сервісу.
test_allow_template_layout if {
	wf := {
		"trigger": canonical_input.trigger,
		"jobs": [{"template": "templates/deploy-service.yml", "parameters": {"modulePath": "run/nexus"}}],
	}
	count(service_deploy_pipeline.deny) == 0 with input as wf
}

test_deny_template_param_mismatch if {
	wf := {
		"trigger": canonical_input.trigger,
		"jobs": [{"template": "templates/deploy-service.yml", "parameters": {"modulePath": "run/other"}}],
	}
	some msg in service_deploy_pipeline.deny with input as wf
	contains(msg, "template")
}

test_deny_missing_plan_job if {
	wf := json.patch(canonical_input, [{"op": "remove", "path": "/jobs/0"}])
	some msg in service_deploy_pipeline.deny with input as wf
	contains(msg, "немає job `plan`")
}

test_deny_plan_without_azure_flag if {
	wf := json.patch(canonical_input, [{
		"op": "replace",
		"path": "/jobs/0/steps/3/script",
		"value": "bunx n-rules ci plan --path run/nexus",
	}])
	some msg in service_deploy_pipeline.deny with input as wf
	contains(msg, "--azure")
}

test_deny_plan_step_without_name if {
	wf := json.patch(canonical_input, [{"op": "remove", "path": "/jobs/0/steps/3/name"}])
	some msg in service_deploy_pipeline.deny with input as wf
	contains(msg, "name: plan")
}

test_deny_plan_path_outside_trigger if {
	wf := json.patch(canonical_input, [{
		"op": "replace",
		"path": "/jobs/0/steps/3/script",
		"value": "bunx n-rules ci plan --path run/other --azure",
	}])
	some msg in service_deploy_pipeline.deny with input as wf
	contains(msg, "trigger.paths.include")
}

test_deny_lint_without_depends_on_plan if {
	wf := json.patch(canonical_input, [{"op": "remove", "path": "/jobs/1/dependsOn"}])
	some msg in service_deploy_pipeline.deny with input as wf
	contains(msg, "dependsOn: plan")
}

test_deny_lint_without_condition_gate if {
	wf := json.patch(canonical_input, [{"op": "remove", "path": "/jobs/1/condition"}])
	some msg in service_deploy_pipeline.deny with input as wf
	contains(msg, "dependencies.plan.outputs['plan.js']")
}

test_deny_lint_without_no_fix if {
	wf := json.patch(canonical_input, [{
		"op": "replace",
		"path": "/jobs/1/steps/3/script",
		"value": "bunx n-rules lint js --path run/nexus",
	}])
	some msg in service_deploy_pipeline.deny with input as wf
	contains(msg, "--no-fix")
}

test_deny_lint_without_prep if {
	wf := json.patch(canonical_input, [{
		"op": "replace",
		"path": "/jobs/1/steps",
		"value": [checkout_full, {"script": "bunx n-rules lint js --path run/nexus --no-fix"}],
	}])
	some msg in service_deploy_pipeline.deny with input as wf
	contains(msg, "bun install --frozen-lockfile")
}

test_deny_plan_shallow_checkout if {
	wf := json.patch(canonical_input, [{"op": "replace", "path": "/jobs/0/steps/0", "value": {"checkout": "self"}}])
	some msg in service_deploy_pipeline.deny with input as wf
	contains(msg, "fetchDepth")
}

test_deny_terminal_not_reaching_check if {
	wf := json.patch(canonical_input, [{
		"op": "replace",
		"path": "/jobs/3/dependsOn",
		"value": ["plan", "run_tests"],
	}])
	some msg in service_deploy_pipeline.deny with input as wf
	contains(msg, "lint_js")
}

test_deny_terminal_without_skip_tolerant_condition if {
	wf := json.patch(canonical_input, [{"op": "remove", "path": "/jobs/3/condition"}])
	some msg in service_deploy_pipeline.deny with input as wf
	contains(msg, "Skipped")
}

# Ланцюг deploy → build_and_push: транзитивна досяжність задовольняє канон.
test_allow_chained_deploy if {
	wf := json.patch(canonical_input, [{"op": "add", "path": "/jobs/-", "value": {
		"job": "deploy_to_aks",
		"dependsOn": ["build_and_push"],
		"condition": "and(not(canceled()), in(dependencies.build_and_push.result, 'Succeeded', 'Skipped'))",
		"steps": [{"script": "echo deploy"}],
	}}])
	count(service_deploy_pipeline.deny) == 0 with input as wf
}
