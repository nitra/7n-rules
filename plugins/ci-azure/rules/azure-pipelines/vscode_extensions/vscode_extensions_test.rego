# Тести azure_pipelines.vscode_extensions: subset-перевірка recommendations.
package azure_pipelines.vscode_extensions_test

import rego.v1

import data.azure_pipelines.vscode_extensions

template_data := {"snippet": {"recommendations": ["ms-azure-devops.azure-pipelines"]}}

test_present_passes if {
	inp := {"recommendations": ["ms-azure-devops.azure-pipelines", "other.ext"]}
	count(vscode_extensions.deny) == 0 with input as inp with data.template as template_data
}

test_missing_denied if {
	inp := {"recommendations": ["other.ext"]}
	some msg in vscode_extensions.deny with input as inp with data.template as template_data
	contains(msg, "ms-azure-devops.azure-pipelines")
}

test_empty_input_denied if {
	some msg in vscode_extensions.deny with input as {} with data.template as template_data
	contains(msg, "recommendations")
}
