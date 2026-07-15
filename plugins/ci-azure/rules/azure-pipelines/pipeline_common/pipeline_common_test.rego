# Тести azure_pipelines.pipeline_common: обидві форми trigger, вкладені pool, deny-кейси.
package azure_pipelines.pipeline_common_test

import rego.v1

import data.azure_pipelines.pipeline_common

template_data := {"snippet": {
	"trigger": {"branches": {"include": ["dev", "main"]}},
	"pool": {"vmImage": "ubuntu-latest"},
}}

valid_object_form := {
	"trigger": {"branches": {"include": ["dev", "main"]}},
	"pool": {"vmImage": "ubuntu-latest"},
	"steps": [{"script": "echo ok"}],
}

valid_shorthand_form := {
	"trigger": ["dev", "main", "release/*"],
	"pool": {"vmImage": "ubuntu-latest"},
	"steps": [{"script": "echo ok"}],
}

test_valid_object_form_passes if {
	count(pipeline_common.deny) == 0 with input as valid_object_form with data.template as template_data
}

test_valid_shorthand_form_passes if {
	count(pipeline_common.deny) == 0 with input as valid_shorthand_form with data.template as template_data
}

test_nested_pool_in_jobs_passes if {
	wf := {
		"trigger": ["dev", "main"],
		"jobs": [{"job": "lint", "pool": {"vmImage": "ubuntu-latest"}, "steps": []}],
	}
	count(pipeline_common.deny) == 0 with input as wf with data.template as template_data
}

test_missing_trigger_denied if {
	wf := {"pool": {"vmImage": "ubuntu-latest"}}
	some msg in pipeline_common.deny with input as wf with data.template as template_data
	contains(msg, "trigger")
}

test_missing_branch_denied if {
	wf := {"trigger": ["main"], "pool": {"vmImage": "ubuntu-latest"}}
	some msg in pipeline_common.deny with input as wf with data.template as template_data
	contains(msg, "trigger має містити")
}

test_wrong_vm_image_denied if {
	wf := {"trigger": ["dev", "main"], "pool": {"vmImage": "windows-latest"}}
	some msg in pipeline_common.deny with input as wf with data.template as template_data
	contains(msg, "pool.vmImage має бути ubuntu-latest")
}

test_missing_pool_denied if {
	wf := {"trigger": ["dev", "main"], "steps": []}
	some msg in pipeline_common.deny with input as wf with data.template as template_data
	contains(msg, "pool.vmImage відсутній")
}
