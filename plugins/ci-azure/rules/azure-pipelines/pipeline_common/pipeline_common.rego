# Перевірка базової структури `azure-pipelines.yml` (azure-pipelines.mdc).
#
# Канон надходить через --data: { "template": { "snippet": ... } }
# Структура --data сформована з template/azure-pipelines.yml.snippet.yml.
#
# Конвенція проєкту — `import rego.v1` + multi-value `deny contains msg if { … }`
# (conftest.mdc). Лінт — `n-rules lint rego` (regal).
package azure_pipelines.pipeline_common

import rego.v1

expected_trigger_branches := {b | some b in data.template.snippet.trigger.branches.include}

expected_vm_image := data.template.snippet.pool.vmImage

# `trigger` у input: обʼєктна форма `trigger.branches.include` …
actual_trigger_branches := {b | some b in input.trigger.branches.include} if {
	is_object(input.trigger)
}

# … або shorthand `trigger: [dev, main]`.
actual_trigger_branches := {b | some b in input.trigger} if {
	is_array(input.trigger)
}

# Усі `pool.vmImage` на будь-якій глибині (root, stages/jobs).
vm_images contains img if {
	walk(input, [_, node])
	is_object(node)
	img := node.pool.vmImage
	is_string(img)
}

deny contains msg if {
	not input.trigger
	msg := "azure-pipelines.yml: блок trigger відсутній (azure-pipelines.mdc)"
}

deny contains msg if {
	input.trigger
	missing := expected_trigger_branches - actual_trigger_branches
	count(missing) > 0
	msg := sprintf("azure-pipelines.yml: trigger має містити гілки %v (azure-pipelines.mdc)", [missing])
}

deny contains msg if {
	count(vm_images) == 0
	msg := "azure-pipelines.yml: pool.vmImage відсутній (azure-pipelines.mdc)"
}

deny contains msg if {
	count(vm_images) > 0
	not expected_vm_image in vm_images
	msg := sprintf("azure-pipelines.yml: pool.vmImage має бути %s (azure-pipelines.mdc)", [expected_vm_image])
}
