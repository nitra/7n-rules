# Перевірка `.vscode/settings.json` для GitHub Actions workflow (ga.mdc).
#
# Мова `github-actions-workflow` має форматуватись через `oxc.oxc-vscode`,
# узгоджено з oxc для YAML/workflow.
#
# Структура каталогу збігається зі шляхом пакету (regal: directory-package-mismatch).
# Конвенція проєкту — `import rego.v1` + multi-value `deny contains msg if { … }`
# (.cursor/rules/conftest.mdc). Лінт — `bun run lint-rego` (regal).
package ga.vscode_settings

import rego.v1

deny contains msg if {
	block := object.get(input, "[github-actions-workflow]", null)
	not is_object(block)
	msg := ".vscode/settings.json: додай \"[github-actions-workflow]\": { \"editor.defaultFormatter\": \"oxc.oxc-vscode\" } (ga.mdc)"
}

deny contains msg if {
	block := object.get(input, "[github-actions-workflow]", null)
	is_object(block)
	object.get(block, "editor.defaultFormatter", null) != "oxc.oxc-vscode"
	msg := ".vscode/settings.json: [github-actions-workflow].editor.defaultFormatter має бути \"oxc.oxc-vscode\" (ga.mdc)"
}
