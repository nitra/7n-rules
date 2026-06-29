# Перевірка кореневого `package.json` efes-проєкту: у `devDependencies` має бути
# `@nitra/efes-shared` (спільні efes-ресурси — схеми, скіли, типи; використовується,
# зокрема, у `graphql.mdc` як `node_modules/@nitra/efes-shared/schema/maya.graphql`).
# Версію не фіксуємо — лише presence.
#
# Inverse-presence перевірка лишається inline у rego (як `@nitra/cspell-dict`
# у `text.package_json`).
package efes.package_json_shared

import rego.v1

deny contains msg if {
	dev := object.get(input, "devDependencies", {})
	not "@nitra/efes-shared" in object.keys(dev)
	msg := "package.json: devDependencies має містити @nitra/efes-shared — bun add -d @nitra/efes-shared (efes.mdc)"
}
