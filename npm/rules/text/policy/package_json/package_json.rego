# Порт текст-специфічних перевірок `package.json` з `npm/scripts/check-text.mjs` (text.mdc).
#
# Запуск (локально):
#   conftest test package.json -p npm/policy/text --namespace text.package_json
#
# Перевіряє: відсутність Prettier (поле + конфіги в deps), `@nitra/cspell-dict ^2.0.0+`
# у `devDependencies`, заборона `markdownlint-cli2` у dependencies/devDependencies.
#
# Перевірка скрипта `lint-text` (cspell, run-shellcheck-text.mjs, markdownlint, v8r,
# обовʼязкові glob-и для v8r) — у JS-частині (`check-text.mjs`): занадто варіативна
# для декларативної політики (3 режими v8r з різними вимогами до глобів).
#
# Структура каталогу збігається зі шляхом пакету (regal: directory-package-mismatch).
# Конвенція проєкту — `import rego.v1` + multi-value `deny contains msg if { … }`
# (.cursor/rules/conftest.mdc). Лінт — `bun run lint-rego` (regal).
package text.package_json

import rego.v1

# ── Заборонені пакети у dependencies/devDependencies ──────────────────────

forbidden_packages := {
	"prettier": "Prettier заборонено — використовуй oxfmt (text.mdc)",
	"@nitra/prettier-config": "Prettier-конфіг заборонено — використовуй oxfmt (text.mdc)",
}

# ── deny: заборонене поле `prettier` у package.json ───────────────────────

deny contains msg if {
	object.get(input, "prettier", null) != null
	msg := "package.json містить поле \"prettier\" — видали його (text.mdc)"
}

# ── deny: prettier у dependencies/devDependencies ─────────────────────────

deny contains msg if {
	some pkg, hint in forbidden_packages
	pkg in object.keys(object.get(input, "dependencies", {}))
	msg := sprintf("package.json: dependencies містить %q — %s", [pkg, hint])
}

deny contains msg if {
	some pkg, hint in forbidden_packages
	pkg in object.keys(object.get(input, "devDependencies", {}))
	msg := sprintf("package.json: devDependencies містить %q — %s", [pkg, hint])
}

# ── deny: markdownlint-cli2 не повинен бути у залежностях ─────────────────
#
# Канонічний виклик — `bunx markdownlint-cli2` у `lint-text`, без оголошення пакета.

deny contains msg if {
	"markdownlint-cli2" in object.keys(object.get(input, "dependencies", {}))
	msg := "package.json: dependencies містить markdownlint-cli2 — використовуй bunx у lint-text (text.mdc)"
}

deny contains msg if {
	"markdownlint-cli2" in object.keys(object.get(input, "devDependencies", {}))
	msg := "package.json: devDependencies містить markdownlint-cli2 — використовуй bunx у lint-text (text.mdc)"
}

# ── deny: @nitra/cspell-dict ^2.0.0+ обовʼязковий ─────────────────────────

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

# ── helpers ────────────────────────────────────────────────────────────────

# Чи мажорна версія cspell-dict ≥ 2. Підтримує `^2.0.0`, `~2.x`, `2.5.0`,
# `>=2.0.0`, `workspace:*` (тоді fallback false), із префіксом і без.
# Regex `^[\^~>=<]*\s*(\d+)` дістає першу цифру після опціональних range-операторів.
cspell_dict_major_at_least_2(range) if {
	# `regex.find_n` повертає масив збігів; беремо перший і дивимось на перше число.
	match := regex.find_n(`^[\^~>=<]*\s*(\d+)`, range, 1)
	count(match) > 0
	major := to_number(regex.replace(match[0], `^[\^~>=<]*\s*`, ""))
	major >= 2
}
