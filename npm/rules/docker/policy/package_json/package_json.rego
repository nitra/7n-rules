# Перевірка `package.json` (docker.mdc).
#
# Канон надходить через --data: { "template": { "snippet": ... } }
# Backward-compatible: перевіряє ЛИШЕ зміст значення `scripts.lint-docker`, якщо ключ
# присутній у старому проєкті. Нові проєкти використовують `n-cursor lint docker`
# напряму, без package.json wrapper.
package docker.package_json

import rego.v1

# Conditional snippet-check: тільки якщо значення непорожнє у input.
deny contains msg if {
	some script_name, expected in data.template.snippet.scripts
	actual := object.get(object.get(input, "scripts", {}), script_name, "")
	actual != ""
	trim_space(actual) != expected
	msg := sprintf("package.json: scripts.%s має бути %q (зараз: %q) (docker.mdc)", [script_name, expected, actual])
}
