# Порт перевірки `.markdownlint-cli2.jsonc` з `npm/scripts/check-text.mjs` (text.mdc).
#
# Запуск (локально):
#   conftest test .markdownlint-cli2.jsonc -p npm/policy/text \
#     --namespace text.markdownlint --parser json
#
# Конфтест парсить `.jsonc` як JSON лише якщо файл — валідний JSON (без коментарів).
# У випадку справжнього JSONC з `//` коментарями цей крок мовчки ігноруватиметься
# (conftest skip). FS-перевірка (наявність файлу) живе у JS.
#
# Перевіряє канонічний baseline з text.mdc (мінімум — додаткові ключі дозволені):
#   { "gitignore": true,
#     "config": { "default": true, "MD013": false, "MD024": {"siblings_only": true},
#                 "MD029": false, "MD040": false, "MD041": false } }
# MD041 off навмисно — `.mdc` з frontmatter (див. text.mdc).
#
# Структура каталогу збігається зі шляхом пакету (regal: directory-package-mismatch).
# Конвенція проєкту — `import rego.v1` + multi-value `deny contains msg if { … }`
# (.cursor/rules/conftest.mdc). Лінт — `bun run lint-rego` (regal).
package text.markdownlint

import rego.v1

# ── Шаблони повідомлень ────────────────────────────────────────────────────

config_rule_template := concat(" ", [
	".markdownlint-cli2.jsonc: config.%s має бути %v",
	"(зараз: %v) (text.mdc)",
])

# ── deny: gitignore ───────────────────────────────────────────────────────

deny contains msg if {
	object.get(input, "gitignore", null) != true
	msg := ".markdownlint-cli2.jsonc: додай на верхньому рівні \"gitignore\": true (text.mdc)"
}

# ── deny: config.default ──────────────────────────────────────────────────

deny contains msg if {
	config := object.get(input, "config", {})
	object.get(config, "default", null) != true
	msg := sprintf(config_rule_template, ["default", true, object.get(config, "default", null)])
}

# ── deny: MD013 / MD029 / MD040 / MD041 повинні бути `false` ──────────────

deny contains msg if {
	config := object.get(input, "config", {})
	some rule in {"MD013", "MD029", "MD040", "MD041"}
	object.get(config, rule, null) != false
	msg := sprintf(config_rule_template, [rule, false, object.get(config, rule, null)])
}

# ── deny: MD024.siblings_only == true ─────────────────────────────────────

deny contains msg if {
	config := object.get(input, "config", {})
	md024 := object.get(config, "MD024", null)
	not is_object(md024)
	msg := sprintf(config_rule_template, ["MD024", "{\"siblings_only\": true}", md024])
}

deny contains msg if {
	config := object.get(input, "config", {})
	md024 := object.get(config, "MD024", {})
	is_object(md024)
	object.get(md024, "siblings_only", null) != true
	msg := sprintf(config_rule_template, ["MD024.siblings_only", true, object.get(md024, "siblings_only", null)])
}
