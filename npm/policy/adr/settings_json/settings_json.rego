# Порт перевірки `.claude/settings.json` з `npm/scripts/check-adr.mjs` (adr.mdc):
# `hooks.Stop[*]` має містити групу, де хоча б один елемент `hooks[]` має `command`
# зі substring `.claude/hooks/capture-decisions.sh`.
#
# Запуск (локально):
#   conftest test .claude/settings.json -p npm/policy/adr \
#     --namespace adr.settings_json
#
# Hash-порівняння bash-скрипта з канонічним bundled-варіантом і `.gitignore`-перевірки
# — у JS (`check-adr.mjs`).
#
# Структура каталогу збігається зі шляхом пакету (regal: directory-package-mismatch).
# Конвенція проєкту — `import rego.v1` + multi-value `deny contains msg if { … }`
# (.cursor/rules/conftest.mdc). Лінт — `bun run lint-rego` (regal).
package adr.settings_json

import rego.v1

hook_command_marker := ".claude/hooks/capture-decisions.sh"

deny contains msg if {
	not has_adr_stop_hook
	msg := ".claude/settings.json: відсутній Stop-hook для `capture-decisions.sh` у hooks.Stop (adr.mdc)"
}

# Чи є в `hooks.Stop[*].hooks[*].command` рядок з маркером скрипта.
has_adr_stop_hook if {
	some group in object.get(object.get(input, "hooks", {}), "Stop", [])
	some hook in object.get(group, "hooks", [])
	contains(object.get(hook, "command", ""), hook_command_marker)
}
