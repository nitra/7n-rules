# Перевірка кореневого `package.json` abie-проєкту: у `devDependencies` має бути
# `@nitra/abie-docs` (контракти/схеми abie-сервісів — наприклад
# `node_modules/@nitra/abie-docs/...`). Версію не фіксуємо — лише presence.
#
# Inverse-presence перевірка — лишається inline у rego (як `@nitra/cspell-dict`
# у `text.package_json`), бо у template/ зберігаємо позитивні snippet/deny канони,
# а не одиничний required-ключ.
package abie.package_json_docs

import rego.v1

deny contains msg if {
	dev := object.get(input, "devDependencies", {})
	not "@nitra/abie-docs" in object.keys(dev)
	msg := "package.json: devDependencies має містити @nitra/abie-docs — bun add -d @nitra/abie-docs (abie.mdc)"
}
