package js_run.configmap_test

import data.js_run.configmap
import rego.v1

template_data := {"contains": {"data": {"OTEL_RESOURCE_ATTRIBUTES": ["service.name=", "service.namespace="]}}}

test_allow_canonical if {
	cm := {
		"kind": "ConfigMap",
		"metadata": {"name": "demo"},
		"data": {"OTEL_RESOURCE_ATTRIBUTES": "service.name=demo,service.namespace=prod"},
	}
	count(configmap.deny) == 0 with input as cm with data.template as template_data
}

test_deny_missing_service_name if {
	cm := {
		"kind": "ConfigMap",
		"metadata": {"name": "demo"},
		"data": {"OTEL_RESOURCE_ATTRIBUTES": "service.namespace=prod"},
	}
	some msg in configmap.deny with input as cm with data.template as template_data
	contains(msg, "service.name=")
}

test_allow_non_configmap_kind if {
	count(configmap.deny) == 0 with input as {"kind": "Deployment"} with data.template as template_data
}

# Drift test.
test_data_template_drives_substring if {
	cm := {
		"kind": "ConfigMap",
		"metadata": {"name": "demo"},
		"data": {"OTEL_RESOURCE_ATTRIBUTES": "service.name=x"},
	}
	some msg in configmap.deny with input as cm
		with data.template as {"contains": {"data": {"OTEL_RESOURCE_ATTRIBUTES": ["custom-marker="]}}}
	contains(msg, "custom-marker=")
}
