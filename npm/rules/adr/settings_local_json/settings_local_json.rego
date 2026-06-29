# Перевірка `.claude/settings.local.json` для правила adr.mdc: після переходу на
# project-shared `settings.json` цей файл (якщо є) НЕ повинен мати дубля жодного
# з керованих Stop-хуків (`capture-decisions.sh` або `normalize-decisions.sh`),
# інакше відповідний скрипт виконається двічі на одну подію.
#
# Запуск (локально):
#   conftest test .claude/settings.local.json -p npm/rules/adr/policy \
#     --namespace adr.settings_local_json
#
# Структура каталогу збігається зі шляхом пакету (regal: directory-package-mismatch).
# Конвенція проєкту — `import rego.v1` + multi-value `deny contains msg if { … }`
# (.cursor/rules/conftest.mdc). Лінт — `bun run lint-rego` (regal).
package adr.settings_local_json

import rego.v1

capture_marker := ".claude/hooks/capture-decisions.sh"
normalize_marker := ".claude/hooks/normalize-decisions.sh"

deny contains msg if {
	has_stop_hook_with_marker(capture_marker)
	msg := concat(" ", [
		".claude/settings.local.json: видали дубль Stop-хука для",
		"`capture-decisions.sh` — він уже у project-shared settings.json (adr.mdc)",
	])
}

deny contains msg if {
	has_stop_hook_with_marker(normalize_marker)
	msg := concat(" ", [
		".claude/settings.local.json: видали дубль Stop-хука для",
		"`normalize-decisions.sh` — він уже у project-shared settings.json (adr.mdc)",
	])
}

has_stop_hook_with_marker(marker) if {
	some group in object.get(object.get(input, "hooks", {}), "Stop", [])
	some hook in object.get(group, "hooks", [])
	contains(object.get(hook, "command", ""), marker)
}
