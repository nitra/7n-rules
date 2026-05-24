# Перевірка `package.json` для правила rust (rust.mdc).
#
# Канон надходить через --data: { "template": { "contains": ... } }
# Структура --data сформована з template/package.json.contains.json.
# Перевіряємо substring-вимоги до scripts.lint-rust: усі три кроки
# (`cargo fmt`, `cargo clippy --fix`, фінальний `cargo clippy ... -D warnings`)
# мають бути присутніми у значенні скрипта.
package rust.package_json

import rego.v1

deny contains msg if {
	some script_name, needles in data.template.contains.scripts
	actual := object.get(object.get(input, "scripts", {}), script_name, "")
	some needle in needles
	not contains(actual, needle)
	msg := sprintf("package.json: scripts.%s має містити %q (rust.mdc)", [script_name, needle])
}
