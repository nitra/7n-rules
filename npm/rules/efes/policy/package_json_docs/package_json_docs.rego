# Перевірка кореневого `package.json` efes-проєкту: у `devDependencies` має бути
# `@nitra/efes-docs` (контракти/схеми efes-сервісів — використовується, зокрема,
# у `graphql.mdc` як `node_modules/@nitra/efes-docs/schema/maya.graphql`). Версію
# не фіксуємо — лише presence.
#
# Inverse-presence перевірка лишається inline у rego (як `@nitra/cspell-dict`
# у `text.package_json`).
package efes.package_json_docs

import rego.v1

deny contains msg if {
	dev := object.get(input, "devDependencies", {})
	not "@nitra/efes-docs" in object.keys(dev)
	msg := "package.json: devDependencies має містити @nitra/efes-docs — bun add -d @nitra/efes-docs (efes.mdc)"
}
