# Порт перевірок `package.json` (style-lint.mdc).
#
# Канон надходить через --data: { "template": { "contains": ..., "snippet": ... } }
# Структура --data сформована з template/package.json.{contains,snippet}.json.
# FS-альтернативи (`.stylelintrc.*` файли) + `.stylelintignore` — у JS.
#
# Логіка, що ЛИШАЄТЬСЯ у rego (inverse — не виноситься у template):
#  - `@nitra/stylelint-config` має бути у devDependencies (presence-check).
package style_lint.package_json

import rego.v1

# ── deny: 2-level snippet walker (для stylelint.extends, якщо поле є) ────

deny contains msg if {
	some section, expected_inner in data.template.snippet
	cfg := object.get(input, section, null)
	is_object(cfg)
	some leaf_key, expected_value in expected_inner
	actual := object.get(cfg, leaf_key, null)
	actual != expected_value
	msg := sprintf("package.json: %s.%s має бути %q (style-lint.mdc)", [section, leaf_key, expected_value])
}

# ── deny: @nitra/stylelint-config у devDependencies (inverse) ────────────

deny contains msg if {
	dev := object.get(input, "devDependencies", {})
	not "@nitra/stylelint-config" in object.keys(dev)
	msg := "@nitra/stylelint-config відсутній — bun add -d @nitra/stylelint-config (style-lint.mdc)"
}
