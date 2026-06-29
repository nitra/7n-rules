# Перевірка `.claude/settings.json` для правила adr.mdc:
# `hooks.Stop[*]` має містити дві managed-групи — capture і normalize — у
# кожній хоча б один елемент `hooks[]` з відповідним маркером у `command`.
#
# Запуск (локально):
#   conftest test .claude/settings.json -p npm/rules/adr/policy \
#     --namespace adr.settings_json
#
# Hash-порівняння bash-скриптів з канонічними bundled-варіантами і `.gitignore`-перевірки
# — у JS (`js/check.mjs`).
#
# Структура каталогу збігається зі шляхом пакету (regal: directory-package-mismatch).
# Конвенція проєкту — `import rego.v1` + multi-value `deny contains msg if { … }`
# (.cursor/rules/conftest.mdc). Лінт — `bun run lint-rego` (regal).
package adr.settings_json

import rego.v1

capture_marker := ".claude/hooks/capture-decisions.sh"
normalize_marker := ".claude/hooks/normalize-decisions.sh"

deny contains msg if {
	not has_stop_hook_with_marker(capture_marker)
	msg := ".claude/settings.json: відсутній Stop-hook для `capture-decisions.sh` у hooks.Stop (adr.mdc)"
}

deny contains msg if {
	not has_stop_hook_with_marker(normalize_marker)
	msg := ".claude/settings.json: відсутній Stop-hook для `normalize-decisions.sh` у hooks.Stop (adr.mdc)"
}

# Чи є в `hooks.Stop[*].hooks[*].command` рядок з заданим маркером.
has_stop_hook_with_marker(marker) if {
	some group in object.get(object.get(input, "hooks", {}), "Stop", [])
	some hook in object.get(group, "hooks", [])
	contains(object.get(hook, "command", ""), marker)
}
