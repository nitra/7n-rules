# Перевірка `.vscode/settings.json` для text (text.mdc).
#
# Запуск (локально):
#   conftest test .vscode/settings.json -p npm/policy/text/vscode_settings \
#     --namespace text.vscode_settings
#
# Canonical (text.mdc):
#   { "editor.formatOnSave": true,
#     "[javascript]": { "editor.defaultFormatter": "oxc.oxc-vscode" },
#     "[typescript]": { "editor.defaultFormatter": "oxc.oxc-vscode" },
#     "[json]":       { "editor.defaultFormatter": "oxc.oxc-vscode" },
#     "[vue]":        { "editor.defaultFormatter": "oxc.oxc-vscode" },
#     "[css]":        { "editor.defaultFormatter": "oxc.oxc-vscode" },
#     "[html]":       { "editor.defaultFormatter": "oxc.oxc-vscode" } }
#
# Структура каталогу збігається зі шляхом пакету (regal: directory-package-mismatch).
package text.vscode_settings

import rego.v1

language_keys := {"[javascript]", "[typescript]", "[json]", "[vue]", "[css]", "[html]"}

# Шаблони повідомлень — через `concat` для regal style/line-length.
lang_block_not_object_template := concat(" ", [
	".vscode/settings.json: %q має бути обʼєктом з",
	"\"editor.defaultFormatter\": \"oxc.oxc-vscode\" (text.mdc)",
])

lang_wrong_formatter_template := concat(" ", [
	".vscode/settings.json: %q має використовувати",
	"\"oxc.oxc-vscode\" як editor.defaultFormatter (text.mdc)",
])

# ── deny: editor.formatOnSave ────────────────────────────────────────────

deny contains msg if {
	object.get(input, "editor.formatOnSave", null) != true
	msg := ".vscode/settings.json: \"editor.formatOnSave\" має бути true (text.mdc)"
}

# ── deny: [lang].editor.defaultFormatter ────────────────────────────────

deny contains msg if {
	some key in language_keys
	block := object.get(input, key, {})
	not is_object(block)
	msg := sprintf(lang_block_not_object_template, [key])
}

deny contains msg if {
	some key in language_keys
	block := object.get(input, key, {})
	is_object(block)
	object.get(block, "editor.defaultFormatter", null) != "oxc.oxc-vscode"
	msg := sprintf(lang_wrong_formatter_template, [key])
}
