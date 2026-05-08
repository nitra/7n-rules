# Порт перевірок `package.json` з `npm/scripts/check-style-lint.mjs` (style-lint.mdc).
#
# Запуск (локально):
#   conftest test package.json -p npm/policy/style_lint --namespace style_lint.package_json
#
# Перевіряє: наявність скрипта `lint-style` з `npx stylelint`, `@nitra/stylelint-config`
# у `devDependencies`, поле `stylelint.extends == "@nitra/stylelint-config"`. FS-частина
# (зовнішні `.stylelintrc.*` як альтернатива полю; `.stylelintignore`) лишається у JS.
#
# Структура каталогу збігається зі шляхом пакету (regal: directory-package-mismatch).
# Конвенція проєкту — `import rego.v1` + multi-value `deny contains msg if { … }`
# (.cursor/rules/conftest.mdc). Лінт — `bun run lint-rego` (regal).
package style_lint.package_json

import rego.v1

# ── deny: lint-style скрипт ───────────────────────────────────────────────

deny contains msg if {
	not object.get(object.get(input, "scripts", {}), "lint-style", false)
	msg := "package.json не містить скрипт \"lint-style\" (style-lint.mdc)"
}

deny contains msg if {
	lint_style := object.get(object.get(input, "scripts", {}), "lint-style", "")
	lint_style != ""
	not contains(lint_style, "npx stylelint")
	msg := sprintf("lint-style має викликати stylelint через npx (зараз: %q) (style-lint.mdc)", [lint_style])
}

# ── deny: @nitra/stylelint-config у devDependencies ───────────────────────

deny contains msg if {
	dev := object.get(input, "devDependencies", {})
	not "@nitra/stylelint-config" in object.keys(dev)
	msg := "@nitra/stylelint-config відсутній — bun add -d @nitra/stylelint-config (style-lint.mdc)"
}

# ── deny: поле stylelint.extends = "@nitra/stylelint-config" ──────────────
#
# JS-перевірка дозволяє альтернативу: окремий файл `.stylelintrc.*`. Цю частину
# перевіряємо в JS (FS-вибірка); тут — лише структурна валідація поля, якщо воно є.

deny contains msg if {
	cfg := object.get(input, "stylelint", null)
	is_object(cfg)
	object.get(cfg, "extends", null) != "@nitra/stylelint-config"
	msg := "package.json: stylelint.extends має бути \"@nitra/stylelint-config\" (style-lint.mdc)"
}
