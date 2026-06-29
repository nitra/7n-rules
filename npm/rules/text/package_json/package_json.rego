# Порт текст-специфічних перевірок `package.json` (text.mdc).
#
# Канон надходить через --data: { "template": { "deny": ... } }
# Структура --data сформована з template/package.json.deny.json:
#  - `top-level`: top-level forbidden fields (e.g. `prettier`)
#  - `dependencies` / `devDependencies`: forbidden packages.
#
# Логіка, що ЛИШАЄТЬСЯ у rego (inverse, не виноситься у template):
#  - `@nitra/cspell-dict` ^2.0.0+ обовʼязковий у devDependencies (presence + semver range).
package text.package_json

import rego.v1

deny contains msg if {
	some field, reason in data.template.deny["top-level"]
	object.get(input, field, null) != null
	msg := sprintf("package.json містить поле %q — %s", [field, reason])
}

deny contains msg if {
	some pkg, reason in data.template.deny.dependencies
	pkg in object.keys(object.get(input, "dependencies", {}))
	msg := sprintf("package.json: dependencies містить %q — %s", [pkg, reason])
}

deny contains msg if {
	some pkg, reason in data.template.deny.devDependencies
	pkg in object.keys(object.get(input, "devDependencies", {}))
	msg := sprintf("package.json: devDependencies містить %q — %s", [pkg, reason])
}

deny contains msg if {
	dev := object.get(input, "devDependencies", {})
	not "@nitra/cspell-dict" in object.keys(dev)
	msg := "@nitra/cspell-dict у devDependencies обовʼязковий — bun add -d @nitra/cspell-dict@^2.0.0 (text.mdc)"
}

deny contains msg if {
	range := object.get(object.get(input, "devDependencies", {}), "@nitra/cspell-dict", "")
	range != ""
	not cspell_dict_major_at_least_2(range)
	msg := sprintf("@nitra/cspell-dict має бути ^2.0.0 або новіший (зараз %q) (text.mdc)", [range])
}

# Будь-який scripts.* з токеном `prettier` (наприклад `bunx prettier`, `npx prettier`,
# `prettier --write`) — заборонено: каноном форматування є oxfmt (text.mdc).
deny contains msg if {
	some name, cmd in object.get(input, "scripts", {})
	is_string(cmd)
	script_invokes_prettier(cmd)
	msg := sprintf("package.json: scripts.%s містить prettier — використовуй oxfmt (text.mdc)", [name])
}

cspell_dict_major_at_least_2(range) if {
	match := regex.find_n(`^[\^~>=<]*\s*(\d+)`, range, 1)
	count(match) > 0
	major := to_number(regex.replace(match[0], `^[\^~>=<]*\s*`, ""))
	major >= 2
}

# Token-based, щоб уникнути false-positive на словах типу `not-prettier` чи
# `prettier-ignore` всередині інших ідентифікаторів. Виконавчий runner: команда
# або шлях, що закінчується на `prettier`, або `prettier` як аргумент CLI.
script_invokes_prettier(cmd) if {
	regex.match(`(^|[\s/"'])prettier($|[\s'"@])`, cmd)
}
