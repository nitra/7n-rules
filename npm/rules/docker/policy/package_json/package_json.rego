# Перевірка `package.json` (docker.mdc).
#
# Канон надходить через --data: { "template": { "snippet": ... } }
# Перевіряє ЛИШЕ зміст значення `scripts.lint-docker`, якщо ключ присутній.
# Умовну обовʼязковість (правило `docker` у `.n-cursor.json` → `scripts.lint-docker`
# зобовʼязаний існувати) перевіряє `check-bun.mjs` через cross-file логіку.
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
