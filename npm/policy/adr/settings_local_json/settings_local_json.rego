# Порт перевірки `.claude/settings.local.json` з `npm/scripts/check-adr.mjs`
# (adr.mdc): після переходу на project-shared `settings.json` цей файл (якщо є)
# НЕ повинен мати дубля Stop-хука з маркером `.claude/hooks/capture-decisions.sh`,
# інакше один і той самий скрипт виконається двічі на одну подію.
#
# Запуск (локально):
#   conftest test .claude/settings.local.json -p npm/policy/adr \
#     --namespace adr.settings_local_json
#
# Структура каталогу збігається зі шляхом пакету (regal: directory-package-mismatch).
# Конвенція проєкту — `import rego.v1` + multi-value `deny contains msg if { … }`
# (.cursor/rules/conftest.mdc). Лінт — `bun run lint-rego` (regal).
package adr.settings_local_json

import rego.v1

hook_command_marker := ".claude/hooks/capture-decisions.sh"

duplicate_template := concat(" ", [
	".claude/settings.local.json: видали дубль Stop-хука для",
	"`capture-decisions.sh` — він уже у project-shared settings.json (adr.mdc)",
])

deny contains duplicate_template if {
	some group in object.get(object.get(input, "hooks", {}), "Stop", [])
	some hook in object.get(group, "hooks", [])
	contains(object.get(hook, "command", ""), hook_command_marker)
}
