# Перевірка `package.json` для правила test (test.mdc).
#
# Канон надходить через --data: { "template": { "contains": ... } }
# Структура --data сформована з template/package.json.contains.json.
# Перевіряємо substring-вимоги до scripts.coverage і scripts.test:
# рядки мають містити відповідно "@7n/test coverage" і "vitest" + "--bun".
package test.package_json

import rego.v1

deny contains msg if {
	some script_name, needles in data.template.contains.scripts
	actual := object.get(object.get(input, "scripts", {}), script_name, "")
	some needle in needles
	not contains(actual, needle)
	msg := sprintf("package.json: scripts.%s має містити %q (test.mdc)%s", [script_name, needle, explain_suffix(needle)])
}

# --bun пояснюється окремо: без нього forked vitest pool-процеси не успадковують
# Bun-рушій, і Bun-нативні built-in модулі (напр. `import { SQL } from 'bun'`)
# не резолвуються у forked test-процесах.
explain_suffix(needle) := msg if {
	needle == "--bun"
	msg := " — без --bun forked vitest pool-процеси не успадковують Bun-рушій, тож Bun-нативні built-in модулі (напр. import { SQL } from 'bun') не резолвуються у forked test-процесах"
} else := ""
