# Перевірка `.github/workflows/lint-security.yml` (security.mdc).
#
# Канон надходить через --data: { "template": { "snippet": ... } }, побудоване
# з template/lint-security.yml.snippet.yml. З нього збирається перелік
# `uses:` action-refs security-job (виключаючи універсальні `actions/*`, які
# валідує `ga.workflow_common`).
#
# Структура каталогу збігається зі шляхом пакету (regal: directory-package-mismatch).
package security.lint_security_yml

import rego.v1

# Очікувані action-uses із template (не-`actions/*`).
expected_uses_blob := concat("\n", [u |
	some step in data.template.snippet.jobs.security.steps
	u := object.get(step, "uses", "")
	u != ""
	not startswith(u, "actions/")
])

# Усі `uses:` із input workflow.
all_uses_text := concat("\n", [u |
	some job in object.get(input, "jobs", {})
	some step in object.get(job, "steps", [])
	u := object.get(step, "uses", "")
	u != ""
])

deny contains msg if {
	expected_uses_blob != ""
	not contains(all_uses_text, expected_uses_blob)
	msg := sprintf("lint-security.yml: відсутній крок з uses %q (security.mdc)", [expected_uses_blob])
}
